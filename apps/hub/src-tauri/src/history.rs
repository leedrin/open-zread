use crate::contracts::{HubCommandError, HubWikiHistoryEntry};
use crate::projects::{safe_page_path, safe_relative_path};
use crate::wiki_instances::resolve_provider_instance;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn error(code: &'static str, message: impl Into<String>, retryable: bool) -> HubCommandError {
    HubCommandError {
        code,
        message: message.into(),
        retryable,
    }
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn entry_from_manifest(
    manifest_path: &Path,
    project_id: &str,
    provider: &'static str,
    wiki_id: &str,
) -> Result<HubWikiHistoryEntry, HubCommandError> {
    let value: Value = serde_json::from_str(&fs::read_to_string(manifest_path).map_err(|_| {
        error(
            "wiki_read_failed",
            "The OpenZread history entry could not be read.",
            true,
        )
    })?)
    .map_err(|_| {
        error(
            "wiki_invalid",
            "The OpenZread history entry is invalid.",
            false,
        )
    })?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| safe_history_id(id))
        .ok_or_else(|| {
            error(
                "wiki_invalid",
                "The OpenZread history id is invalid.",
                false,
            )
        })?;
    let created_at = value
        .get("createdAt")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let page_count = value
        .get("pages")
        .and_then(Value::as_array)
        .map(|pages| pages.len() as u32)
        .unwrap_or(0);
    Ok(HubWikiHistoryEntry {
        id: id.to_string(),
        project_id: project_id.to_string(),
        provider,
        wiki_id: wiki_id.to_string(),
        label: format!(
            "{} Hub snapshot {id}",
            if provider == "zread" {
                "Zread"
            } else {
                "OpenZread"
            }
        ),
        created_at,
        current: false,
        page_count,
    })
}

fn safe_history_id(id: &str) -> bool {
    safe_relative_path(id) && Path::new(id).components().count() == 1
}

pub(crate) fn record_open_zread_structure_snapshot(
    root: &Path,
    change_set_id: &str,
    catalog: &[u8],
    entries: &[(String, Option<String>)],
) -> Result<(), HubCommandError> {
    record_wiki_structure_snapshot(root, "open_zread", change_set_id, catalog, entries, None)
}

pub(crate) fn record_wiki_structure_snapshot(
    root: &Path,
    provider: &str,
    change_set_id: &str,
    catalog: &[u8],
    entries: &[(String, Option<String>)],
    version_pointer: Option<&str>,
) -> Result<(), HubCommandError> {
    if !safe_history_id(change_set_id) {
        return Err(error(
            "invalid_request",
            "The Wiki history id is invalid.",
            false,
        ));
    }
    let catalog_value = serde_json::from_slice::<Value>(catalog)
        .map_err(|_| error("wiki_invalid", "The Wiki catalog is not valid JSON.", false))?;
    let wiki_root = match provider {
        "open_zread" => root.join(".open-zread").join("wiki"),
        "zread" => root.join(".zread").join("wiki"),
        _ => {
            return Err(error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let history_root = wiki_root.join(".history");
    let entry_root = history_root.join(change_set_id);
    fs::create_dir_all(&entry_root).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to create Wiki history: {write_error}"),
            true,
        )
    })?;
    let serialized_entries = entries
        .iter()
        .map(|(relative_path, content)| {
            if !safe_relative_path(relative_path) {
                return Err(error(
                    "invalid_request",
                    "The Wiki history path is invalid.",
                    false,
                ));
            }
            Ok(json!({ "relativePath": relative_path, "content": content }))
        })
        .collect::<Result<Vec<_>, HubCommandError>>()?;
    let manifest = json!({
        "id": change_set_id,
        "provider": provider,
        "createdAt": now_millis(),
        "pages": catalog_value.get("pages").cloned().unwrap_or_else(|| json!([])),
        "catalog": String::from_utf8_lossy(catalog),
        "versionPointer": version_pointer,
        "entries": serialized_entries,
    });
    fs::write(
        entry_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|serialization_error| {
            error("internal_error", serialization_error.to_string(), true)
        })?,
    )
    .map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to save Wiki history: {write_error}"),
            true,
        )
    })
}

