use crate::contracts::{
    HubCommandError, HubProject, HubProjectWikiSummary, RegisterProjectResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};
#[cfg(windows)]
use std::process::Command;
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
    added_at: Option<String>,
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

fn new_project_record(name: String, path: String) -> ProjectRecord {
    let added_at = now_millis();
    ProjectRecord {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        previous_paths: Vec::new(),
        favorite: false,
        added_at: Some(added_at.clone()),
        last_opened_at: Some(added_at),
    }
}

fn mark_project_opened(record: &mut ProjectRecord) {
    record.last_opened_at = Some(now_millis());
}

fn set_project_name(record: &mut ProjectRecord, raw_name: &str) -> Result<(), HubCommandError> {
    let name = raw_name.trim();
    if name.is_empty() || name.chars().any(char::is_control) || name.chars().count() > 120 {
        return Err(command_error(
            "project_invalid_name",
            "Project name must contain 1 to 120 non-control characters.",
            false,
        ));
    }
    record.name = name.to_string();
    Ok(())
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

fn invalid_project_id_error() -> HubCommandError {
    command_error("invalid_request", "Project id is required.", false)
}

fn project_not_found_error(project_id: &str) -> HubCommandError {
    command_error(
        "project_not_found",
        format!("Project '{project_id}' is not registered."),
        false,
    )
}

fn project_unavailable_error(project: &ProjectRecord) -> HubCommandError {
    command_error(
        "project_unavailable",
        format!(
            "Project '{}' is not available at '{}'.",
            project.name, project.path
        ),
        true,
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

pub(crate) fn safe_relative_path(value: &str) -> bool {
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

pub(crate) fn safe_page_path(root: &Path, parts: &[&str]) -> Option<PathBuf> {
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
            has_missing_page = true;
            continue;
        };
        let section = if flat_pages {
            None
        } else {
            match page.get("section") {
                None => None,
                Some(value) => {
                    let Some(section) = value.as_str() else {
                        has_missing_page = true;
                        continue;
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
        match fs::metadata(&page_path) {
            Ok(metadata) if metadata.is_file() => {
                if fs::read_to_string(&page_path).is_err() {
                    has_missing_page = true;
                }
            }
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

pub(crate) fn inspect_open_zread(path: &Path) -> &'static str {
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

pub(crate) fn inspect_zread(path: &Path) -> &'static str {
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
        added_at: record.added_at.clone(),
        last_opened_at: record.last_opened_at.clone(),
    }
}

fn project_index(registry: &ProjectRegistry, project_id: &str) -> Result<usize, HubCommandError> {
    let normalized_id = project_id.trim();
    if normalized_id.is_empty() {
        return Err(invalid_project_id_error());
    }
    registry
        .projects
        .iter()
        .position(|project| project.id == normalized_id)
        .ok_or_else(|| project_not_found_error(normalized_id))
}

pub(crate) fn project_root(app: &AppHandle, project_id: &str) -> Result<PathBuf, HubCommandError> {
    let registry = load_registry(&registry_path(app)?)?;
    let index = project_index(&registry, project_id)?;
    let project = &registry.projects[index];
    if path_availability(Path::new(&project.path)).0 != "available" {
        return Err(project_unavailable_error(project));
    }
    Ok(PathBuf::from(&project.path))
}

fn append_previous_path(record: &mut ProjectRecord, path: &str) {
    let path_key = normalized_path_key(Path::new(path));
    if normalized_path_key(Path::new(&record.path)) == path_key
        || record
            .previous_paths
            .iter()
            .any(|previous| normalized_path_key(Path::new(previous)) == path_key)
    {
        return;
    }
    record.previous_paths.push(path.to_string());
}

fn relocate_record(record: &mut ProjectRecord, path: String, normalized_key: &str) {
    let old_path = record.path.clone();
    if normalized_path_key(Path::new(&old_path)) != normalized_key {
        append_previous_path(record, &old_path);
        record.path = path;
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
        mark_project_opened(existing);
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
    let record = new_project_record(name, path_string);
    let project = project_view(&record);
    registry.projects.push(record);
    save_registry(&storage_path, &registry)?;
    Ok(RegisterProjectResponse {
        project,
        created: true,
    })
}

pub(crate) fn rename_project(
    app: &AppHandle,
    project_id: &str,
    raw_name: &str,
) -> Result<HubProject, HubCommandError> {
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;
    let index = project_index(&registry, project_id)?;
    set_project_name(&mut registry.projects[index], raw_name)?;
    let project = project_view(&registry.projects[index]);
    save_registry(&storage_path, &registry)?;
    Ok(project)
}

pub(crate) fn set_project_favorite(
    app: &AppHandle,
    project_id: &str,
    favorite: bool,
) -> Result<HubProject, HubCommandError> {
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;
    let index = project_index(&registry, project_id)?;
    registry.projects[index].favorite = favorite;
    let project = project_view(&registry.projects[index]);
    save_registry(&storage_path, &registry)?;
    Ok(project)
}

pub(crate) fn relocate_project(
    app: &AppHandle,
    project_id: &str,
    raw_path: &str,
) -> Result<HubProject, HubCommandError> {
    let normalized_path = normalize_selected_path(raw_path)?;
    let normalized_key = normalized_path_key(&normalized_path);
    let path_string = normalized_path_text(&normalized_path);
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;
    let index = project_index(&registry, project_id)?;

    if registry
        .projects
        .iter()
        .enumerate()
        .any(|(other_index, project)| {
            other_index != index && normalized_path_key(Path::new(&project.path)) == normalized_key
        })
    {
        return Err(command_error(
            "project_duplicate_path",
            "The selected directory is already registered as another Project.".to_string(),
            false,
        ));
    }

    let record = &mut registry.projects[index];
    relocate_record(record, path_string, &normalized_key);
    let project = project_view(record);
    save_registry(&storage_path, &registry)?;
    Ok(project)
}

pub(crate) fn remove_project(app: &AppHandle, project_id: &str) -> Result<(), HubCommandError> {
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;
    let index = project_index(&registry, project_id)?;
    registry.projects.remove(index);
    save_registry(&storage_path, &registry)
}

enum ProjectLaunchTarget {
    Folder,
    Terminal,
}

#[cfg(windows)]
fn launch_project(path: &Path, target: ProjectLaunchTarget) -> Result<(), HubCommandError> {
    let result = match target {
        ProjectLaunchTarget::Folder => Command::new("explorer.exe").arg(path).spawn(),
        ProjectLaunchTarget::Terminal => Command::new("cmd.exe")
            .args(["/C", "start", "", "cmd.exe"])
            .current_dir(path)
            .spawn(),
    };
    result.map(|_| ()).map_err(|error| {
        command_error(
            "internal_error",
            format!("Unable to open the Project location: {error}"),
            true,
        )
    })
}

#[cfg(not(windows))]
fn launch_project(_path: &Path, _target: ProjectLaunchTarget) -> Result<(), HubCommandError> {
    Err(command_error(
        "unsupported_platform",
        "Opening a Project folder or terminal is currently supported on Windows only.",
        false,
    ))
}

fn open_project(
    app: &AppHandle,
    project_id: &str,
    target: ProjectLaunchTarget,
) -> Result<HubProject, HubCommandError> {
    let storage_path = registry_path(app)?;
    let mut registry = load_registry(&storage_path)?;
    let index = project_index(&registry, project_id)?;
    let record = &registry.projects[index];
    if path_availability(Path::new(&record.path)).0 != "available" {
        return Err(project_unavailable_error(record));
    }
    launch_project(Path::new(&record.path), target)?;

    let record = &mut registry.projects[index];
    record.last_opened_at = Some(now_millis());
    let project = project_view(record);
    save_registry(&storage_path, &registry)?;
    Ok(project)
}

pub(crate) fn open_project_folder(
    app: &AppHandle,
    project_id: &str,
) -> Result<HubProject, HubCommandError> {
    open_project(app, project_id, ProjectLaunchTarget::Folder)
}

pub(crate) fn open_project_terminal(
    app: &AppHandle,
    project_id: &str,
) -> Result<HubProject, HubCommandError> {
    open_project(app, project_id, ProjectLaunchTarget::Terminal)
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
                added_at: Some("100".to_string()),
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
    fn legacy_registry_projects_keep_an_unknown_added_date() {
        let registry: ProjectRegistry = serde_json::from_str(
            r#"{"schemaVersion":1,"projects":[{"id":"legacy","name":"Legacy","path":"C:/work/legacy","previousPaths":[],"favorite":false,"lastOpenedAt":"123"}]}"#,
        )
        .expect("legacy registry without addedAt should still load");
        assert_eq!(registry.projects[0].added_at, None);
        let serialized =
            serde_json::to_string(&registry).expect("legacy registry should serialize");
        let reloaded: ProjectRegistry =
            serde_json::from_str(&serialized).expect("serialized legacy registry should reload");
        assert_eq!(reloaded.projects[0].added_at, None);
    }

    #[test]
    fn added_date_is_preserved_when_reopened_and_relocated() {
        let root = temporary_root("added-at-stable");
        let old_path = root.join("old");
        let new_path = root.join("new");
        create_dir_all(old_path.join(".open-zread/wiki"))
            .expect("project Wiki directory should be created");
        write(old_path.join(".open-zread/wiki/wiki.json"), b"catalog")
            .expect("Wiki catalog should be written");
        let mut record = new_project_record("Project".to_string(), normalized_path_text(&old_path));
        let added_at = record.added_at.clone();
        assert!(
            added_at.is_some(),
            "new project records need an addedAt value"
        );

        mark_project_opened(&mut record);
        let new_path_key = normalized_path_key(&new_path);
        relocate_record(&mut record, normalized_path_text(&new_path), &new_path_key);

        assert_eq!(record.added_at, added_at);
        assert_eq!(record.path, normalized_path_text(&new_path));
        assert_eq!(
            fs::read(old_path.join(".open-zread/wiki/wiki.json"))
                .expect("renaming the registry location must not move Wiki files"),
            b"catalog"
        );
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn project_rename_validates_name_without_changing_path_or_wiki_files() {
        let root = temporary_root("rename-project");
        let catalog = root.join(".open-zread/wiki/wiki.json");
        create_dir_all(catalog.parent().expect("catalog should have a parent"))
            .expect("Wiki directory should be created");
        write(&catalog, b"unchanged").expect("Wiki catalog should be written");
        let mut record = new_project_record("Before".to_string(), normalized_path_text(&root));
        let path = record.path.clone();
        let added_at = record.added_at.clone();

        set_project_name(&mut record, "  After  ").expect("valid project name should be accepted");
        assert_eq!(record.name, "After");
        assert_eq!(record.path, path);
        assert_eq!(record.added_at, added_at);
        assert_eq!(
            fs::read(&catalog).expect("catalog should remain readable"),
            b"unchanged"
        );
        assert_eq!(
            set_project_name(&mut record, "  ").unwrap_err().code,
            "project_invalid_name"
        );
        assert_eq!(
            set_project_name(&mut record, "bad\nname").unwrap_err().code,
            "project_invalid_name"
        );
        assert_eq!(
            set_project_name(&mut record, &"x".repeat(121))
                .unwrap_err()
                .code,
            "project_invalid_name"
        );
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
            added_at: None,
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
            added_at: None,
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
            added_at: None,
            last_opened_at: None,
        };
        assert_eq!(project_view(&record).wiki.open_zread, "partial");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn catalog_with_one_corrupt_page_entry_is_partial_not_invalid() {
        let root = temporary_root("corrupt-page-entry");
        let wiki_root = root.join(".open-zread/wiki");
        create_dir_all(&wiki_root).expect("wiki directory should be created");
        write(
            wiki_root.join("wiki.json"),
            br#"{"pages":[{"title":"Missing file field"},{"file":"valid.md"}]}"#,
        )
        .expect("catalog should be written");
        write(wiki_root.join("valid.md"), b"# Valid").expect("page should be written");

        let record = ProjectRecord {
            id: "partial-entry".to_string(),
            name: "Partial entry".to_string(),
            path: root.to_string_lossy().into_owned(),
            previous_paths: Vec::new(),
            favorite: false,
            added_at: None,
            last_opened_at: None,
        };
        assert_eq!(project_view(&record).wiki.open_zread, "partial");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn previous_path_history_preserves_unique_locations() {
        let root = temporary_root("previous-paths");
        let current = root.join("current");
        let previous = root.join("previous");
        let mut record = ProjectRecord {
            id: "history".to_string(),
            name: "History".to_string(),
            path: current.to_string_lossy().into_owned(),
            previous_paths: Vec::new(),
            favorite: false,
            added_at: None,
            last_opened_at: None,
        };

        let current_path = record.path.clone();
        append_previous_path(&mut record, &current_path);
        append_previous_path(&mut record, &previous.to_string_lossy());
        append_previous_path(&mut record, &previous.to_string_lossy());

        assert_eq!(
            record.previous_paths,
            vec![previous.to_string_lossy().to_string()]
        );
        remove_dir_all(root).expect("temporary root should be removed");
    }
}
