use crate::contracts::{HubCommandError, HubWikiInstance, HubWikiInstanceList};
use crate::projects::{inspect_open_zread, inspect_zread, project_root, safe_relative_path};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MAX_SCANNED_DIRECTORIES: usize = 20_000;
const SKIPPED_DIRECTORIES: [&str; 8] = [
    ".git",
    "node_modules",
    ".open-zread",
    ".zread",
    "target",
    "dist",
    "build",
    ".next",
];

fn scan_error(message: impl Into<String>, retryable: bool) -> HubCommandError {
    HubCommandError {
        code: "wiki_scan_failed",
        message: message.into(),
        retryable,
    }
}

fn is_reparse_point(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return true;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn normalized_relative(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return Some(".".to_string());
    }
    let text = relative.to_string_lossy().replace('\\', "/");
    safe_relative_path(&text).then_some(text)
}

fn append_instance(
    project_root: &Path,
    source_root: &Path,
    provider: &'static str,
    status: &'static str,
    instances: &mut Vec<HubWikiInstance>,
) {
    let Some(relative) = normalized_relative(project_root, source_root) else {
        return;
    };
    let provider_label = if provider == "open_zread" {
        "OpenZread"
    } else {
        "Zread"
    };
    let root_label = if relative == "." {
        "根目录".to_string()
    } else {
        relative.clone()
    };
    let status = if status == "missing" {
        "invalid"
    } else {
        status
    };
    instances.push(HubWikiInstance {
        wiki_id: format!("{provider}@{relative}"),
        provider,
        source_root: relative,
        label: format!("{root_label} · {provider_label}"),
        status,
    });
}

fn is_real_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    !is_reparse_point(path) && metadata.is_dir()
}

fn contains_reparse_point_below_root(canonical_root: &Path, selected: &Path) -> bool {
    let mut probe = PathBuf::new();
    let mut root_reached = false;
    for component in selected.components() {
        match component {
            std::path::Component::Prefix(_)
            | std::path::Component::RootDir
            | std::path::Component::Normal(_) => probe.push(component.as_os_str()),
            _ => return true,
        }
        if root_reached {
            if is_reparse_point(&probe) {
                return true;
            }
        } else if fs::canonicalize(&probe)
            .map(|canonical| canonical == canonical_root)
            .unwrap_or(false)
        {
            root_reached = true;
        }
    }
    !root_reached
}

fn add_directory_instances(
    project_root: &Path,
    source_root: &Path,
    instances: &mut Vec<HubWikiInstance>,
) {
    let open_root = source_root.join(".open-zread").join("wiki");
    let open_parent = source_root.join(".open-zread");
    if is_real_directory(&open_parent) && is_real_directory(&open_root) {
        append_instance(
            project_root,
            source_root,
            "open_zread",
            inspect_open_zread(source_root),
            instances,
        );
    }
    let zread_root = source_root.join(".zread").join("wiki");
    let zread_parent = source_root.join(".zread");
    if is_real_directory(&zread_parent) && is_real_directory(&zread_root) {
        append_instance(
            project_root,
            source_root,
            "zread",
            inspect_zread(source_root),
            instances,
        );
    }
}

fn scan_project_wikis(
    project_id: &str,
    canonical_root: &Path,
    scan_root: &Path,
) -> Result<HubWikiInstanceList, HubCommandError> {
    scan_project_wikis_with_limit(
        project_id,
        canonical_root,
        scan_root,
        MAX_SCANNED_DIRECTORIES,
    )
}

