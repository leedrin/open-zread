use crate::contracts::{HubCommandError, HubWikiChangeSet};
use crate::history::record_open_zread_page;
use crate::projects::{project_root, safe_page_path, safe_relative_path};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Default, Clone)]
pub struct ChangeSetCoordinator {
    pending: Arc<Mutex<HashMap<String, PendingChange>>>,
}

struct PendingChange {
    change_set: HubWikiChangeSet,
    target: PathBuf,
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn error(code: &'static str, message: impl Into<String>, retryable: bool) -> HubCommandError {
    HubCommandError {
        code,
        message: message.into(),
        retryable,
    }
}

fn catalog_page_path(
    catalog_path: &Path,
    page_root: &Path,
    slug: &str,
    flat_pages: bool,
) -> Result<(PathBuf, String), HubCommandError> {
    let contents = fs::read_to_string(catalog_path).map_err(|_| {
        error(
            "wiki_not_found",
            "The Wiki catalog could not be read.",
            true,
        )
    })?;
    let catalog: Value = serde_json::from_str(&contents)
        .map_err(|_| error("wiki_invalid", "The Wiki catalog is not valid JSON.", false))?;
    let pages = catalog
        .get("pages")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            error(
                "wiki_invalid",
                "The Wiki catalog has no pages array.",
                false,
            )
        })?;
    let page = pages
        .iter()
        .find(|page| page.get("slug").and_then(Value::as_str) == Some(slug))
        .ok_or_else(|| {
            error(
                "source_not_found",
                format!("Wiki page '{slug}' was not found."),
                false,
            )
        })?;
    let file = page
        .get("file")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| error("wiki_invalid", "The Wiki page file path is invalid.", false))?;
    let section = if flat_pages {
        None
    } else {
        page.get("section").and_then(Value::as_str)
    };
    let parts = section
        .into_iter()
        .chain(std::iter::once(file))
        .collect::<Vec<_>>();
    let target = safe_page_path(page_root, &parts).ok_or_else(|| {
        error(
            "wiki_invalid",
            "The Wiki page path escapes its root.",
            false,
        )
    })?;
    if !target.is_file() {
        return Err(error(
            "wiki_not_found",
            "The Wiki page file could not be read.",
            true,
        ));
    }
    let relative_path = parts.join("/");
    Ok((target, relative_path))
}

fn resolve_page(
    root: &Path,
    provider: &str,
    slug: &str,
) -> Result<(PathBuf, String), HubCommandError> {
    match provider {
        "open_zread" => {
            let wiki_root = root.join(".open-zread").join("wiki");
            catalog_page_path(&wiki_root.join("wiki.json"), &wiki_root, slug, false)
        }
        "zread" => {
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
            catalog_page_path(&version_root.join("wiki.json"), &version_root, slug, true)
        }
        _ => Err(error(
            "invalid_request",
            "Wiki provider must be open_zread or zread.",
            false,
        )),
    }
}

pub(crate) fn preview_change(
    app: &AppHandle,
    coordinator: &State<'_, ChangeSetCoordinator>,
    project_id: &str,
    provider: &str,
    slug: &str,
    after: &str,
) -> Result<HubWikiChangeSet, HubCommandError> {
    let project_id = project_id.trim();
    let provider = provider.trim();
    let slug = slug.trim();
    if project_id.is_empty() || provider.is_empty() || slug.is_empty() {
        return Err(error(
            "invalid_request",
            "Project id, provider, and page slug are required.",
            false,
        ));
    }
    let root = project_root(app, project_id)?;
    let (target, relative_path) = resolve_page(&root, provider, slug)?;
    let before = fs::read_to_string(&target)
        .map_err(|_| error("wiki_read_failed", "The Wiki page could not be read.", true))?;
    let change_set = HubWikiChangeSet {
        change_set_id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        provider: if provider == "zread" {
            "zread"
        } else {
            "open_zread"
        },
        slug: slug.to_string(),
        relative_path,
        before,
        after: after.to_string(),
        status: "preview",
        created_at: now_millis(),
    };
    coordinator
        .pending
        .lock()
        .map_err(|_| {
            error(
                "internal_error",
                "ChangeSet coordinator is unavailable.",
                true,
            )
        })?
        .insert(
            change_set.change_set_id.clone(),
            PendingChange {
                target,
                change_set: change_set.clone(),
            },
        );
    Ok(change_set)
}

