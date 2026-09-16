use crate::contracts::{
    HubCommandError, HubProject, HubProjectWikiSummary, RegisterProjectResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const REGISTRY_SCHEMA_VERSION: u8 = 1;
const REGISTRY_FILE: &str = "projects.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRecord {
    id: String,
    name: String,
    path: String,
    #[serde(default)]
    previous_paths: Vec<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    last_opened_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRegistry {
    schema_version: u8,
    projects: Vec<ProjectRecord>,
}

fn command_error(
    code: &'static str,
    message: impl Into<String>,
    retryable: bool,
) -> HubCommandError {
    HubCommandError {
        code,
        message: message.into(),
        retryable,
    }
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, HubCommandError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(REGISTRY_FILE))
        .map_err(|error| {
            command_error(
                "internal_error",
                format!("Unable to resolve Hub project storage: {error}"),
                true,
            )
        })
}

fn empty_registry() -> ProjectRegistry {
    ProjectRegistry {
        schema_version: REGISTRY_SCHEMA_VERSION,
        projects: Vec::new(),
    }
}

fn load_registry(path: &Path) -> Result<ProjectRegistry, HubCommandError> {
    match fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(empty_registry()),
        Err(error) => {
            return Err(command_error(
                "project_registry_corrupt",
                format!("Unable to access the Hub project registry: {error}"),
                false,
            ))
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err(command_error(
                "project_registry_corrupt",
                "The Hub project registry path is not a file.",
                false,
            ))
        }
        Ok(_) => {}
    }

    let contents = fs::read_to_string(path).map_err(|error| {
        command_error(
            "project_registry_corrupt",
            format!("Unable to read the Hub project registry: {error}"),
            false,
        )
    })?;
    let registry = serde_json::from_str::<ProjectRegistry>(&contents).map_err(|error| {
        command_error(
            "project_registry_corrupt",
            format!("The Hub project registry is not valid JSON: {error}"),
            false,
        )
    })?;
    if registry.schema_version != REGISTRY_SCHEMA_VERSION
        || registry.projects.iter().any(|project| {
            project.id.trim().is_empty()
                || project.name.trim().is_empty()
                || project.path.trim().is_empty()
        })
    {
        return Err(command_error(
            "project_registry_corrupt",
            "The Hub project registry uses an unsupported or invalid format.",
            false,
        ));
    }

    Ok(registry)
}

fn save_registry(path: &Path, registry: &ProjectRegistry) -> Result<(), HubCommandError> {
    let contents = serde_json::to_string_pretty(registry).map_err(|error| {
        command_error(
            "internal_error",
            format!("Unable to serialize the Hub project registry: {error}"),
            true,
        )
    })?;
    let directory = path.parent().ok_or_else(|| {
        command_error(
            "internal_error",
            "Unable to resolve the Hub project storage directory.",
            true,
        )
    })?;
    fs::create_dir_all(directory).map_err(|error| {
        command_error(
            "internal_error",
            format!("Unable to create Hub project storage: {error}"),
            true,
        )
    })?;
    fs::write(path, contents).map_err(|error| {
        command_error(
            "internal_error",
            format!("Unable to persist the Hub project registry: {error}"),
            true,
        )
    })
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn normalized_path_text(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('\\', "/");
    if let Some(unc_path) = key.strip_prefix("//?/UNC/") {
        key = format!("//{unc_path}");
    } else if let Some(dos_path) = key.strip_prefix("//?/") {
        key = dos_path.to_string();
    }
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }
    key
}

fn normalized_path_key(path: &Path) -> String {
    // Remote URLs are deliberately not part of the key: two local clones of
    // one repository are separate Projects and must retain separate state.
    let key = normalized_path_text(path);
    #[cfg(windows)]
    {
        key.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        key
    }
}

fn invalid_path_error(path: &str, detail: &str) -> HubCommandError {
    command_error(
        "project_invalid_path",
        format!("Cannot register project '{path}': {detail}"),
        false,
    )
}

fn normalize_selected_path(raw_path: &str) -> Result<PathBuf, HubCommandError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(invalid_path_error(
            raw_path,
            "a directory path is required.",
        ));
    }

    let input = PathBuf::from(trimmed);
    if !input.is_absolute() {
        return Err(invalid_path_error(trimmed, "the path must be absolute."));
    }
    let metadata = fs::metadata(&input).map_err(|error| {
        let detail = if error.kind() == std::io::ErrorKind::PermissionDenied {
            "the directory cannot be accessed because permission was denied."
        } else if error.kind() == std::io::ErrorKind::NotFound {
            "the directory does not exist."
        } else {
            "the directory could not be accessed."
        };
        invalid_path_error(trimmed, detail)
    })?;
    if !metadata.is_dir() {
        return Err(invalid_path_error(
            trimmed,
            "the selected path is not a directory.",
        ));
    }
    fs::canonicalize(&input).map_err(|error| {
        invalid_path_error(
            trimmed,
            &format!("the directory could not be normalized: {error}"),
        )
    })
}