fn scan_project_wikis_with_limit(
    project_id: &str,
    canonical_root: &Path,
    scan_root: &Path,
    directory_limit: usize,
) -> Result<HubWikiInstanceList, HubCommandError> {
    let mut directories = vec![scan_root.to_path_buf()];
    let mut instances = Vec::new();
    let mut scanned_directories = 0usize;
    let mut scan_complete = true;
    let mut warning = None;

    while let Some(directory) = directories.pop() {
        scanned_directories += 1;
        if scanned_directories > directory_limit {
            scan_complete = false;
            warning = Some(format!(
                "Wiki discovery stopped after {directory_limit} directories. Select a subdirectory or retry."
            ));
            break;
        }

        add_directory_instances(canonical_root, &directory, &mut instances);

        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                scan_complete = false;
                warning.get_or_insert_with(|| {
                    format!("Some directories could not be scanned: {error}")
                });
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                scan_complete = false;
                warning
                    .get_or_insert_with(|| "Some directory entries could not be read.".to_string());
                continue;
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if SKIPPED_DIRECTORIES
                .iter()
                .any(|skipped| name.eq_ignore_ascii_case(skipped))
                || is_reparse_point(&entry.path())
            {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                scan_complete = false;
                warning.get_or_insert_with(|| {
                    "Some directory entries could not be inspected.".to_string()
                });
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let Ok(canonical_child) = fs::canonicalize(entry.path()) else {
                scan_complete = false;
                warning
                    .get_or_insert_with(|| "Some directories could not be resolved.".to_string());
                continue;
            };
            if canonical_child.starts_with(canonical_root) {
                directories.push(canonical_child);
            }
        }
    }

    instances.sort_by(|left, right| {
        left.source_root
            .cmp(&right.source_root)
            .then_with(|| left.provider.cmp(right.provider))
    });
    Ok(HubWikiInstanceList {
        project_id: project_id.to_string(),
        instances,
        scan_complete,
        scanned_directories: scanned_directories.min(directory_limit),
        warning,
    })
}

pub(crate) fn list_project_wikis(
    app: &AppHandle,
    project_id: &str,
) -> Result<HubWikiInstanceList, HubCommandError> {
    let root = project_root(app, project_id)?;
    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| scan_error(format!("Project root cannot be resolved: {error}"), true))?;
    scan_project_wikis(project_id, &canonical_root, &canonical_root)
}

pub(crate) fn locate_project_wikis(
    app: &AppHandle,
    project_id: &str,
    selected_directory: &str,
) -> Result<HubWikiInstanceList, HubCommandError> {
    let root = project_root(app, project_id)?;
    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| scan_error(format!("Project root cannot be resolved: {error}"), true))?;
    let scan_root = validate_scan_root(&canonical_root, Path::new(selected_directory.trim()))?;
    scan_project_wikis(project_id, &canonical_root, &scan_root)
}

fn validate_scan_root(canonical_root: &Path, selected: &Path) -> Result<PathBuf, HubCommandError> {
    if !selected.is_absolute() {
        return Err(scan_error(
            "Select an absolute directory inside the project.",
            false,
        ));
    }
    let canonical_selected = fs::canonicalize(selected).map_err(|error| {
        scan_error(
            format!("The selected directory cannot be resolved: {error}"),
            true,
        )
    })?;
    if !canonical_selected.starts_with(canonical_root) || !canonical_selected.is_dir() {
        return Err(scan_error(
            "The selected directory is outside the project or is not a directory.",
            false,
        ));
    }
    if contains_reparse_point_below_root(canonical_root, selected) {
        return Err(scan_error(
            "Wiki discovery does not follow symbolic links or reparse points.",
            false,
        ));
    }
    Ok(canonical_selected)
}

pub(crate) struct ResolvedWikiInstance {
    pub project_root: PathBuf,
    pub source_root: PathBuf,
    pub provider: &'static str,
    pub wiki_id: String,
}

pub(crate) fn resolve_wiki_instance(
    app: &AppHandle,
    project_id: &str,
    wiki_id: &str,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    let canonical_root = fs::canonicalize(&project_root)
        .map_err(|error| scan_error(format!("Project root cannot be resolved: {error}"), true))?;
    resolve_wiki_instance_from_root(&canonical_root, wiki_id)
}

pub(crate) fn resolve_provider_instance(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    wiki_id: Option<&str>,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    let canonical_root = fs::canonicalize(&project_root)
        .map_err(|error| scan_error(format!("Project root cannot be resolved: {error}"), true))?;
    resolve_provider_instance_from_root(&canonical_root, provider, wiki_id)
}

pub(crate) fn resolve_task_source_root(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    wiki_id: &str,
    require_existing_wiki: bool,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    let canonical_root = fs::canonicalize(&project_root)
        .map_err(|error| scan_error(format!("Project root cannot be resolved: {error}"), true))?;
    resolve_task_source_root_from_root(&canonical_root, provider, wiki_id, require_existing_wiki)
}