fn write_with_recovery(
    target: &Path,
    before: &str,
    after: &str,
    change_set_id: &str,
) -> Result<(), HubCommandError> {
    let current = fs::read_to_string(target).map_err(|_| {
        error(
            "wiki_read_failed",
            "The Wiki page could not be re-read before applying the ChangeSet.",
            true,
        )
    })?;
    if current != before {
        return Err(error(
            "conflict",
            "The Wiki page changed after the ChangeSet preview; review it again before applying.",
            true,
        ));
    }
    let backup = target.with_file_name(format!(
        ".{}.hub-backup-{}",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("page.md"),
        change_set_id
    ));
    fs::write(&backup, before).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to create a recoverable Wiki backup: {write_error}"),
            true,
        )
    })?;
    let result = fs::write(target, after)
        .and_then(|_| {
            fs::read_to_string(target).map(|written| {
                if written == after {
                    Ok(())
                } else {
                    Err(std::io::Error::other("written content did not verify"))
                }
            })
        })
        .and_then(|result| result);
    if let Err(write_error) = result {
        let _ = fs::write(target, before);
        let _ = fs::remove_file(&backup);
        return Err(error(
            "internal_error",
            format!(
                "Unable to apply the Wiki ChangeSet; the original page was restored: {write_error}"
            ),
            true,
        ));
    }
    fs::remove_file(backup).map_err(|remove_error| {
        error("internal_error", format!("The Wiki page was written, but its recovery backup could not be removed: {remove_error}"), true)
    })?;
    Ok(())
}

pub(crate) fn apply_change(
    app: &AppHandle,
    coordinator: &State<'_, ChangeSetCoordinator>,
    change_set_id: &str,
) -> Result<HubWikiChangeSet, HubCommandError> {
    let change_set_id = change_set_id.trim();
    if change_set_id.is_empty() {
        return Err(error("invalid_request", "ChangeSet id is required.", false));
    }
    let pending = coordinator
        .pending
        .lock()
        .map_err(|_| {
            error(
                "internal_error",
                "ChangeSet coordinator is unavailable.",
                true,
            )
        })?
        .remove(change_set_id)
        .ok_or_else(|| {
            error(
                "source_not_found",
                "The ChangeSet is no longer pending.",
                false,
            )
        })?;
    let root = project_root(app, &pending.change_set.project_id)?;
    let (target, _) = resolve_page(&root, pending.change_set.provider, &pending.change_set.slug)?;
    if target != pending.target {
        return Err(error(
            "conflict",
            "The Wiki page path changed after preview.",
            true,
        ));
    }
    if pending.change_set.provider == "open_zread" {
        record_open_zread_page(
            &root,
            change_set_id,
            &pending.change_set.slug,
            &pending.change_set.relative_path,
            &pending.change_set.before,
        )?;
    }
    write_with_recovery(
        &target,
        &pending.change_set.before,
        &pending.change_set.after,
        change_set_id,
    )?;
    Ok(HubWikiChangeSet {
        status: "applied",
        ..pending.change_set
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_paths_are_rejected_when_the_catalog_escapes_root() {
        let root = std::env::temp_dir().join(format!("open-zread-change-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test root should be created");
        let catalog = root.join("wiki.json");
        fs::write(
            &catalog,
            r#"{"pages":[{"slug":"bad","file":"..\\outside.md"}]}"#,
        )
        .expect("catalog should be written");
        let result = catalog_page_path(&catalog, &root, "bad", true);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