fn path_availability(path: &Path) -> (&'static str, Option<String>) {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => ("available", None),
        Ok(_) => (
            "inaccessible",
            Some("The registered path is no longer a directory.".to_string()),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            "missing",
            Some("The registered directory does not exist.".to_string()),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => (
            "permission_denied",
            Some("Permission was denied while opening the registered directory.".to_string()),
        ),
        Err(error) => (
            "inaccessible",
            Some(format!(
                "The registered directory could not be accessed: {error}"
            )),
        ),
    }
}

fn source_control(path: &Path) -> &'static str {
    match fs::symlink_metadata(path.join(".git")) {
        Ok(metadata) if metadata.is_dir() || metadata.is_file() => "git",
        _ => "non_git",
    }
}

fn safe_relative_path(value: &str) -> bool {
    if value.trim().is_empty() || Path::new(value).is_absolute() {
        return false;
    }
    !Path::new(value).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

fn safe_page_path(root: &Path, parts: &[&str]) -> Option<PathBuf> {
    if parts.iter().any(|part| !safe_relative_path(part)) {
        return None;
    }
    let relative = parts.iter().fold(PathBuf::new(), |mut path, part| {
        path.push(part);
        path
    });
    let candidate = root.join(relative);
    let canonical_root = fs::canonicalize(root).ok()?;

    if let Ok(canonical_candidate) = fs::canonicalize(&candidate) {
        if canonical_candidate.starts_with(&canonical_root) {
            return Some(canonical_candidate);
        }
        return None;
    }

    if let Some(parent) = candidate.parent() {
        if let Ok(canonical_parent) = fs::canonicalize(parent) {
            if !canonical_parent.starts_with(&canonical_root) {
                return None;
            }
        }
    }
    Some(candidate)
}

fn inspect_catalog(catalog_path: &Path, page_root: &Path, flat_pages: bool) -> &'static str {
    let contents = match fs::read_to_string(catalog_path) {
        Ok(contents) => contents,
        Err(_) => return "invalid",
    };
    let catalog = match serde_json::from_str::<Value>(&contents) {
        Ok(catalog) => catalog,
        Err(_) => return "invalid",
    };
    let Some(pages) = catalog.get("pages").and_then(Value::as_array) else {
        return "invalid";
    };
    if pages.is_empty() {
        return "invalid";
    }

    let mut has_missing_page = false;
    for page in pages {
        let Some(file) = page.get("file").and_then(Value::as_str) else {
            return "invalid";
        };
        let section = if flat_pages {
            None
        } else {
            match page.get("section") {
                None => None,
                Some(value) => {
                    let Some(section) = value.as_str() else {
                        return "invalid";
                    };
                    Some(section)
                }
            }
        };
        let parts = section
            .into_iter()
            .chain(std::iter::once(file))
            .collect::<Vec<_>>();
        let Some(page_path) = safe_page_path(page_root, &parts) else {
            return "invalid";
        };
        match fs::metadata(page_path) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return "invalid",
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => has_missing_page = true,
            Err(_) => has_missing_page = true,
        }
    }

    if has_missing_page {
        "partial"
    } else {
        "readable"
    }
}

fn inspect_open_zread(path: &Path) -> &'static str {
    let wiki_root = path.join(".open-zread").join("wiki");
    match fs::metadata(&wiki_root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
        Ok(metadata) if !metadata.is_dir() => return "invalid",
        Err(_) => return "invalid",
        _ => {}
    }
    let catalog = wiki_root.join("wiki.json");
    match fs::metadata(&catalog) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "missing",
        Ok(metadata) if metadata.is_file() => inspect_catalog(&catalog, &wiki_root, false),
        _ => "invalid",
    }
}

fn inspect_zread(path: &Path) -> &'static str {
    let wiki_root = path.join(".zread").join("wiki");
    match fs::metadata(&wiki_root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
        Ok(metadata) if !metadata.is_dir() => return "invalid",
        Err(_) => return "invalid",
        _ => {}
    }
    let current_path = wiki_root.join("current");
    match fs::metadata(&current_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
        Ok(metadata) if !metadata.is_file() => return "invalid",
        Err(_) => return "invalid",
        _ => {}
    }
    let pointer = match fs::read_to_string(&current_path) {
        Ok(pointer) => pointer.trim_start_matches('\u{feff}').trim().to_string(),
        Err(_) => return "invalid",
    };
    if !safe_relative_path(&pointer) {
        return "invalid";
    }
    let version_root = match safe_page_path(&wiki_root, &[&pointer]) {
        Some(version_root) => version_root,
        None => return "invalid",
    };
    match fs::metadata(&version_root) {
        Ok(metadata) if metadata.is_dir() => {}
        _ => return "invalid",
    }
    let catalog = version_root.join("wiki.json");
    match fs::metadata(&catalog) {
        Ok(metadata) if metadata.is_file() => inspect_catalog(&catalog, &version_root, true),
        _ => "invalid",
    }
}