pub(crate) fn record_wiki_page_snapshot(
    root: &Path,
    provider: &str,
    change_set_id: &str,
    relative_path: &str,
    content: &str,
    expected_version_pointer: Option<&str>,
) -> Result<(), HubCommandError> {
    if !safe_relative_path(relative_path) {
        return Err(error(
            "invalid_request",
            "The Wiki history path is invalid.",
            false,
        ));
    }
    let (active_root, pointer) = match provider {
        "open_zread" => (root.join(".open-zread").join("wiki"), None),
        "zread" => {
            let (version_root, pointer) = zread_versions(root)?;
            if expected_version_pointer != Some(pointer.as_str()) {
                return Err(error(
                    "conflict",
                    "Zread moved to another version before the history snapshot could be recorded.",
                    true,
                ));
            }
            (version_root, Some(pointer))
        }
        _ => {
            return Err(error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let catalog = fs::read(active_root.join("wiki.json")).map_err(|read_error| {
        error(
            "wiki_read_failed",
            format!("Unable to capture the Wiki catalog for history: {read_error}"),
            true,
        )
    })?;
    record_wiki_structure_snapshot(
        root,
        provider,
        change_set_id,
        &catalog,
        &[(relative_path.to_string(), Some(content.to_string()))],
        pointer.as_deref(),
    )
}

fn zread_versions(root: &Path) -> Result<(PathBuf, String), HubCommandError> {
    let wiki_root = root.join(".zread").join("wiki");
    let pointer = fs::read_to_string(wiki_root.join("current"))
        .map_err(|_| {
            error(
                "wiki_invalid",
                "The Zread current pointer could not be read.",
                true,
            )
        })?
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    if !safe_relative_path(&pointer) {
        return Err(error(
            "wiki_invalid",
            "The Zread current pointer is invalid.",
            false,
        ));
    }
    let version_root = safe_page_path(&wiki_root, &[&pointer]).ok_or_else(|| {
        error(
            "wiki_invalid",
            "The Zread current pointer escapes its root.",
            false,
        )
    })?;
    Ok((version_root, pointer))
}

fn zread_entry(
    project_id: &str,
    path: &Path,
    id: &str,
    current_id: &str,
    wiki_id: &str,
) -> Option<HubWikiHistoryEntry> {
    let catalog =
        serde_json::from_str::<Value>(&fs::read_to_string(path.join("wiki.json")).ok()?).ok()?;
    let page_count = catalog
        .get("pages")
        .and_then(Value::as_array)
        .map(|pages| pages.len() as u32)
        .unwrap_or(0);
    Some(HubWikiHistoryEntry {
        id: id.to_string(),
        project_id: project_id.to_string(),
        provider: "zread",
        wiki_id: wiki_id.to_string(),
        label: format!("Zread version {id}"),
        created_at: catalog
            .get("generated_at")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        current: id == current_id,
        page_count,
    })
}

pub(crate) fn list_history(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    wiki_id: Option<&str>,
) -> Result<Vec<HubWikiHistoryEntry>, HubCommandError> {
    let instance = resolve_provider_instance(app, project_id, provider, wiki_id)?;
    let root = instance.source_root;
    let wiki_id = instance.wiki_id;
    let mut entries = match provider {
        "open_zread" => {
            let history_root = root.join(".open-zread").join("wiki").join(".history");
            if !history_root.is_dir() {
                Vec::new()
            } else {
                fs::read_dir(history_root)
                    .map_err(|read_error| error("wiki_read_failed", read_error.to_string(), true))?
                    .filter_map(Result::ok)
                    .filter(|entry| entry.path().is_dir())
                    .filter_map(|entry| {
                        entry_from_manifest(
                            &entry.path().join("manifest.json"),
                            project_id,
                            "open_zread",
                            &wiki_id,
                        )
                        .ok()
                    })
                    .collect()
            }
        }
        "zread" => {
            let (_, current_pointer) = zread_versions(&root)?;
            let versions_root = root.join(".zread").join("wiki").join("versions");
            let history_root = root.join(".zread").join("wiki").join(".history");
            let mut snapshots = if history_root.is_dir() {
                fs::read_dir(history_root)
                    .map_err(|read_error| error("wiki_read_failed", read_error.to_string(), true))?
                    .filter_map(Result::ok)
                    .filter(|entry| entry.path().is_dir())
                    .filter_map(|entry| {
                        entry_from_manifest(
                            &entry.path().join("manifest.json"),
                            project_id,
                            "zread",
                            &wiki_id,
                        )
                        .ok()
                    })
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            if versions_root.is_dir() {
                fs::read_dir(versions_root)
                    .map_err(|read_error| error("wiki_read_failed", read_error.to_string(), true))?
                    .filter_map(Result::ok)
                    .filter(|entry| entry.path().is_dir())
                    .filter_map(|entry| {
                        let id = entry.file_name().to_string_lossy().to_string();
                        zread_entry(
                            project_id,
                            &entry.path(),
                            &format!("versions/{id}"),
                            &current_pointer,
                            &wiki_id,
                        )
                    })
                    .for_each(|entry| snapshots.push(entry));
            }
            snapshots
        }
        _ => {
            return Err(error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(entries)
}

fn restore_open_history(root: &Path, id: &str) -> Result<(), HubCommandError> {
    if !safe_history_id(id) {
        return Err(error(
            "invalid_request",
            "The history id is invalid.",
            false,
        ));
    }
    let manifest_path = root
        .join(".open-zread")
        .join("wiki")
        .join(".history")
        .join(id)
        .join("manifest.json");
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(manifest_path).map_err(|_| {
            error(
                "source_not_found",
                "The history entry was not found.",
                false,
            )
        })?)
        .map_err(|_| error("wiki_invalid", "The history entry is invalid.", false))?;
    if let Some(catalog) = manifest.get("catalog").and_then(Value::as_str) {
        let wiki_root = root.join(".open-zread").join("wiki");
        if let Some(entries) = manifest.get("entries").and_then(Value::as_array) {
            for entry in entries {
                let relative_path = entry
                    .get("relativePath")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        error("wiki_invalid", "The history page path is invalid.", false)
                    })?;
                let target = safe_page_path(&wiki_root, &[relative_path]).ok_or_else(|| {
                    error(
                        "wiki_invalid",
                        "The history page path escapes the Wiki root.",
                        false,
                    )
                })?;
                match entry.get("content") {
                    Some(Value::String(content)) => {
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent).map_err(|write_error| {
                                error("internal_error", write_error.to_string(), true)
                            })?;
                        }
                        fs::write(target, content).map_err(|write_error| {
                            error("internal_error", write_error.to_string(), true)
                        })?;
                    }
                    Some(Value::Null) | None => {
                        let _ = fs::remove_file(target);
                    }
                    _ => {
                        return Err(error(
                            "wiki_invalid",
                            "The history page content is invalid.",
                            false,
                        ))
                    }
                }
            }
        }
        fs::write(wiki_root.join("wiki.json"), catalog).map_err(|write_error| {
            error(
                "internal_error",
                format!("Unable to restore the Wiki catalog: {write_error}"),
                true,
            )
        })?;
        return Ok(());
    }
    for page in manifest
        .get("pages")
        .and_then(Value::as_array)
        .ok_or_else(|| error("wiki_invalid", "The history entry has no pages.", false))?
    {
        let relative_path = page
            .get("relativePath")
            .and_then(Value::as_str)
            .ok_or_else(|| error("wiki_invalid", "The history page path is invalid.", false))?;
        let content = page.get("content").and_then(Value::as_str).ok_or_else(|| {
            error(
                "wiki_invalid",
                "The history page content is invalid.",
                false,
            )
        })?;
        let wiki_root = root.join(".open-zread").join("wiki");
        let target = safe_page_path(&wiki_root, &[relative_path]).ok_or_else(|| {
            error(
                "wiki_invalid",
                "The history page path escapes the Wiki root.",
                false,
            )
        })?;
        fs::write(target, content).map_err(|write_error| {
            error(
                "internal_error",
                format!("Unable to restore the Wiki page: {write_error}"),
                true,
            )
        })?;
    }
    Ok(())
}

fn restore_hub_structure_history(
    root: &Path,
    provider: &str,
    id: &str,
) -> Result<(), HubCommandError> {
    if !safe_history_id(id) {
        return Err(error(
            "invalid_request",
            "The history id is invalid.",
            false,
        ));
    }
    let wiki_root = match provider {
        "open_zread" => root.join(".open-zread").join("wiki"),
        "zread" => root.join(".zread").join("wiki"),
        _ => {
            return Err(error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let manifest_path = wiki_root.join(".history").join(id).join("manifest.json");
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(manifest_path).map_err(|_| {
            error(
                "source_not_found",
                "The Hub history snapshot was not found.",
                false,
            )
        })?)
        .map_err(|_| {
            error(
                "wiki_invalid",
                "The Hub history snapshot is invalid.",
                false,
            )
        })?;
    if manifest
        .get("provider")
        .and_then(Value::as_str)
        .is_some_and(|value| value != provider)
    {
        return Err(error(
            "invalid_request",
            "The history snapshot belongs to another Provider.",
            false,
        ));
    }
    let active_wiki_root = if provider == "zread" {
        let pointer_bytes = fs::read(wiki_root.join("current")).map_err(|_| {
            error(
                "wiki_invalid",
                "The Zread current pointer could not be read.",
                true,
            )
        })?;
        let current_pointer = String::from_utf8_lossy(&pointer_bytes)
            .trim_start_matches('\u{feff}')
            .trim()
            .to_string();
        let snapshot_pointer = manifest
            .get("versionPointer")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                error(
                    "wiki_invalid",
                    "The Zread history snapshot has no version pointer.",
                    false,
                )
            })?;
        if current_pointer != snapshot_pointer {
            return Err(error("conflict", "Zread has moved to another generated version since this snapshot; switch back to that version before restoring the Hub snapshot.", true));
        }
        safe_page_path(&wiki_root, &[snapshot_pointer]).ok_or_else(|| {
            error(
                "wiki_invalid",
                "The snapshot version path is invalid.",
                false,
            )
        })?
    } else {
        wiki_root.clone()
    };
    let catalog = manifest
        .get("catalog")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            error(
                "wiki_invalid",
                "The Hub history snapshot has no catalog contents.",
                false,
            )
        })?;
    let entries = manifest
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            error(
                "wiki_invalid",
                "The Hub history snapshot has no file entries.",
                false,
            )
        })?;
    for entry in entries {
        let relative = entry
            .get("relativePath")
            .and_then(Value::as_str)
            .filter(|path| safe_relative_path(path))
            .ok_or_else(|| error("wiki_invalid", "A history file path is invalid.", false))?;
        let target = safe_page_path(&active_wiki_root, &[relative]).ok_or_else(|| {
            error(
                "wiki_invalid",
                "A history file path escapes its Wiki root.",
                false,
            )
        })?;
        if fs::symlink_metadata(&target)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(error(
                "wiki_invalid",
                "A history target cannot be a symbolic link.",
                false,
            ));
        }
        match entry.get("content") {
            Some(Value::String(content)) => {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|write_error| {
                        error("internal_error", write_error.to_string(), true)
                    })?;
                }
                fs::write(target, content).map_err(|write_error| {
                    error(
                        "internal_error",
                        format!("Unable to restore a Wiki file: {write_error}"),
                        true,
                    )
                })?;
            }
            Some(Value::Null) | None => {
                let _ = fs::remove_file(target);
            }
            _ => {
                return Err(error(
                    "wiki_invalid",
                    "A history file contents entry is invalid.",
                    false,
                ))
            }
        }
    }
    fs::write(active_wiki_root.join("wiki.json"), catalog).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to restore the Wiki catalog: {write_error}"),
            true,
        )
    })?;
    Ok(())
}

