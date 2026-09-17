use crate::contracts::{HubCommandError, HubWikiHistoryEntry};
use crate::projects::{project_root, safe_page_path, safe_relative_path};
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
        provider: "open_zread",
        label: format!("OpenZread change {id}"),
        created_at,
        current: false,
        page_count,
    })
}

fn safe_history_id(id: &str) -> bool {
    safe_relative_path(id) && Path::new(id).components().count() == 1
}

pub(crate) fn record_open_zread_page(
    root: &Path,
    change_set_id: &str,
    slug: &str,
    relative_path: &str,
    content: &str,
) -> Result<(), HubCommandError> {
    if !safe_history_id(change_set_id) || !safe_relative_path(relative_path) {
        return Err(error(
            "invalid_request",
            "The Wiki history path is invalid.",
            false,
        ));
    }
    let history_root = root.join(".open-zread").join("wiki").join(".history");
    let entry_root = history_root.join(change_set_id);
    fs::create_dir_all(&entry_root).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to create Wiki history: {write_error}"),
            true,
        )
    })?;
    fs::write(
        entry_root.join("manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "id": change_set_id,
            "createdAt": now_millis(),
            "pages": [{ "slug": slug, "relativePath": relative_path, "content": content }]
        }))
        .map_err(|serialization_error| {
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

pub(crate) fn record_open_zread_structure_snapshot(
    root: &Path,
    change_set_id: &str,
    catalog: &[u8],
    entries: &[(String, Option<String>)],
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
    let history_root = root.join(".open-zread").join("wiki").join(".history");
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
        "createdAt": now_millis(),
        "pages": catalog_value.get("pages").cloned().unwrap_or_else(|| json!([])),
        "catalog": String::from_utf8_lossy(catalog),
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
) -> Result<Vec<HubWikiHistoryEntry>, HubCommandError> {
    let root = project_root(app, project_id)?;
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
                        entry_from_manifest(&entry.path().join("manifest.json"), project_id).ok()
                    })
                    .collect()
            }
        }
        "zread" => {
            let (_, current_pointer) = zread_versions(&root)?;
            let versions_root = root.join(".zread").join("wiki").join("versions");
            if !versions_root.is_dir() {
                Vec::new()
            } else {
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
                        )
                    })
                    .collect()
            }
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
}

fn restore_zread_history(root: &Path, id: &str) -> Result<(), HubCommandError> {
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
) -> Result<HubWikiHistoryEntry, HubCommandError> {
    let root = project_root(app, project_id)?;
    match provider {
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
    list_history(app, project_id, provider)?
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