fn resolve_task_source_root_from_root(
    canonical_root: &Path,
    provider: &str,
    wiki_id: &str,
    require_existing_wiki: bool,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let expected_provider = match provider.trim() {
        "open_zread" => "open_zread",
        "zread" => "zread",
        _ => {
            return Err(scan_error(
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let source = resolve_wiki_source_root_from_root(&canonical_root, wiki_id)?;
    if source.provider != expected_provider {
        return Err(scan_error(
            "The selected Wiki provider does not match this task.",
            false,
        ));
    }
    if require_existing_wiki {
        return resolve_wiki_instance_from_root(&canonical_root, &source.wiki_id);
    }

    let managed_root = match source.provider {
        "open_zread" => ".open-zread",
        "zread" => ".zread",
        _ => unreachable!(),
    };
    let managed_path = source.source_root.join(managed_root);
    let wiki_path = managed_path.join("wiki");
    for candidate in [&managed_path, &wiki_path] {
        let metadata = match fs::symlink_metadata(candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(scan_error(
                    format!("The selected Wiki output path cannot be inspected: {error}"),
                    true,
                ));
            }
        };
        if metadata.file_type().is_symlink() || is_reparse_point(candidate) {
            return Err(scan_error(
                "The selected Wiki output path contains a symbolic link.",
                true,
            ));
        }
        let canonical = fs::canonicalize(candidate).map_err(|error| {
            scan_error(
                format!("The selected Wiki output path cannot be resolved: {error}"),
                true,
            )
        })?;
        if !canonical.starts_with(&source.source_root) || !canonical.is_dir() {
            return Err(scan_error(
                "The selected Wiki output path is outside its project source.",
                false,
            ));
        }
    }
    Ok(source)
}

fn resolve_provider_instance_from_root(
    canonical_root: &Path,
    provider: &str,
    wiki_id: Option<&str>,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let expected_provider = match provider.trim() {
        "open_zread" => "open_zread",
        "zread" => "zread",
        _ => {
            return Err(scan_error(
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let default_id = format!("{expected_provider}@.");
    let instance = resolve_wiki_instance_from_root(canonical_root, wiki_id.unwrap_or(&default_id))?;
    if instance.provider != expected_provider {
        return Err(scan_error(
            "The selected Wiki provider does not match this instance.",
            false,
        ));
    }
    Ok(instance)
}

fn resolve_wiki_instance_from_root(
    canonical_root: &Path,
    wiki_id: &str,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let instance = resolve_wiki_source_root_from_root(canonical_root, wiki_id)?;
    let managed_root = match instance.provider {
        "open_zread" => ".open-zread",
        "zread" => ".zread",
        _ => unreachable!(),
    };
    let mut wiki_candidate = instance.source_root.join(managed_root);
    if is_reparse_point(&wiki_candidate) {
        return Err(scan_error(
            "The selected Wiki directory no longer exists.",
            true,
        ));
    }
    wiki_candidate.push("wiki");
    if is_reparse_point(&wiki_candidate) {
        return Err(scan_error(
            "The selected Wiki directory no longer exists.",
            true,
        ));
    }
    let canonical_wiki = fs::canonicalize(&wiki_candidate)
        .map_err(|_| scan_error("The selected Wiki directory no longer exists.", true))?;
    if !canonical_wiki.starts_with(&instance.source_root) || !canonical_wiki.is_dir() {
        return Err(scan_error(
            "The selected Wiki directory is outside its project source.",
            false,
        ));
    }
    Ok(instance)
}

fn resolve_wiki_source_root_from_root(
    canonical_root: &Path,
    wiki_id: &str,
) -> Result<ResolvedWikiInstance, HubCommandError> {
    let (provider, relative) = wiki_id
        .split_once('@')
        .ok_or_else(|| scan_error("The selected Wiki instance id is invalid.", false))?;
    let provider = match provider {
        "open_zread" => "open_zread",
        "zread" => "zread",
        _ => {
            return Err(scan_error(
                "The selected Wiki provider is unsupported.",
                false,
            ))
        }
    };
    if relative != "."
        && (!safe_relative_path(relative)
            || relative.contains('\\')
            || relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == ".."))
    {
        return Err(scan_error("The selected Wiki path is invalid.", false));
    }
    let mut source_candidate = canonical_root.to_path_buf();
    if relative != "." {
        for part in relative.split('/') {
            source_candidate.push(part);
            if is_reparse_point(&source_candidate) {
                return Err(scan_error(
                    "The selected Wiki path no longer exists or contains a symbolic link.",
                    true,
                ));
            }
        }
    }
    let source_root = fs::canonicalize(&source_candidate).map_err(|_| {
        scan_error(
            "The selected Wiki directory can no longer be accessed.",
            true,
        )
    })?;
    if !source_root.starts_with(canonical_root) || !source_root.is_dir() {
        return Err(scan_error(
            "The selected Wiki is outside the registered project.",
            false,
        ));
    }
    let source_root_relative = normalized_relative(canonical_root, &source_root)
        .ok_or_else(|| scan_error("The selected Wiki path is invalid.", false))?;
    Ok(ResolvedWikiInstance {
        project_root: canonical_root.to_path_buf(),
        source_root,
        provider,
        wiki_id: format!("{provider}@{source_root_relative}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("open-zread-wikis-{label}-{suffix}"));
        create_dir_all(&root).expect("temporary root should be created");
        root
    }

    fn write_open_zread(root: &Path, title: &str) {
        let wiki = root.join(".open-zread/wiki");
        create_dir_all(&wiki).expect("OpenZread Wiki directory should be created");
        write(
            wiki.join("wiki.json"),
            format!(r#"{{"pages":[{{"title":"{title}","file":"page.md"}}]}}"#),
        )
        .expect("OpenZread catalog should be written");
        write(wiki.join("page.md"), format!("# {title}"))
            .expect("OpenZread page should be written");
    }

    #[test]
    fn discovers_root_and_nested_instances_with_stable_provider_and_directory_ids() {
        let root = temporary_root("discovery");
        write_open_zread(&root, "Root");
        let nested = root.join("framework");
        write_open_zread(&nested, "Framework");
        let zread = root.join("framework/.zread/wiki/versions/v1");
        create_dir_all(&zread).expect("Zread version should be created");
        write(root.join("framework/.zread/wiki/current"), b"versions/v1")
            .expect("Zread pointer should be written");
        write(
            zread.join("wiki.json"),
            br#"{"pages":[{"title":"Zread","file":"page.md"}]}"#,
        )
        .expect("Zread catalog should be written");
        write(zread.join("page.md"), b"# Zread").expect("Zread page should be written");

        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");
        let listing = scan_project_wikis("project", &canonical_root, &canonical_root)
            .expect("Wiki scan should succeed");
        let identities = listing
            .instances
            .iter()
            .map(|instance| instance.wiki_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            identities,
            ["open_zread@.", "open_zread@framework", "zread@framework"]
        );
        assert!(listing.scan_complete);
        assert!(listing
            .instances
            .iter()
            .all(|instance| instance.status == "readable"));
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn targeted_discovery_scans_only_the_selected_subtree_and_keeps_project_relative_ids() {
        let root = temporary_root("targeted-discovery");
        write_open_zread(&root.join("framework"), "Framework");
        write_open_zread(&root.join("systems/combat"), "Combat");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");
        let selected = validate_scan_root(&canonical_root, &root.join("systems"))
            .expect("in-project subdirectory should be accepted");
        let listing = scan_project_wikis("project", &canonical_root, &selected)
            .expect("targeted scan should succeed");
        assert_eq!(listing.instances.len(), 1);
        assert_eq!(listing.instances[0].wiki_id, "open_zread@systems/combat");
        assert_eq!(listing.instances[0].source_root, "systems/combat");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn instance_resolution_rejects_traversal_and_accepts_the_exact_nested_instance() {
        let root = temporary_root("instance-resolution");
        write_open_zread(&root.join("framework"), "Framework");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");
        let resolved = resolve_wiki_instance_from_root(&canonical_root, "open_zread@framework")
            .expect("discovered nested Wiki should resolve");
        assert_eq!(resolved.wiki_id, "open_zread@framework");
        assert_eq!(
            resolved.source_root,
            fs::canonicalize(root.join("framework")).unwrap()
        );
        for invalid_id in [
            "open_zread@../outside",
            "open_zread@framework\\..\\outside",
            "unknown@framework",
            "open_zread@framework/./nested",
        ] {
            assert!(
                resolve_wiki_instance_from_root(&canonical_root, invalid_id).is_err(),
                "invalid instance id should fail: {invalid_id}"
            );
        }
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn provider_resolution_rejects_mismatches_and_missing_explicit_instances_without_fallback() {
        let root = temporary_root("provider-resolution");
        write_open_zread(&root, "Root");
        write_open_zread(&root.join("framework"), "Framework");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let default = resolve_provider_instance_from_root(&canonical_root, "open_zread", None)
            .expect("omitted id should select only the provider root for compatibility");
        assert_eq!(default.wiki_id, "open_zread@.");
        assert!(resolve_provider_instance_from_root(
            &canonical_root,
            "zread",
            Some("open_zread@framework")
        )
        .is_err());
        assert!(resolve_provider_instance_from_root(
            &canonical_root,
            "open_zread",
            Some("open_zread@deleted")
        )
        .is_err());
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn generation_source_resolution_allows_new_wikis_without_allowing_path_escape() {
        let root = temporary_root("generation-source");
        let nested = root.join("framework");
        create_dir_all(&nested).expect("nested source directory should be created");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let target = resolve_task_source_root_from_root(
            &canonical_root,
            "open_zread",
            "open_zread@framework",
            false,
        )
        .expect("generation should be able to create a Wiki in a selected existing source folder");
        assert_eq!(target.wiki_id, "open_zread@framework");
        assert_eq!(target.source_root, fs::canonicalize(&nested).unwrap());
        assert!(
            resolve_task_source_root_from_root(
                &canonical_root,
                "open_zread",
                "open_zread@framework",
                true,
            )
            .is_err(),
            "sync must require an existing Wiki instance"
        );
        assert!(
            resolve_task_source_root_from_root(
                &canonical_root,
                "open_zread",
                "open_zread@../outside",
                false,
            )
            .is_err(),
            "generation must reject a source path outside the project"
        );
        assert!(
            resolve_task_source_root_from_root(
                &canonical_root,
                "zread",
                "open_zread@framework",
                false,
            )
            .is_err(),
            "generation must reject provider/instance mismatches"
        );
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn same_slug_in_root_and_nested_instances_resolves_to_its_own_content() {
        let root = temporary_root("duplicate-slug");
        let nested_root = root.join("framework");
        for (source_root, body) in [(&root, "root body"), (&nested_root, "nested body")] {
            let wiki = source_root.join(".open-zread/wiki");
            create_dir_all(&wiki).expect("Wiki directory should be created");
            write(
                wiki.join("wiki.json"),
                br#"{"pages":[{"slug":"same","title":"Same","file":"same.md"}]}"#,
            )
            .expect("catalog should be written");
            write(wiki.join("same.md"), body).expect("page should be written");
        }
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let root_instance = resolve_wiki_instance_from_root(&canonical_root, "open_zread@.")
            .expect("root instance should resolve");
        let nested_instance =
            resolve_wiki_instance_from_root(&canonical_root, "open_zread@framework")
                .expect("nested instance should resolve");
        let root_document =
            crate::reader::read_open_zread_wiki_from_root(&root_instance.source_root)
                .expect("root Wiki should be readable");
        let nested_document =
            crate::reader::read_open_zread_wiki_from_root(&nested_instance.source_root)
                .expect("nested Wiki should be readable");

        assert_eq!(root_document.pages[0].slug, nested_document.pages[0].slug);
        assert_eq!(root_document.pages[0].content.as_deref(), Some("root body"));
        assert_eq!(
            nested_document.pages[0].content.as_deref(),
            Some("nested body")
        );
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn targeted_discovery_rejects_directories_outside_the_project() {
        let root = temporary_root("targeted-boundary");
        let outside = temporary_root("targeted-outside");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");
        let error = validate_scan_root(&canonical_root, &outside)
            .expect_err("an external directory must not be scanned");
        assert_eq!(error.code, "wiki_scan_failed");
        remove_dir_all(root).expect("temporary root should be removed");
        remove_dir_all(outside).expect("outside fixture should be removed");
    }

    #[test]
    fn directory_budget_returns_partial_results_with_a_specific_warning() {
        let root = temporary_root("directory-budget");
        write_open_zread(&root, "Root");
        create_dir_all(root.join("a/b/c")).expect("nested directories should be created");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let listing = scan_project_wikis_with_limit("project", &canonical_root, &canonical_root, 2)
            .expect("budget-limited scan should still return results");
        assert!(!listing.scan_complete);
        assert_eq!(listing.scanned_directories, 2);
        assert!(listing
            .warning
            .as_deref()
            .unwrap_or_default()
            .contains("2 directories"));
        assert_eq!(listing.instances[0].wiki_id, "open_zread@.");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn discovery_skips_symlinked_project_subdirectories() {
        use std::os::unix::fs::symlink;

        let root = temporary_root("symlink-scan");
        let outside = temporary_root("symlink-target");
        write_open_zread(&outside, "External");
        symlink(&outside, root.join("linked")).expect("directory symlink should be created");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let listing = scan_project_wikis("project", &canonical_root, &canonical_root)
            .expect("Wiki scan should complete while skipping links");
        assert!(listing.instances.is_empty());
        assert!(listing.scan_complete);
        remove_dir_all(root).expect("temporary root should be removed");
        remove_dir_all(outside).expect("outside fixture should be removed");
    }
}