fn restore_zread_history(root: &Path, id: &str) -> Result<(), HubCommandError> {
    if !id.starts_with("versions/") {
        return restore_hub_structure_history(root, "zread", id);
    }
    let pointer = id
        .strip_prefix("versions/")
        .ok_or_else(|| error("invalid_request", "The Zread version id is invalid.", false))?;
    if !safe_history_id(pointer) {
        return Err(error(
            "invalid_request",
            "The Zread version id is invalid.",
            false,
        ));
    }
    let wiki_root = root.join(".zread").join("wiki");
    let version_root = safe_page_path(&wiki_root, &["versions", pointer])
        .ok_or_else(|| error("wiki_invalid", "The Zread version path is invalid.", false))?;
    if !version_root.join("wiki.json").is_file() {
        return Err(error(
            "source_not_found",
            "The Zread version was not found.",
            false,
        ));
    }
    fs::write(wiki_root.join("current"), format!("versions/{pointer}\n")).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to restore the Zread current pointer: {write_error}"),
            true,
        )
    })
}

pub(crate) fn restore_history(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    id: &str,
    wiki_id: Option<&str>,
) -> Result<HubWikiHistoryEntry, HubCommandError> {
    let instance = resolve_provider_instance(app, project_id, provider, wiki_id)?;
    let root = instance.source_root;
    let wiki_id = instance.wiki_id;
    match instance.provider {
        "open_zread" => restore_open_history(&root, id)?,
        "zread" => restore_zread_history(&root, id)?,
        _ => {
            return Err(error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    }
    list_history(app, project_id, provider, Some(&wiki_id))?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| {
            error(
                "source_not_found",
                "The restored history entry could not be read.",
                true,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structure_snapshot_restores_catalog_and_created_or_deleted_files() {
        let root =
            std::env::temp_dir().join(format!("open-zread-history-{}", uuid::Uuid::new_v4()));
        let wiki_root = root.join(".open-zread").join("wiki");
        fs::create_dir_all(&wiki_root).expect("wiki root should be created");
        let original_catalog =
            br#"{"pages":[{"slug":"overview","file":"overview.md","section":"Core"}]}"#;
        fs::write(wiki_root.join("wiki.json"), original_catalog)
            .expect("catalog should be written");
        fs::write(wiki_root.join("overview.md"), "# Before\n").expect("page should be written");
        record_open_zread_structure_snapshot(
            &root,
            "change-1",
            original_catalog,
            &[
                ("overview.md".to_string(), Some("# Before\n".to_string())),
                ("new.md".to_string(), None),
            ],
        )
        .expect("snapshot should be recorded");
        fs::write(
            wiki_root.join("wiki.json"),
            br#"{"pages":[{"slug":"new","file":"new.md","section":"Core"}]}"#,
        )
        .expect("changed catalog should be written");
        fs::write(wiki_root.join("new.md"), "# New\n").expect("new page should be written");

        restore_open_history(&root, "change-1").expect("snapshot should restore");
        assert_eq!(
            fs::read(wiki_root.join("wiki.json")).unwrap(),
            original_catalog
        );
        assert_eq!(
            fs::read_to_string(wiki_root.join("overview.md")).unwrap(),
            "# Before\n"
        );
        assert!(!wiki_root.join("new.md").exists());
        fs::remove_dir_all(root).expect("temporary history should be removed");
    }

    #[test]
    fn zread_page_snapshot_is_bound_to_the_active_version_pointer() {
        let root =
            std::env::temp_dir().join(format!("open-zread-zread-history-{}", uuid::Uuid::new_v4()));
        let wiki_root = root.join(".zread").join("wiki");
        let version_root = wiki_root.join("versions").join("v1");
        fs::create_dir_all(&version_root).expect("version root should be created");
        fs::write(wiki_root.join("current"), "versions/v1\n").expect("pointer should be written");
        fs::write(
            version_root.join("wiki.json"),
            br#"{"pages":[{"slug":"overview"}]}"#,
        )
        .expect("catalog should be written");
        fs::write(version_root.join("overview.md"), "# Before").expect("page should be written");

        record_wiki_page_snapshot(
            &root,
            "zread",
            "change-1",
            "overview.md",
            "# Before",
            Some("versions/v1"),
        )
        .expect("active Zread version snapshot should be recorded");
        let manifest: Value = serde_json::from_slice(
            &fs::read(
                wiki_root
                    .join(".history")
                    .join("change-1")
                    .join("manifest.json"),
            )
            .expect("snapshot manifest should be readable"),
        )
        .expect("snapshot manifest should be valid JSON");
        assert_eq!(
            manifest.get("versionPointer").and_then(Value::as_str),
            Some("versions/v1")
        );

        fs::write(wiki_root.join("current"), "versions/v2\n")
            .expect("new pointer should be written");
        let result = record_wiki_page_snapshot(
            &root,
            "zread",
            "change-2",
            "overview.md",
            "# Before",
            Some("versions/v1"),
        );
        assert_eq!(
            result.expect_err("a changed pointer must conflict").code,
            "conflict"
        );
        assert!(!wiki_root.join(".history").join("change-2").exists());
        fs::remove_dir_all(root).expect("temporary history should be removed");
    }
}
