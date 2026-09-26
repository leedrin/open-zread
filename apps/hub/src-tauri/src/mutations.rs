use crate::contracts::{
    HubCommandError, HubWikiChangeSet, HubWikiChangeValidation, HubWikiFileChange,
};
use crate::history::record_wiki_page_snapshot;
use crate::projects::{safe_page_path, safe_relative_path};
use crate::wiki_instances::resolve_provider_instance;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{collections::hash_map::DefaultHasher, hash::Hasher};
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Default, Clone)]
pub struct ChangeSetCoordinator {
    pending: Arc<Mutex<HashMap<String, PendingChange>>>,
}

struct PendingChange {
    change_set: HubWikiChangeSet,
    plan: PendingPlan,
}

enum PendingPlan {
    Text { target: PathBuf },
    Structure(PreparedStructureChange),
}

pub(crate) struct PreparedFileChange {
    pub relative_path: String,
    pub target: PathBuf,
    pub action: &'static str,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

pub(crate) struct PreparedStructureChange {
    pub root: PathBuf,
    pub wiki_root: PathBuf,
    pub catalog_path: PathBuf,
    pub catalog_before: Vec<u8>,
    pub pointer_path: Option<PathBuf>,
    pub pointer_before: Option<Vec<u8>>,
    pub files: Vec<PreparedFileChange>,
}

pub(crate) static WIKI_MUTATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn content_revision(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    format!("{:016x}", hasher.finish())
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
    let canonical_root = fs::canonicalize(page_root).map_err(|_| {
        error(
            "wiki_not_found",
            "The Wiki root could not be resolved.",
            true,
        )
    })?;
    let canonical_target = fs::canonicalize(&target).map_err(|_| {
        error(
            "wiki_not_found",
            "The Wiki page file could not be resolved.",
            true,
        )
    })?;
    if !canonical_target.starts_with(&canonical_root) || !canonical_target.is_file() {
        return Err(error(
            "wiki_invalid",
            "The Wiki page path escapes the Wiki root.",
            false,
        ));
    }
    let relative_path = parts.join("/");
    Ok((canonical_target, relative_path))
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
    wiki_id: Option<&str>,
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
    let instance = resolve_provider_instance(app, project_id, provider, wiki_id)?;
    let canonical_wiki_id = instance.wiki_id;
    let root = instance.source_root;
    let (target, relative_path) = resolve_page(&root, provider, slug)?;
    let before = fs::read_to_string(&target)
        .map_err(|_| error("wiki_read_failed", "The Wiki page could not be read.", true))?;
    let version_pointer = if provider == "zread" {
        Some(
            fs::read_to_string(root.join(".zread").join("wiki").join("current"))
                .map_err(|_| {
                    error(
                        "wiki_invalid",
                        "The Zread current pointer could not be read.",
                        true,
                    )
                })?
                .trim_start_matches('\u{feff}')
                .trim()
                .to_string(),
        )
    } else {
        None
    };
    let revision = content_revision(before.as_bytes());
    let change_set = HubWikiChangeSet {
        change_set_id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        provider: if provider == "zread" {
            "zread"
        } else {
            "open_zread"
        },
        wiki_id: canonical_wiki_id,
        slug: slug.to_string(),
        relative_path: relative_path.clone(),
        before: before.clone(),
        after: after.to_string(),
        status: "preview",
        created_at: now_millis(),
        operation: "edit",
        base_revision: revision.clone(),
        version_pointer,
        files: vec![HubWikiFileChange {
            relative_path,
            action: "update",
            before: Some(before),
            after: Some(after.to_string()),
            base_revision: revision,
        }],
        validation: HubWikiChangeValidation {
            status: "passed",
            checks: vec![
                "目标页面路径位于当前 Wiki 根目录内".to_string(),
                "预览基准内容已记录".to_string(),
            ],
            warnings: Vec::new(),
        },
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
                plan: PendingPlan::Text { target },
                change_set: change_set.clone(),
            },
        );
    Ok(change_set)
}