fn project_view(record: &ProjectRecord) -> HubProject {
    let path = Path::new(&record.path);
    let (availability, availability_reason) = path_availability(path);
    let (open_zread, zread) = if availability == "available" {
        (inspect_open_zread(path), inspect_zread(path))
    } else {
        ("unavailable", "unavailable")
    };

    HubProject {
        id: record.id.clone(),
        name: record.name.clone(),
        path: record.path.clone(),
        previous_paths: record.previous_paths.clone(),
        source_control: source_control(path),
        availability,
        availability_reason,
        wiki: HubProjectWikiSummary { open_zread, zread },
        favorite: record.favorite,
        last_opened_at: record.last_opened_at.clone(),
    }
}

pub(crate) fn list_projects(app: &AppHandle) -> Result<Vec<HubProject>, HubCommandError> {
    let registry = load_registry(&registry_path(app)?)?;
    Ok(registry.projects.iter().map(project_view).collect())
}

pub(crate) fn register_project(
    app: &AppHandle,
    raw_path: &str,
) -> Result<RegisterProjectResponse, HubCommandError> {
    let normalized_path = normalize_selected_path(raw_path)?;
    let normalized_key = normalized_path_key(&normalized_path);
    let path_string = normalized_path_text(&normalized_path);
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;

    if let Some(existing) = registry
        .projects
        .iter_mut()
        .find(|project| normalized_path_key(Path::new(&project.path)) == normalized_key)
    {
        existing.last_opened_at = Some(now_millis());
        let project = project_view(existing);
        save_registry(&storage_path, &registry)?;
        return Ok(RegisterProjectResponse {
            project,
            created: false,
        });
    }

    let name = normalized_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Project")
        .to_string();
    let record = ProjectRecord {
        id: Uuid::new_v4().to_string(),
        name,
        path: path_string,
        previous_paths: Vec::new(),
        favorite: false,
        last_opened_at: Some(now_millis()),
    };
    let project = project_view(&record);
    registry.projects.push(record);
    save_registry(&storage_path, &registry)?;
    Ok(RegisterProjectResponse {
        project,
        created: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};

    fn temporary_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("open-zread-hub-{label}-{suffix}"));
        create_dir_all(&root).expect("temporary root should be created");
        root
    }

    #[test]
    fn registry_round_trip_preserves_project_identity() {
        let root = temporary_root("registry");
        let path = root.join("projects.json");
        let registry = ProjectRegistry {
            schema_version: REGISTRY_SCHEMA_VERSION,
            projects: vec![ProjectRecord {
                id: "stable-id".to_string(),
                name: "Example".to_string(),
                path: root.to_string_lossy().into_owned(),
                previous_paths: Vec::new(),
                favorite: true,
                last_opened_at: Some("123".to_string()),
            }],
        };
        save_registry(&path, &registry).expect("registry should save");
        let loaded = load_registry(&path).expect("registry should load");
        assert_eq!(loaded.projects[0].id, "stable-id");
        assert!(loaded.projects[0].favorite);
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn malformed_registry_is_reported_as_corrupt() {
        let root = temporary_root("corrupt-registry");
        let path = root.join("projects.json");
        write(&path, b"not json").expect("registry should be written");
        let error = load_registry(&path).expect_err("malformed registry should fail");
        assert_eq!(error.code, "project_registry_corrupt");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn project_status_distinguishes_missing_and_wiki_format_states() {
        let root = temporary_root("project-status");
        let missing = ProjectRecord {
            id: "missing".to_string(),
            name: "Missing".to_string(),
            path: root.join("gone").to_string_lossy().into_owned(),
            previous_paths: Vec::new(),
            favorite: false,
            last_opened_at: None,
        };
        let missing_view = project_view(&missing);
        assert_eq!(missing_view.availability, "missing");
        assert_eq!(missing_view.wiki.open_zread, "unavailable");

        let invalid_root = root.join("invalid");
        create_dir_all(invalid_root.join(".open-zread/wiki"))
            .expect("wiki directory should be created");
        write(
            invalid_root.join(".open-zread/wiki/wiki.json"),
            b"{\"pages\":[}",
        )
        .expect("invalid catalog should be written");
        let invalid = ProjectRecord {
            id: "invalid".to_string(),
            name: "Invalid".to_string(),
            path: invalid_root.to_string_lossy().into_owned(),
            previous_paths: Vec::new(),
            favorite: false,
            last_opened_at: None,
        };
        let invalid_view = project_view(&invalid);
        assert_eq!(invalid_view.availability, "available");
        assert_eq!(invalid_view.wiki.open_zread, "invalid");

        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn valid_catalog_with_missing_page_is_partial() {
        let root = temporary_root("partial-wiki");
        let wiki_root = root.join(".open-zread/wiki");
        create_dir_all(&wiki_root).expect("wiki directory should be created");
        write(
            wiki_root.join("wiki.json"),
            br#"{"pages":[{"section":"guide","file":"missing.md"}]}"#,
        )
        .expect("catalog should be written");
        let record = ProjectRecord {
            id: "partial".to_string(),
            name: "Partial".to_string(),
            path: root.to_string_lossy().into_owned(),
            previous_paths: Vec::new(),
            favorite: false,
            last_opened_at: None,
        };
        assert_eq!(project_view(&record).wiki.open_zread, "partial");
        remove_dir_all(root).expect("temporary root should be removed");
    }
}