pub(crate) fn register_structure_change(
    coordinator: &State<'_, ChangeSetCoordinator>,
    project_id: &str,
    provider: &'static str,
    wiki_id: &str,
    slug: &str,
    relative_path: &str,
    operation: &'static str,
    plan: PreparedStructureChange,
    checks: Vec<String>,
    warnings: Vec<String>,
) -> Result<HubWikiChangeSet, HubCommandError> {
    let version_pointer = plan.pointer_before.as_deref().map(|bytes| {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .trim()
            .to_string()
    });
    let files = plan
        .files
        .iter()
        .map(|file| {
            let before = file
                .before
                .as_deref()
                .map(|bytes| {
                    String::from_utf8(bytes.to_vec()).map_err(|_| {
                        error(
                            "wiki_invalid",
                            "A changed Wiki file is not valid UTF-8.",
                            false,
                        )
                    })
                })
                .transpose()?;
            let after = file
                .after
                .as_deref()
                .map(|bytes| {
                    String::from_utf8(bytes.to_vec()).map_err(|_| {
                        error(
                            "wiki_invalid",
                            "A planned Wiki file is not valid UTF-8.",
                            false,
                        )
                    })
                })
                .transpose()?;
            Ok(HubWikiFileChange {
                relative_path: file.relative_path.clone(),
                action: file.action,
                before,
                after,
                base_revision: file
                    .before
                    .as_deref()
                    .map(content_revision)
                    .unwrap_or_else(|| "absent".to_string()),
            })
        })
        .collect::<Result<Vec<_>, HubCommandError>>()?;
    let primary = files
        .iter()
        .find(|file| file.relative_path == relative_path)
        .or_else(|| files.first())
        .ok_or_else(|| {
            error(
                "internal_error",
                "The structural ChangeSet has no file operations.",
                false,
            )
        })?;
    let change_set = HubWikiChangeSet {
        change_set_id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        provider,
        wiki_id: wiki_id.to_string(),
        slug: slug.to_string(),
        relative_path: relative_path.to_string(),
        before: primary.before.clone().unwrap_or_default(),
        after: primary.after.clone().unwrap_or_default(),
        status: "preview",
        created_at: now_millis(),
        operation,
        base_revision: content_revision(&plan.catalog_before),
        version_pointer,
        files,
        validation: HubWikiChangeValidation {
            status: "passed",
            checks,
            warnings,
        },
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
                change_set: change_set.clone(),
                plan: PendingPlan::Structure(plan),
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
        let recovery = match fs::remove_file(target) {
            Ok(()) => fs::rename(&backup, target),
            Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {
                fs::rename(&backup, target)
            }
            Err(remove_error) => Err(remove_error),
        }
        .and_then(|_| fs::read_to_string(target))
        .and_then(|restored| {
            if restored == before {
                Ok(())
            } else {
                Err(std::io::Error::other("restored content did not verify"))
            }
        });
        let message = match recovery {
            Ok(()) => format!("Unable to apply the Wiki ChangeSet; the original page was restored: {write_error}"),
            Err(recovery_error) => format!("Unable to apply the Wiki ChangeSet: {write_error}. Recovery failed ({recovery_error}); original backup remains at {}", backup.display()),
        };
        return Err(error("internal_error", message, true));
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

fn remove_created_directories(directories: &[PathBuf]) {
    for directory in directories.iter().rev() {
        let _ = fs::remove_dir(directory);
    }
}

fn rollback_files(completed: &[(PathBuf, Option<PathBuf>)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (target, backup) in completed.iter().rev() {
        if target.exists() {
            if let Err(remove_error) = fs::remove_file(target) {
                failures.push(format!(
                    "could not remove {}: {remove_error}",
                    target.display()
                ));
                continue;
            }
        }
        if let Some(backup) = backup {
            if let Err(restore_error) = fs::rename(backup, target) {
                failures.push(format!(
                    "could not restore {} from recovery file {}: {restore_error}",
                    target.display(),
                    backup.display()
                ));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn apply_one_file(
    file: &PreparedFileChange,
    change_set_id: &str,
    index: usize,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let parent = file
        .target
        .parent()
        .ok_or_else(|| "The target has no parent directory.".to_string())?;
    let staged = parent.join(format!(".hub-{change_set_id}-{index}.tmp"));
    let backup = parent.join(format!(".hub-{change_set_id}-{index}.bak"));
    if staged.exists() || backup.exists() {
        return Err("A recovery file already exists for this ChangeSet.".to_string());
    }
    if let Some(after) = &file.after {
        fs::write(&staged, after)
            .map_err(|write_error| format!("Unable to stage a Wiki file: {write_error}"))?;
        if fs::read(&staged).map_err(|read_error| read_error.to_string())? != *after {
            let _ = fs::remove_file(&staged);
            return Err("The staged Wiki file failed verification.".to_string());
        }
    }
    let had_original = file.target.exists();
    if had_original {
        if let Err(rename_error) = fs::rename(&file.target, &backup) {
            let _ = fs::remove_file(&staged);
            return Err(format!(
                "Unable to preserve the original Wiki file: {rename_error}"
            ));
        }
    }
    if file.after.is_some() {
        if let Err(rename_error) = fs::rename(&staged, &file.target) {
            let recovery_error = if had_original {
                fs::rename(&backup, &file.target).err()
            } else {
                None
            };
            let _ = fs::remove_file(&staged);
            return Err(match recovery_error {
                Some(recovery) => format!("Unable to install the staged Wiki file: {rename_error}. Original backup remains at {} because recovery failed: {recovery}", backup.display()),
                None => format!("Unable to install the staged Wiki file: {rename_error}"),
            });
        }
    }
    Ok((file.target.clone(), had_original.then_some(backup)))
}

fn verify_structure_preconditions(
    root: &Path,
    change_set: &HubWikiChangeSet,
    plan: &PreparedStructureChange,
) -> Result<(), HubCommandError> {
    let canonical_current_root = fs::canonicalize(root).map_err(|_| {
        error(
            "project_not_found",
            "The project directory could not be resolved.",
            true,
        )
    })?;
    let canonical_planned_root = fs::canonicalize(&plan.root).map_err(|_| {
        error(
            "project_not_found",
            "The previewed project directory no longer exists.",
            true,
        )
    })?;
    if canonical_current_root != canonical_planned_root {
        return Err(error(
            "conflict",
            "The project location changed after preview.",
            true,
        ));
    }
    if plan.catalog_path != plan.wiki_root.join("wiki.json") {
        return Err(error(
            "wiki_invalid",
            "The planned Wiki catalog path is invalid.",
            false,
        ));
    }
    let current_catalog = fs::read(&plan.catalog_path).map_err(|_| {
        error(
            "wiki_read_failed",
            "The Wiki catalog could not be re-read before applying.",
            true,
        )
    })?;
    if current_catalog != plan.catalog_before {
        return Err(error(
            "conflict",
            "The Wiki catalog changed after preview; review the structure change again.",
            true,
        ));
    }
    if let (Some(pointer_path), Some(pointer_before)) = (&plan.pointer_path, &plan.pointer_before) {
        let current_pointer = fs::read(pointer_path).map_err(|_| {
            error(
                "conflict",
                "The Zread version pointer is no longer available.",
                true,
            )
        })?;
        if current_pointer != *pointer_before {
            return Err(error("conflict", "The Zread current version changed after preview; review the structure change again.", true));
        }
        let pointer = String::from_utf8_lossy(pointer_before)
            .trim_start_matches('\u{feff}')
            .trim()
            .to_string();
        let active_root = safe_page_path(&root.join(".zread").join("wiki"), &[&pointer])
            .ok_or_else(|| error("wiki_invalid", "The Zread version path is invalid.", false))?;
        if fs::canonicalize(active_root).ok() != fs::canonicalize(&plan.wiki_root).ok() {
            return Err(error(
                "conflict",
                "The Zread version directory changed after preview.",
                true,
            ));
        }
    } else if change_set.provider == "zread" {
        return Err(error(
            "wiki_invalid",
            "The Zread preview did not capture its current version pointer.",
            false,
        ));
    }
    crate::page_ops::verify_new_path_inside(&plan.wiki_root, &plan.catalog_path)?;
    for file in &plan.files {
        if !safe_relative_path(&file.relative_path) {
            return Err(error(
                "wiki_invalid",
                "A planned Wiki path is invalid.",
                false,
            ));
        }
        let expected = safe_page_path(&plan.wiki_root, &[&file.relative_path])
            .ok_or_else(|| error("wiki_invalid", "A planned Wiki path is invalid.", false))?;
        if expected != file.target {
            return Err(error(
                "conflict",
                "A planned Wiki path no longer resolves to the same file.",
                true,
            ));
        }
        crate::page_ops::verify_new_path_inside(&plan.wiki_root, &file.target)?;
        let actual =
            if file.target.exists() {
                Some(fs::read(&file.target).map_err(|read_error| {
                    error("wiki_read_failed", read_error.to_string(), true)
                })?)
            } else {
                None
            };
        if actual != file.before {
            return Err(error(
                "conflict",
                format!(
                    "The Wiki file '{}' changed after preview; review it again before applying.",
                    file.relative_path
                ),
                true,
            ));
        }
    }
    Ok(())
}

fn apply_structure_change(
    app: &AppHandle,
    root: &Path,
    change_set: &HubWikiChangeSet,
    plan: PreparedStructureChange,
) -> Result<(), HubCommandError> {
    let current_instance = resolve_provider_instance(
        app,
        &change_set.project_id,
        change_set.provider,
        Some(&change_set.wiki_id),
    )?;
    if fs::canonicalize(current_instance.source_root).ok() != fs::canonicalize(root).ok() {
        return Err(error(
            "conflict",
            "The selected Wiki instance location changed after preview.",
            true,
        ));
    }
    verify_structure_preconditions(root, change_set, &plan)?;

    let snapshot_entries = plan
        .files
        .iter()
        .filter(|file| file.relative_path != "wiki.json")
        .map(|file| {
            let content = file
                .before
                .as_deref()
                .map(|bytes| {
                    String::from_utf8(bytes.to_vec()).map_err(|_| {
                        error(
                            "wiki_invalid",
                            "A changed Wiki file is not valid UTF-8.",
                            false,
                        )
                    })
                })
                .transpose()?;
            Ok((file.relative_path.clone(), content))
        })
        .collect::<Result<Vec<_>, HubCommandError>>()?;
    let pointer = plan.pointer_before.as_deref().map(|bytes| {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .trim()
            .to_string()
    });
    crate::history::record_wiki_structure_snapshot(
        root,
        change_set.provider,
        &change_set.change_set_id,
        &plan.catalog_before,
        &snapshot_entries,
        pointer.as_deref(),
    )?;

    let mut created_directories = Vec::<PathBuf>::new();
    let mut completed = Vec::<(PathBuf, Option<PathBuf>)>::new();
    for (index, file) in plan.files.iter().enumerate() {
        if let Some(parent) = file.target.parent() {
            let mut cursor = parent.to_path_buf();
            let mut missing = Vec::new();
            while !cursor.exists() {
                missing.push(cursor.clone());
                let Some(next) = cursor.parent() else { break };
                if next == cursor {
                    break;
                }
                cursor = next.to_path_buf();
            }
            if let Err(create_error) = fs::create_dir_all(parent) {
                let rollback_error = rollback_files(&completed).err();
                remove_created_directories(&created_directories);
                let message = match rollback_error {
                    Some(recovery) => format!("Unable to create a Wiki directory: {create_error}. Rollback was incomplete; recovery details: {recovery}"),
                    None => format!("Unable to create a Wiki directory; earlier file operations were rolled back: {create_error}"),
                };
                return Err(error("internal_error", message, true));
            }
            created_directories.extend(missing);
        }
        match apply_one_file(file, &change_set.change_set_id, index) {
            Ok(applied) => completed.push(applied),
            Err(write_error) => {
                let rollback_error = rollback_files(&completed).err();
                remove_created_directories(&created_directories);
                let message = match rollback_error {
                    Some(recovery) => format!("Unable to apply the ChangeSet: {write_error}. Rollback was incomplete; recovery details: {recovery}"),
                    None => format!("Unable to apply the ChangeSet; earlier file operations were rolled back: {write_error}"),
                };
                return Err(error("internal_error", message, true));
            }
        }
    }
    for (_, backup) in &completed {
        if let Some(backup) = backup {
            let _ = fs::remove_file(backup);
        }
    }
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
    let _guard = WIKI_MUTATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| error("internal_error", "Wiki mutation lock is unavailable.", true))?;
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
    let instance = resolve_provider_instance(
        app,
        &pending.change_set.project_id,
        pending.change_set.provider,
        Some(&pending.change_set.wiki_id),
    )?;
    let root = instance.source_root;
    match pending.plan {
        PendingPlan::Text {
            target: planned_target,
        } => {
            let (target, _) =
                resolve_page(&root, pending.change_set.provider, &pending.change_set.slug)?;
            if target != planned_target {
                return Err(error(
                    "conflict",
                    "The Wiki page path changed after preview.",
                    true,
                ));
            }
            record_wiki_page_snapshot(
                &root,
                pending.change_set.provider,
                change_set_id,
                &pending.change_set.relative_path,
                &pending.change_set.before,
                pending.change_set.version_pointer.as_deref(),
            )?;
            write_with_recovery(
                &target,
                &pending.change_set.before,
                &pending.change_set.after,
                change_set_id,
            )?;
        }
        PendingPlan::Structure(plan) => {
            apply_structure_change(app, &root, &pending.change_set, plan)?;
        }
    }
    Ok(HubWikiChangeSet {
        status: "applied",
        ..pending.change_set
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("open-zread-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

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

    #[test]
    fn structure_preconditions_reject_files_changed_after_preview() {
        let root = temp_root("structure-conflict");
        let wiki_root = root.join(".open-zread").join("wiki");
        fs::create_dir_all(wiki_root.join("Core")).expect("Wiki directory should be created");
        let catalog_path = wiki_root.join("wiki.json");
        let catalog = br#"{"pages":[]}"#.to_vec();
        fs::write(&catalog_path, &catalog).expect("catalog should be written");
        let target = wiki_root.join("Core").join("page.md");
        fs::write(&target, "external edit").expect("target should be written");
        let change_set = HubWikiChangeSet {
            change_set_id: "test-change".to_string(),
            project_id: "test-project".to_string(),
            provider: "open_zread",
            wiki_id: "open_zread@.".to_string(),
            slug: "page".to_string(),
            relative_path: "Core/page.md".to_string(),
            before: "expected".to_string(),
            after: "replacement".to_string(),
            status: "preview",
            created_at: "0".to_string(),
            operation: "metadata",
            base_revision: "catalog-revision".to_string(),
            version_pointer: None,
            files: Vec::new(),
            validation: HubWikiChangeValidation {
                status: "passed",
                checks: Vec::new(),
                warnings: Vec::new(),
            },
        };
        let plan = PreparedStructureChange {
            root: root.clone(),
            wiki_root: wiki_root.clone(),
            catalog_path,
            catalog_before: catalog,
            pointer_path: None,
            pointer_before: None,
            files: vec![PreparedFileChange {
                relative_path: "Core/page.md".to_string(),
                target,
                action: "update",
                before: Some(b"expected".to_vec()),
                after: Some(b"replacement".to_vec()),
            }],
        };
        let result = verify_structure_preconditions(&root, &change_set, &plan);
        assert_eq!(
            result.expect_err("external file edit must conflict").code,
            "conflict"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staged_file_operations_can_be_rolled_back_for_create_update_and_delete() {
        let root = temp_root("structure-rollback");
        let update_target = root.join("update.md");
        fs::write(&update_target, "before").expect("original file should be written");
        let update = PreparedFileChange {
            relative_path: "update.md".to_string(),
            target: update_target.clone(),
            action: "update",
            before: Some(b"before".to_vec()),
            after: Some(b"after".to_vec()),
        };
        let applied = apply_one_file(&update, "rollback-test", 0).expect("update should apply");
        assert_eq!(
            fs::read_to_string(&update_target).expect("updated file should be readable"),
            "after"
        );
        rollback_files(&[applied]).expect("update should roll back cleanly");
        assert_eq!(
            fs::read_to_string(&update_target).expect("rollback should restore original"),
            "before"
        );

        let create_target = root.join("created.md");
        let create = PreparedFileChange {
            relative_path: "created.md".to_string(),
            target: create_target.clone(),
            action: "create",
            before: None,
            after: Some(b"new".to_vec()),
        };
        let applied = apply_one_file(&create, "rollback-test", 1).expect("create should apply");
        assert!(create_target.exists());
        rollback_files(&[applied]).expect("create should roll back cleanly");
        assert!(!create_target.exists());

        let delete = PreparedFileChange {
            relative_path: "update.md".to_string(),
            target: update_target.clone(),
            action: "delete",
            before: Some(b"before".to_vec()),
            after: None,
        };
        let applied = apply_one_file(&delete, "rollback-test", 2).expect("delete should apply");
        assert!(!update_target.exists());
        rollback_files(&[applied]).expect("delete should roll back cleanly");
        assert_eq!(
            fs::read_to_string(&update_target).expect("rollback should restore deleted file"),
            "before"
        );
        let _ = fs::remove_dir_all(root);
    }
}
