use crate::contracts::{
    HubCommandError, HubMarkdownDocument, HubMarkdownFileError, HubMarkdownNode,
    HubProjectMarkdownTree, HubWikiAsset,
};
use crate::projects::{project_root, safe_relative_path};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static MARKDOWN_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const MAX_SCANNED_DIRECTORIES: usize = 20_000;
const MAX_SCANNED_FILES: usize = 20_000;
const MAX_TITLE_BYTES: u64 = 128 * 1024;
const MAX_MARKDOWN_ASSET_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MARKDOWN_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REPORTED_ERRORS: usize = 100;
const MAX_CACHED_MARKDOWN_FILES: usize = 100_000;
const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "bower_components",
    ".open-zread",
    ".zread",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    ".vercel",
    ".angular",
    ".vite",
    ".parcel-cache",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    "coverage",
    ".turbo",
    "storybook-static",
    "Pods",
    "TestResults",
    "vendor",
    "bin",
    "obj",
];

#[derive(Clone, Copy)]
struct MarkdownScanLimits {
    directories: usize,
    files: usize,
}

impl Default for MarkdownScanLimits {
    fn default() -> Self {
        Self {
            directories: MAX_SCANNED_DIRECTORIES,
            files: MAX_SCANNED_FILES,
        }
    }
}

fn scan_error(message: impl Into<String>, retryable: bool) -> HubCommandError {
    HubCommandError {
        code: "markdown_scan_failed",
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

fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn is_reparse_point(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata_is_reparse_point(&metadata))
        .unwrap_or(true)
}

fn is_skipped_directory(name: &str) -> bool {
    SKIPPED_DIRECTORIES
        .iter()
        .any(|skipped| name.eq_ignore_ascii_case(skipped))
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let value = relative.to_string_lossy().replace('\\', "/");
    (!value.is_empty() && safe_relative_path(&value)).then_some(value)
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn unquote_title(value: &str) -> String {
    let value = value.trim();
    let unquoted = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
        .trim();
    unquoted.chars().take(180).collect()
}

fn extract_title(contents: &str) -> Option<String> {
    let contents = contents.trim_start_matches('\u{feff}');
    let mut lines = contents.lines();
    if lines.next()?.trim() == "---" {
        for line in lines.by_ref() {
            let trimmed = line.trim();
            if trimmed == "---" || trimmed == "..." {
                break;
            }
            if let Some((key, value)) = trimmed.split_once(':') {
                if key.trim().eq_ignore_ascii_case("title") {
                    let title = unquote_title(value);
                    if !title.is_empty() {
                        return Some(title);
                    }
                }
            }
        }
    }

    let mut in_fence = false;
    for line in contents.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let heading = trimmed.trim_start_matches('#');
        let level = trimmed.len() - heading.len();
        if (1..=6).contains(&level) && heading.chars().next().is_some_and(char::is_whitespace) {
            let title = heading.trim().trim_end_matches('#').trim();
            if !title.is_empty() {
                return Some(title.chars().take(180).collect());
            }
        }
    }
    None
}

#[derive(Clone)]
struct FileSummary {
    relative_path: String,
    title: String,
    bytes: u64,
    modified_at: Option<String>,
}

#[derive(Clone)]
struct CachedFileSummary {
    bytes: u64,
    modified: SystemTime,
    summary: FileSummary,
}

#[derive(Default)]
pub(crate) struct MarkdownIndexCache {
    entries: Mutex<HashMap<PathBuf, CachedFileSummary>>,
}

fn insert_file(
    nodes: &mut Vec<HubMarkdownNode>,
    segments: &[&str],
    file: &FileSummary,
    parent_path: &str,
) {
    let Some((name, rest)) = segments.split_first() else {
        return;
    };
    if rest.is_empty() {
        nodes.push(HubMarkdownNode {
            kind: "file",
            name: (*name).to_string(),
            relative_path: file.relative_path.clone(),
            title: Some(file.title.clone()),
            bytes: Some(file.bytes),
            modified_at: file.modified_at.clone(),
            children: None,
        });
        return;
    }

    let directory_path = if parent_path.is_empty() {
        (*name).to_string()
    } else {
        format!("{parent_path}/{name}")
    };
    let directory_index = nodes
        .iter()
        .position(|node| node.kind == "directory" && node.name == *name);
    let index = directory_index.unwrap_or_else(|| {
        nodes.push(HubMarkdownNode {
            kind: "directory",
            name: (*name).to_string(),
            relative_path: directory_path.clone(),
            title: None,
            bytes: None,
            modified_at: None,
            children: Some(Vec::new()),
        });
        nodes.len() - 1
    });
    let children = nodes[index].children.get_or_insert_with(Vec::new);
    insert_file(children, rest, file, &directory_path);
}

fn sort_nodes(nodes: &mut [HubMarkdownNode]) {
    nodes.sort_by(|left, right| {
        let kind_order = if left.kind == right.kind {
            std::cmp::Ordering::Equal
        } else if left.kind == "directory" {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        };
        kind_order.then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    for node in nodes {
        if let Some(children) = node.children.as_mut() {
            sort_nodes(children);
        }
    }
}

fn summarize_file(
    root: &Path,
    path: &Path,
    cache: &MarkdownIndexCache,
) -> Result<FileSummary, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("Unable to inspect file: {error}"))?;
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Unable to resolve file: {error}"))?;
    if !canonical.starts_with(root)
        || metadata_is_reparse_point(&metadata)
        || !metadata.file_type().is_file()
    {
        return Err("File is no longer a regular file inside the project.".to_string());
    }
    let rel = relative_path(root, &canonical)
        .ok_or_else(|| "File path is outside the project.".to_string())?;
    let modified = metadata.modified().ok();
    if let Some(modified) = modified {
        let cached = cache
            .entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(&canonical).cloned())
            .filter(|cached| cached.bytes == metadata.len() && cached.modified == modified);
        if let Some(cached) = cached {
            File::open(&canonical)
                .map_err(|error| format!("Unable to read Markdown file: {error}"))?;
            return Ok(cached.summary);
        }
    }
    let mut sample = Vec::new();
    File::open(&canonical)
        .and_then(|file| file.take(MAX_TITLE_BYTES).read_to_end(&mut sample))
        .map_err(|error| format!("Unable to read Markdown file: {error}"))?;
    let contents = match std::str::from_utf8(&sample) {
        Ok(contents) => contents,
        Err(error) if error.error_len().is_none() && metadata.len() > sample.len() as u64 => {
            std::str::from_utf8(&sample[..error.valid_up_to()])
                .expect("a UTF-8 prefix before an incomplete code point is valid")
        }
        Err(_) => return Err("Markdown file is not valid UTF-8 text.".to_string()),
    };
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let title = extract_title(contents).unwrap_or_else(|| {
        Path::new(&name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let modified_at = modified.and_then(|time| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_millis().to_string())
    });
    let summary = FileSummary {
        relative_path: rel,
        title,
        bytes: metadata.len(),
        modified_at,
    };
    if let Some(modified) = modified {
        if let Ok(mut entries) = cache.entries.lock() {
            if entries.len() >= MAX_CACHED_MARKDOWN_FILES && !entries.contains_key(&canonical) {
                entries.clear();
            }
            entries.insert(
                canonical,
                CachedFileSummary {
                    bytes: metadata.len(),
                    modified,
                    summary: summary.clone(),
                },
            );
        }
    }
    Ok(summary)
}

pub(crate) fn read_project_markdown(
    app: &AppHandle,
    project_id: &str,
    relative_path: &str,
) -> Result<HubMarkdownDocument, HubCommandError> {
    if relative_path.contains('\\')
        || !safe_relative_path(relative_path)
        || relative_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(scan_error("Markdown file path is invalid.", false));
    }
    let root = fs::canonicalize(project_root(app, project_id)?).map_err(|error| {
        scan_error(
            format!("Project directory cannot be resolved: {error}"),
            true,
        )
    })?;
    let mut candidate = root.clone();
    for segment in relative_path.split('/') {
        if is_skipped_directory(segment) {
            return Err(scan_error(
                "Markdown path points into an excluded directory.",
                false,
            ));
        }
        candidate.push(segment);
        if is_reparse_point(&candidate) {
            return Err(scan_error(
                "Markdown files inside links or reparse points are not accessible.",
                false,
            ));
        }
    }
    if !is_markdown_file(&candidate) {
        return Err(scan_error(
            "Only .md and .markdown files can be opened here.",
            false,
        ));
    }
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| scan_error(format!("Markdown file is unavailable: {error}"), true))?;
    if !canonical.starts_with(&root)
        || !fs::metadata(&canonical).is_ok_and(|metadata| metadata.is_file())
    {
        return Err(scan_error(
            "Markdown file is outside the registered project.",
            false,
        ));
    }
    let content = fs::read_to_string(&canonical).map_err(|error| {
        scan_error(
            format!("Markdown file could not be read as UTF-8: {error}"),
            true,
        )
    })?;
    let title = extract_title(&content).unwrap_or_else(|| {
        candidate
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let revision = crate::mutations::content_revision(content.as_bytes());
    Ok(HubMarkdownDocument {
        project_id: project_id.to_string(),
        relative_path: relative_path.to_string(),
        title,
        content,
        revision,
    })
}

fn markdown_write_error(
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

fn validate_markdown_revision(current: &[u8], expected: &str) -> Result<(), HubCommandError> {
    if crate::mutations::content_revision(current) == expected {
        return Ok(());
    }
    Err(markdown_write_error(
        "conflict",
        "The Markdown file changed after the draft was opened. Reload or compare it before saving.",
        true,
    ))
}

fn write_synced_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn write_markdown_recovery_snapshot(
    app_data: &Path,
    project_id: &str,
    relative_path: &str,
    original_revision: &str,
    original: &[u8],
) -> Result<(), HubCommandError> {
    let project_key = crate::mutations::content_revision(project_id.as_bytes());
    let path_key = crate::mutations::content_revision(relative_path.as_bytes());
    let snapshot_dir = app_data
        .join("markdown-recovery")
        .join(project_key)
        .join(path_key);
    fs::create_dir_all(&snapshot_dir).map_err(|error| {
        markdown_write_error(
            "snapshot_failed",
            format!("Unable to prepare a recoverable Markdown snapshot: {error}"),
            true,
        )
    })?;
    let snapshot_name = format!("{}-{}.md", now_millis(), Uuid::new_v4());
    let snapshot_path = snapshot_dir.join(&snapshot_name);
    write_synced_file(&snapshot_path, original).map_err(|error| {
        markdown_write_error(
            "snapshot_failed",
            format!("Unable to create a recoverable Markdown snapshot: {error}"),
            true,
        )
    })?;
    let manifest = MarkdownRecoveryManifest {
        project_id,
        relative_path,
        original_revision,
        snapshot_file: &snapshot_name,
        saved_at: now_millis(),
    };
    let manifest_path = snapshot_path.with_extension("json");
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| {
        markdown_write_error(
            "snapshot_failed",
            format!("Unable to describe the Markdown recovery snapshot: {error}"),
            true,
        )
    })?;
    write_synced_file(&manifest_path, &manifest_bytes).map_err(|error| {
        markdown_write_error(
            "snapshot_failed",
            format!("Unable to save Markdown recovery information: {error}"),
            true,
        )
    })
}

fn resolve_markdown_file(root: &Path, relative_path: &str) -> Result<PathBuf, HubCommandError> {
    if relative_path.contains('\\')
        || !safe_relative_path(relative_path)
        || relative_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(markdown_write_error(
            "markdown_invalid_path",
            "Markdown file path is invalid.",
            false,
        ));
    }
    let mut candidate = root.to_path_buf();
    for segment in relative_path.split('/') {
        if is_skipped_directory(segment) {
            return Err(markdown_write_error(
                "markdown_invalid_path",
                "Markdown path points into an excluded directory.",
                false,
            ));
        }
        candidate.push(segment);
        if is_reparse_point(&candidate) {
            return Err(markdown_write_error(
                "markdown_invalid_path",
                "Markdown files inside links or reparse points are not accessible.",
                false,
            ));
        }
    }
    if !is_markdown_file(&candidate) {
        return Err(markdown_write_error(
            "markdown_invalid_path",
            "Only .md and .markdown files can be edited here.",
            false,
        ));
    }
    let canonical = fs::canonicalize(&candidate).map_err(|error| {
        markdown_write_error(
            "conflict",
            format!("Markdown file is no longer available: {error}"),
            true,
        )
    })?;
    if !canonical.starts_with(root)
        || !fs::metadata(&canonical).is_ok_and(|metadata| metadata.is_file())
    {
        return Err(markdown_write_error(
            "markdown_invalid_path",
            "Markdown file is outside the registered project.",
            false,
        ));
    }
    Ok(canonical)
}

fn preserve_markdown_format(before: &[u8], edited: &str) -> Result<Vec<u8>, HubCommandError> {
    let original = std::str::from_utf8(before).map_err(|error| {
        markdown_write_error(
            "markdown_encoding",
            format!("The original Markdown file is not valid UTF-8: {error}"),
            false,
        )
    })?;
    let has_bom = before.starts_with(&[0xef, 0xbb, 0xbf]);
    let original_without_bom = original.strip_prefix('\u{feff}').unwrap_or(original);
    let edited_without_bom = edited.strip_prefix('\u{feff}').unwrap_or(edited);
    let newline = if original_without_bom.contains("\r\n") {
        "\r\n"
    } else if original_without_bom.contains('\r') && !original_without_bom.contains('\n') {
        "\r"
    } else {
        "\n"
    };
    let normalized = edited_without_bom.replace("\r\n", "\n").replace('\r', "\n");
    let formatted = if newline == "\n" {
        normalized
    } else {
        normalized.replace('\n', newline)
    };
    let mut bytes = Vec::with_capacity(formatted.len() + usize::from(has_bom) * 3);
    if has_bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(formatted.as_bytes());
    Ok(bytes)
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownRecoveryManifest<'a> {
    project_id: &'a str,
    relative_path: &'a str,
    original_revision: &'a str,
    snapshot_file: &'a str,
    saved_at: String,
}

pub(crate) fn save_project_markdown(
    app: &AppHandle,
    project_id: &str,
    relative_path: &str,
    base_revision: &str,
    edited_content: &str,
) -> Result<HubMarkdownDocument, HubCommandError> {
    let _guard = MARKDOWN_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| {
            markdown_write_error("internal_error", "Markdown save lock is unavailable.", true)
        })?;
    let root = fs::canonicalize(project_root(app, project_id)?).map_err(|error| {
        markdown_write_error(
            "project_unavailable",
            format!("Project directory cannot be resolved: {error}"),
            true,
        )
    })?;
    let target = resolve_markdown_file(&root, relative_path)?;
    let original = fs::read(&target).map_err(|error| {
        markdown_write_error(
            "markdown_read_failed",
            format!("Markdown file could not be read before saving: {error}"),
            true,
        )
    })?;
    validate_markdown_revision(&original, base_revision)?;
    let updated = preserve_markdown_format(&original, edited_content)?;
    let app_data = app.path().app_data_dir().map_err(|error| {
        markdown_write_error(
            "snapshot_failed",
            format!("Hub application data directory is unavailable: {error}"),
            true,
        )
    })?;
    write_markdown_recovery_snapshot(
        &app_data,
        project_id,
        relative_path,
        base_revision,
        &original,
    )?;

    let original_permissions = fs::metadata(&target)
        .map_err(|error| {
            markdown_write_error(
                "markdown_read_failed",
                format!("Markdown file permissions could not be checked: {error}"),
                true,
            )
        })?
        .permissions();
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    let temporary = target.with_file_name(format!(".{file_name}.hub-edit-{}.tmp", Uuid::new_v4()));
    let staged_result = (|| {
        let mut staged = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        staged.write_all(&updated)?;
        staged.sync_all()?;
        staged.set_permissions(original_permissions)
    })();
    if let Err(error) = staged_result {
        let _ = fs::remove_file(&temporary);
        return Err(markdown_write_error(
            "markdown_write_failed",
            format!("Unable to stage the Markdown update: {error}"),
            true,
        ));
    }

    let validation = (|| {
        let current_root = fs::canonicalize(project_root(app, project_id)?).map_err(|error| {
            markdown_write_error(
                "conflict",
                format!("The project path changed while saving: {error}"),
                true,
            )
        })?;
        if current_root != root {
            return Err(markdown_write_error(
                "conflict",
                "The project path changed while saving. The draft was kept and no file was replaced.",
                true,
            ));
        }
        let latest_target = resolve_markdown_file(&current_root, relative_path)?;
        if latest_target != target {
            return Err(markdown_write_error(
                "conflict",
                "The Markdown file path changed while saving. The draft was kept and no file was replaced.",
                true,
            ));
        }
        let latest = fs::read(&latest_target).map_err(|error| {
            markdown_write_error(
                "conflict",
                format!("The Markdown file became unavailable while saving: {error}"),
                true,
            )
        })?;
        if let Err(error) = validate_markdown_revision(&latest, base_revision) {
            return Err(markdown_write_error(
                "conflict",
                format!(
                    "{} The draft was kept and no file was replaced.",
                    error.message
                ),
                true,
            ));
        }
        Ok(())
    })();
    if let Err(error) = validation {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_file_atomically(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(markdown_write_error(
            "markdown_write_failed",
            format!("Unable to atomically replace the Markdown file. Its recovery snapshot is retained: {error}"),
            true,
        ));
    }
    if let Ok(mut entries) = app.state::<MarkdownIndexCache>().entries.lock() {
        entries.remove(&target);
    }
    read_project_markdown(app, project_id, relative_path)
}

fn resolve_markdown_asset_path(
    canonical_root: &Path,
    document_path: &str,
    asset_path: &str,
) -> Result<(PathBuf, String), HubCommandError> {
    let (canonical_asset, relative_asset) =
        resolve_markdown_relative_file(canonical_root, document_path, asset_path)?;
    if !crate::reader::mime_type(&canonical_asset).starts_with("image/") {
        return Err(HubCommandError {
            code: "asset_invalid_path",
            message: "Only image files can be loaded from Markdown documents.".to_string(),
            retryable: false,
        });
    }
    let metadata = fs::metadata(&canonical_asset).map_err(|_| HubCommandError {
        code: "asset_not_found",
        message: "The Markdown image could not be inspected.".to_string(),
        retryable: true,
    })?;
    if metadata.len() > MAX_MARKDOWN_ASSET_BYTES {
        return Err(HubCommandError {
            code: "asset_invalid_path",
            message: "The Markdown image exceeds the 32 MiB display limit.".to_string(),
            retryable: false,
        });
    }
    Ok((canonical_asset, relative_asset))
}

fn resolve_markdown_relative_file(
    canonical_root: &Path,
    document_path: &str,
    relative_path: &str,
) -> Result<(PathBuf, String), HubCommandError> {
    let invalid_path = || HubCommandError {
        code: "markdown_link_invalid_path",
        message:
            "Markdown links must remain inside the registered project and outside excluded folders."
                .to_string(),
        retryable: false,
    };
    let document_path = document_path.trim();
    if document_path.contains('\\')
        || !safe_relative_path(document_path)
        || document_path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || is_skipped_directory(part)
        })
        || !is_markdown_file(Path::new(document_path))
    {
        return Err(invalid_path());
    }

    let mut document_candidate = canonical_root.to_path_buf();
    for segment in document_path.split('/') {
        document_candidate.push(segment);
        if is_reparse_point(&document_candidate) {
            return Err(invalid_path());
        }
    }
    let canonical_document = fs::canonicalize(&document_candidate).map_err(|_| invalid_path())?;
    if !canonical_document.starts_with(canonical_root) || !canonical_document.is_file() {
        return Err(invalid_path());
    }

    let relative_path = relative_path
        .trim()
        .split(['?', '#'])
        .next()
        .unwrap_or_default();
    if relative_path.is_empty()
        || relative_path.starts_with('/')
        || relative_path.starts_with('\\')
        || relative_path.contains('\\')
        || relative_path.contains(':')
        || relative_path.contains('\0')
    {
        return Err(invalid_path());
    }

    let mut segments = canonical_document
        .parent()
        .and_then(|parent| parent.strip_prefix(canonical_root).ok())
        .map(|parent| {
            parent
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        })
        .ok_or_else(invalid_path)?;
    for segment in relative_path.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                if segments.pop().is_none() {
                    return Err(invalid_path());
                }
            }
            value if is_skipped_directory(value) => return Err(invalid_path()),
            value => segments.push(value.to_string()),
        }
    }
    if segments.is_empty() {
        return Err(invalid_path());
    }

    let normalized_path = segments.join("/");
    let mut candidate = canonical_root.to_path_buf();
    for segment in &segments {
        candidate.push(segment);
        if is_reparse_point(&candidate) {
            return Err(invalid_path());
        }
    }
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|_| HubCommandError {
        code: "markdown_link_not_found",
        message: "The linked project file could not be found or read.".to_string(),
        retryable: false,
    })?;
    if !canonical_candidate.starts_with(canonical_root) || !canonical_candidate.is_file() {
        return Err(invalid_path());
    }
    Ok((canonical_candidate, normalized_path))
}

pub(crate) fn read_project_markdown_asset(
    app: &AppHandle,
    project_id: &str,
    document_path: &str,
    asset_path: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    let canonical_root = fs::canonicalize(project_root(app, project_id)?).map_err(|error| {
        scan_error(
            format!("Project directory cannot be resolved: {error}"),
            true,
        )
    })?;
    let (path, relative_path) =
        resolve_markdown_asset_path(&canonical_root, document_path, asset_path)?;
    let bytes = fs::read(&path).map_err(|error| HubCommandError {
        code: "asset_not_found",
        message: format!("The Markdown image could not be read: {error}"),
        retryable: true,
    })?;
    Ok(HubWikiAsset {
        path: relative_path,
        mime_type: crate::reader::mime_type(&path).to_string(),
        bytes,
    })
}

pub(crate) fn read_project_markdown_source(
    app: &AppHandle,
    project_id: &str,
    document_path: &str,
    source_path: &str,
) -> Result<crate::contracts::HubSourceFile, HubCommandError> {
    let canonical_root = fs::canonicalize(project_root(app, project_id)?).map_err(|error| {
        scan_error(
            format!("Project directory cannot be resolved: {error}"),
            true,
        )
    })?;
    read_project_markdown_source_from_root(&canonical_root, document_path, source_path)
}

fn read_project_markdown_source_from_root(
    canonical_root: &Path,
    document_path: &str,
    source_path: &str,
) -> Result<crate::contracts::HubSourceFile, HubCommandError> {
    let (path, relative_path) =
        resolve_markdown_relative_file(canonical_root, document_path, source_path)?;
    if is_markdown_file(&path) {
        return Err(HubCommandError {
            code: "markdown_link_invalid_path",
            message: "Markdown links must be opened in the Markdown workspace.".to_string(),
            retryable: false,
        });
    }
    let metadata = fs::metadata(&path).map_err(|_| HubCommandError {
        code: "markdown_link_not_found",
        message: "The linked project file could not be inspected.".to_string(),
        retryable: false,
    })?;
    if metadata.len() > MAX_MARKDOWN_SOURCE_BYTES {
        return Err(HubCommandError {
            code: "markdown_link_too_large",
            message: "The linked source file exceeds the 2 MiB preview limit.".to_string(),
            retryable: false,
        });
    }
    let content = fs::read_to_string(&path).map_err(|_| HubCommandError {
        code: "markdown_link_not_text",
        message: "The linked project file is not readable UTF-8 text.".to_string(),
        retryable: false,
    })?;
    if content.contains('\0') {
        return Err(HubCommandError {
            code: "markdown_link_not_text",
            message: "Binary files cannot be opened as source previews.".to_string(),
            retryable: false,
        });
    }
    Ok(crate::contracts::HubSourceFile {
        path: relative_path,
        content,
    })
}

pub(crate) fn scan_project_markdown(
    app: &AppHandle,
    project_id: &str,
) -> Result<HubProjectMarkdownTree, HubCommandError> {
    let registered_root = project_root(app, project_id)?;
    scan_project_markdown_at(
        project_id,
        &registered_root,
        &app.state::<MarkdownIndexCache>(),
    )
}

fn scan_project_markdown_at(
    project_id: &str,
    registered_root: &Path,
    cache: &MarkdownIndexCache,
) -> Result<HubProjectMarkdownTree, HubCommandError> {
    scan_project_markdown_with_limits(
        project_id,
        registered_root,
        cache,
        MarkdownScanLimits::default(),
    )
}

fn scan_project_markdown_with_limits(
    project_id: &str,
    registered_root: &Path,
    cache: &MarkdownIndexCache,
    limits: MarkdownScanLimits,
) -> Result<HubProjectMarkdownTree, HubCommandError> {
    let canonical_root = fs::canonicalize(registered_root).map_err(|error| {
        scan_error(
            format!("Project directory cannot be resolved: {error}"),
            true,
        )
    })?;
    let mut directories = vec![canonical_root.clone()];
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut scanned_directories = 0usize;
    let mut scanned_files = 0usize;
    let mut scan_complete = true;
    let mut warning = None;
    let mut indexed_paths = HashSet::new();

    while let Some(directory) = directories.pop() {
        if scanned_directories >= limits.directories {
            scan_complete = false;
            warning = Some(format!(
                "Markdown 扫描达到 {} 个目录上限，当前结果不完整；可缩小项目范围后重试。",
                limits.directories
            ));
            break;
        }
        scanned_directories += 1;

        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                scan_complete = false;
                warning.get_or_insert_with(|| format!("部分目录无法扫描：{error}"));
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                scan_complete = false;
                warning.get_or_insert_with(|| "部分目录项无法读取。".to_string());
                continue;
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    scan_complete = false;
                    warning.get_or_insert_with(|| format!("部分目录项无法检查：{error}"));
                    continue;
                }
            };
            if metadata_is_reparse_point(&metadata) {
                continue;
            }
            let file_type = metadata.file_type();
            if file_type.is_dir() {
                if is_skipped_directory(&entry.file_name().to_string_lossy()) {
                    continue;
                }
                match fs::canonicalize(&path) {
                    Ok(canonical) if canonical.starts_with(&canonical_root) => {
                        directories.push(canonical)
                    }
                    Ok(_) => {
                        scan_complete = false;
                        warning.get_or_insert_with(|| "发现项目外部目录，已跳过。".to_string());
                    }
                    Err(error) => {
                        scan_complete = false;
                        warning.get_or_insert_with(|| format!("部分目录无法解析：{error}"));
                    }
                }
            } else if file_type.is_file() && is_markdown_file(&path) {
                if scanned_files >= limits.files {
                    scan_complete = false;
                    warning = Some(format!(
                        "Markdown 扫描达到 {} 个文件上限，当前结果不完整；可缩小项目范围后重试。",
                        limits.files
                    ));
                    directories.clear();
                    break;
                }
                scanned_files += 1;
                if let Ok(canonical) = fs::canonicalize(&path) {
                    indexed_paths.insert(canonical);
                }
                match summarize_file(&canonical_root, &path, cache) {
                    Ok(file) => files.push(file),
                    Err(message) => {
                        scan_complete = false;
                        warning.get_or_insert_with(|| {
                            "部分 Markdown 文件无法读取；请查看文件错误详情。".to_string()
                        });
                        if errors.len() < MAX_REPORTED_ERRORS {
                            let relative =
                                relative_path(&canonical_root, &path).unwrap_or_else(|| {
                                    entry.file_name().to_string_lossy().into_owned()
                                });
                            errors.push(HubMarkdownFileError {
                                relative_path: relative,
                                message,
                            });
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut entries) = cache.entries.lock() {
        entries
            .retain(|path, _| !path.starts_with(&canonical_root) || indexed_paths.contains(path));
    }

    files.sort_by(|left, right| {
        left.relative_path
            .to_lowercase()
            .cmp(&right.relative_path.to_lowercase())
    });
    let mut roots = Vec::new();
    for file in &files {
        let segments: Vec<&str> = file.relative_path.split('/').collect();
        insert_file(&mut roots, &segments, file, "");
    }
    sort_nodes(&mut roots);

    Ok(HubProjectMarkdownTree {
        project_id: project_id.to_string(),
        roots,
        scan_complete,
        scanned_directories,
        scanned_files,
        errors,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_title, insert_file, is_markdown_file, is_skipped_directory,
        preserve_markdown_format, read_project_markdown_source_from_root, replace_file_atomically,
        resolve_markdown_asset_path, resolve_markdown_file, scan_project_markdown_at,
        scan_project_markdown_with_limits, sort_nodes, validate_markdown_revision,
        write_markdown_recovery_snapshot, FileSummary, MarkdownIndexCache, MarkdownScanLimits,
    };
    use crate::contracts::HubMarkdownNode;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    fn temporary_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("open-zread-markdown-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture root should be created");
        root
    }

    #[test]
    fn extracts_front_matter_and_heading_titles() {
        assert_eq!(
            extract_title("---\ntitle: 'Project overview'\n---\n# ignored"),
            Some("Project overview".to_string())
        );
        assert_eq!(
            extract_title("```md\n# not a title\n```\n## Actual title ##"),
            Some("Actual title".to_string())
        );
    }

    #[test]
    fn edited_markdown_preserves_utf8_bom_and_newline_convention() {
        let before = [b"\xef\xbb\xbf".as_slice(), b"# Old\r\nparagraph\r\n"].concat();
        let after = preserve_markdown_format(&before, "# New\nparagraph\n")
            .expect("valid UTF-8 draft should be normalized");
        assert_eq!(
            after,
            [b"\xef\xbb\xbf".as_slice(), b"# New\r\nparagraph\r\n"].concat()
        );

        let lf =
            preserve_markdown_format(b"# Old\n", "# New\r\n").expect("LF input should remain LF");
        assert_eq!(lf, b"# New\n");
        assert!(preserve_markdown_format(&[0xff], "# New").is_err());
    }

    #[test]
    fn markdown_replacement_replaces_the_original_file_from_a_sibling_stage() {
        let root = temporary_root();
        let original = root.join("guide.md");
        let staged = root.join(".guide.md.hub-edit.tmp");
        fs::write(&original, "before").expect("original file should exist");
        fs::write(&staged, "after").expect("staged file should exist");

        replace_file_atomically(&staged, &original)
            .expect("sibling stage should atomically replace target");
        assert_eq!(
            fs::read_to_string(&original).expect("updated file should remain readable"),
            "after"
        );
        assert!(!staged.exists());
        fs::remove_dir_all(root).expect("temporary fixture should be removed");
    }

    #[test]
    fn stale_markdown_revision_is_rejected_without_replacing_the_original() {
        let original = b"# Before\n";
        let revision = crate::mutations::content_revision(original);
        assert!(validate_markdown_revision(original, &revision).is_ok());
        let error = validate_markdown_revision(b"# External edit\n", &revision)
            .expect_err("an external edit must conflict");
        assert_eq!(error.code, "conflict");
        assert!(error.message.contains("changed"));
    }

    #[test]
    fn moved_and_excluded_markdown_paths_are_never_resolved_by_filename() {
        let root = temporary_root();
        let docs = root.join("docs");
        fs::create_dir_all(&docs).expect("docs folder should exist");
        fs::write(docs.join("guide.md"), "# Original").expect("source Markdown should exist");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should canonicalize");
        assert!(resolve_markdown_file(&canonical_root, "docs/guide.md").is_ok());
        fs::create_dir_all(docs.join("moved")).expect("moved folder should exist");
        fs::rename(docs.join("guide.md"), docs.join("moved/guide.md"))
            .expect("fixture file should move");
        assert!(resolve_markdown_file(&canonical_root, "docs/guide.md").is_err());
        assert!(resolve_markdown_file(&canonical_root, "../guide.md").is_err());
        assert!(resolve_markdown_file(&canonical_root, ".git/guide.md").is_err());
        fs::remove_dir_all(root).expect("temporary fixture should be removed");
    }

    #[test]
    fn recovery_snapshot_retains_exact_original_bytes_and_manifest_before_replacement() {
        let app_data = temporary_root();
        let original = b"\xef\xbb\xbf# Original\r\n";
        let revision = crate::mutations::content_revision(original);
        write_markdown_recovery_snapshot(
            &app_data,
            "project-1",
            "docs/guide.md",
            &revision,
            original,
        )
        .expect("recovery data should be written before touching the source");

        let snapshots = app_data.join("markdown-recovery");
        let snapshot = fs::read_dir(snapshots)
            .expect("recovery root should exist")
            .next()
            .expect("project recovery folder should exist")
            .expect("project recovery entry should be readable")
            .path();
        let per_path = fs::read_dir(snapshot)
            .expect("per-project recovery folder should exist")
            .next()
            .expect("per-file recovery folder should exist")
            .expect("per-file recovery entry should be readable")
            .path();
        let entries = fs::read_dir(per_path)
            .expect("snapshot files should exist")
            .map(|entry| entry.expect("snapshot entry should be readable").path())
            .collect::<Vec<_>>();
        let snapshot_path = entries
            .iter()
            .find(|path| path.extension().is_some_and(|ext| ext == "md"))
            .expect("original snapshot should exist");
        let manifest_path = snapshot_path.with_extension("json");
        assert_eq!(
            fs::read(snapshot_path).expect("snapshot bytes should be readable"),
            original
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(manifest_path).expect("snapshot manifest should be readable"),
        )
        .expect("manifest should be valid JSON");
        assert_eq!(manifest["projectId"], "project-1");
        assert_eq!(manifest["relativePath"], "docs/guide.md");
        assert_eq!(manifest["originalRevision"], revision);
        fs::remove_dir_all(app_data).expect("temporary fixture should be removed");
    }

    #[test]
    fn failed_atomic_replace_leaves_the_original_intact() {
        let root = temporary_root();
        let original = root.join("guide.md");
        fs::write(&original, "before").expect("original file should exist");
        let revision = crate::mutations::content_revision(b"before");
        write_markdown_recovery_snapshot(&root, "project-1", "guide.md", &revision, b"before")
            .expect("recovery snapshot should be durable before replacement");
        let missing_stage = root.join("missing.tmp");
        assert!(replace_file_atomically(&missing_stage, &original).is_err());
        assert_eq!(
            fs::read_to_string(&original).expect("original should remain readable"),
            "before"
        );
        let recovery_root = root.join("markdown-recovery");
        assert!(
            recovery_root.exists(),
            "recovery snapshot should survive an interrupted replace"
        );
        assert!(fs::read_dir(recovery_root)
            .expect("recovery snapshots should remain readable")
            .next()
            .is_some());
        fs::remove_dir_all(root).expect("temporary fixture should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn locked_markdown_target_reports_a_replace_permission_failure_without_mutation() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = temporary_root();
        let original = root.join("guide.md");
        let staged = root.join(".guide.md.hub-edit.tmp");
        fs::write(&original, "before").expect("original file should exist");
        fs::write(&staged, "after").expect("staged file should exist");
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&original)
            .expect("target should be held without delete sharing");

        let failure = replace_file_atomically(&staged, &original).expect_err(
            "Windows should refuse replacement while another handle denies delete sharing",
        );
        assert!(matches!(
            failure.kind(),
            std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Other
        ));
        drop(locked);
        assert_eq!(
            fs::read(&original).expect("original should remain readable"),
            b"before"
        );
        fs::remove_file(staged).expect("uncommitted stage should be cleaned up");
        fs::remove_dir_all(root).expect("temporary fixture should be removed");
    }

    #[test]
    fn tree_keeps_same_named_files_under_distinct_paths() {
        let mut roots: Vec<HubMarkdownNode> = Vec::new();
        for relative_path in ["README.md", "docs/a/guide.md", "docs/b/guide.md"] {
            let summary = FileSummary {
                relative_path: relative_path.to_string(),
                title: "Guide".to_string(),
                bytes: 1,
                modified_at: None,
            };
            insert_file(
                &mut roots,
                &relative_path.split('/').collect::<Vec<_>>(),
                &summary,
                "",
            );
        }
        sort_nodes(&mut roots);
        let docs = roots.iter().find(|node| node.name == "docs").unwrap();
        let children = docs.children.as_ref().unwrap();
        assert_eq!(children.len(), 2);
        assert!(children
            .iter()
            .all(|node| node.children.as_ref().unwrap()[0].name == "guide.md"));
        assert!(roots.iter().any(|node| node.relative_path == "README.md"));
    }

    #[test]
    fn discovery_filters_markdown_extensions_and_managed_directories() {
        assert!(is_markdown_file(Path::new("README.MD")));
        assert!(is_markdown_file(Path::new("guide.MarkDown")));
        assert!(!is_markdown_file(Path::new("guide.txt")));
        assert!(is_skipped_directory(".OPEN-ZREAD"));
        assert!(is_skipped_directory(".ZREAD"));
        assert!(is_skipped_directory("node_modules"));
        assert!(is_skipped_directory(".Svelte-Kit"));
        assert!(is_skipped_directory("storybook-static"));
        assert!(!is_skipped_directory("docs"));
    }

    fn collect_markdown_paths(nodes: &[HubMarkdownNode], paths: &mut Vec<String>) {
        for node in nodes {
            if node.kind == "file" {
                paths.push(node.relative_path.clone());
            }
            if let Some(children) = &node.children {
                collect_markdown_paths(children, paths);
            }
        }
    }

    #[test]
    fn scanner_finds_root_nested_and_same_named_markdown_with_stable_relative_paths() {
        let root = temporary_root();
        for directory in [
            "docs/a",
            "docs/b",
            ".git",
            ".open-zread/wiki",
            ".zread/wiki",
            "node_modules/package",
            "dist/generated",
            "target/generated",
            ".svelte-kit/generated",
        ] {
            fs::create_dir_all(root.join(directory)).expect("fixture directory should be created");
        }
        for file in [
            "README.MD",
            "docs/a/guide.markdown",
            "docs/b/guide.md",
            ".git/ignored.md",
            ".open-zread/wiki/ignored.md",
            ".zread/wiki/ignored.md",
            "node_modules/package/ignored.md",
            "dist/generated/ignored.md",
            "target/generated/ignored.md",
            ".svelte-kit/generated/ignored.md",
        ] {
            fs::write(
                root.join(file),
                format!(
                    "# {}\n",
                    Path::new(file).file_stem().unwrap().to_string_lossy()
                ),
            )
            .expect("fixture Markdown should be written");
        }

        let cache = MarkdownIndexCache::default();
        let tree = scan_project_markdown_at("project", &root, &cache)
            .expect("project Markdown should be scanned");
        let mut paths = Vec::new();
        collect_markdown_paths(&tree.roots, &mut paths);
        paths.sort();

        assert_eq!(tree.project_id, "project");
        assert!(tree.scan_complete);
        assert_eq!(tree.scanned_files, 3);
        assert_eq!(
            paths,
            ["README.MD", "docs/a/guide.markdown", "docs/b/guide.md"]
        );
        let docs = tree.roots.iter().find(|node| node.name == "docs").unwrap();
        assert_eq!(docs.kind, "directory");
        assert_eq!(docs.relative_path, "docs");

        assert_eq!(cache.entries.lock().unwrap().len(), 3);
        let cached_tree = scan_project_markdown_at("project", &root, &cache)
            .expect("unchanged project Markdown should reuse its index summaries");
        let mut cached_paths = Vec::new();
        collect_markdown_paths(&cached_tree.roots, &mut cached_paths);
        cached_paths.sort();
        assert_eq!(cached_paths, paths);

        fs::write(
            root.join("docs/a/guide.markdown"),
            "# A much longer changed title\n",
        )
        .expect("changed document should be written");
        let refreshed_tree = scan_project_markdown_at("project", &root, &cache)
            .expect("changed project Markdown should be rescanned");
        let docs = refreshed_tree
            .roots
            .iter()
            .find(|node| node.name == "docs")
            .unwrap();
        let directory_a = docs
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|node| node.name == "a")
            .unwrap();
        assert_eq!(
            directory_a.children.as_ref().unwrap()[0].title.as_deref(),
            Some("A much longer changed title")
        );
        fs::remove_dir_all(root).expect("fixture should be removed");
    }

    #[test]
    fn scanner_reports_invalid_utf8_for_one_file_without_blocking_other_documents() {
        let root = temporary_root();
        fs::write(root.join("good.md"), "# Good").expect("valid document should be written");
        fs::write(root.join("broken.md"), [0x23, 0x20, 0xff])
            .expect("invalid UTF-8 document should be written");
        let cache = MarkdownIndexCache::default();

        let tree = scan_project_markdown_at("project", &root, &cache)
            .expect("a damaged page should not fail the whole scan");
        let mut paths = Vec::new();
        collect_markdown_paths(&tree.roots, &mut paths);

        assert!(!tree.scan_complete);
        assert_eq!(paths, ["good.md"]);
        assert_eq!(tree.errors.len(), 1);
        assert_eq!(tree.errors[0].relative_path, "broken.md");
        assert!(tree.errors[0].message.contains("UTF-8"));
        assert!(tree.warning.is_some());
        fs::remove_dir_all(root).expect("fixture should be removed");
    }

    #[test]
    fn scanner_returns_partial_results_with_specific_directory_and_file_budget_warnings() {
        let root = temporary_root();
        fs::create_dir_all(root.join("nested/deeper"))
            .expect("nested directories should be created");
        for file in ["one.md", "two.md", "nested/deeper/three.md"] {
            fs::write(root.join(file), "# Page").expect("fixture document should be written");
        }

        let directory_limited = scan_project_markdown_with_limits(
            "project",
            &root,
            &MarkdownIndexCache::default(),
            MarkdownScanLimits {
                directories: 1,
                files: 100,
            },
        )
        .expect("directory-limited scan should return partial results");
        assert!(!directory_limited.scan_complete);
        assert!(directory_limited
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("1 个目录上限")));

        let file_limited = scan_project_markdown_with_limits(
            "project",
            &root,
            &MarkdownIndexCache::default(),
            MarkdownScanLimits {
                directories: 100,
                files: 1,
            },
        )
        .expect("file-limited scan should return partial results");
        assert!(!file_limited.scan_complete);
        assert!(file_limited
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("1 个文件上限")));
        assert_eq!(file_limited.scanned_files, 1);
        fs::remove_dir_all(root).expect("fixture should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn scanner_does_not_follow_symlinked_directories_or_markdown_files() {
        use std::os::unix::fs::symlink;

        let root = temporary_root();
        let outside = temporary_root();
        fs::write(root.join("local.md"), "# Local").expect("local document should be written");
        fs::write(outside.join("external.md"), "# External")
            .expect("external document should be written");
        symlink(&outside, root.join("linked-directory"))
            .expect("directory symlink should be created");
        symlink(outside.join("external.md"), root.join("linked-file.md"))
            .expect("file symlink should be created");

        let cache = MarkdownIndexCache::default();
        let tree = scan_project_markdown_at("project", &root, &cache)
            .expect("project Markdown should be scanned");
        let mut paths = Vec::new();
        collect_markdown_paths(&tree.roots, &mut paths);
        assert_eq!(paths, ["local.md"]);
        fs::remove_dir_all(root).expect("project fixture should be removed");
        fs::remove_dir_all(outside).expect("external fixture should be removed");
    }

    #[test]
    fn markdown_assets_resolve_from_the_document_directory_and_reject_escapes() {
        let root = temporary_root();
        fs::create_dir_all(root.join("docs")).expect("docs directory should be created");
        fs::create_dir_all(root.join("assets")).expect("asset directory should be created");
        fs::create_dir_all(root.join("src")).expect("source directory should be created");
        fs::create_dir_all(root.join(".open-zread/wiki"))
            .expect("managed provider directory should be created");
        fs::write(root.join("docs/guide.md"), "# Guide").expect("document should be written");
        fs::write(root.join("assets/diagram.png"), [137, 80, 78, 71])
            .expect("image should be written");
        fs::write(root.join("docs/plain.md"), "# Not an image")
            .expect("non-image should be written");
        fs::write(root.join("src/main.lua"), "local answer = 42\n")
            .expect("source file should be written");
        fs::write(root.join("src/binary.bin"), [0, 159, 146, 150])
            .expect("binary file should be written");
        let canonical_root = fs::canonicalize(&root).expect("fixture root should resolve");

        let (image, relative) = resolve_markdown_asset_path(
            &canonical_root,
            "docs/guide.md",
            "../assets/diagram.png#preview",
        )
        .expect("relative project image should resolve");
        assert_eq!(
            image,
            fs::canonicalize(root.join("assets/diagram.png")).unwrap()
        );
        assert_eq!(relative, "assets/diagram.png");

        for invalid in [
            "../../outside.png",
            "../../.open-zread/wiki/page.png",
            "C:/outside.png",
            "\\\\server\\share\\image.png",
            "plain.md",
        ] {
            assert!(
                resolve_markdown_asset_path(&canonical_root, "docs/guide.md", invalid).is_err(),
                "invalid asset path should fail: {invalid}"
            );
        }
        assert!(resolve_markdown_asset_path(
            &canonical_root,
            "../guide.md",
            "../assets/diagram.png"
        )
        .is_err());
        let source = read_project_markdown_source_from_root(
            &canonical_root,
            "docs/guide.md",
            "../src/main.lua#start",
        )
        .expect("relative source should be available for preview");
        assert_eq!(source.path, "src/main.lua");
        assert_eq!(source.content, "local answer = 42\n");
        for invalid in [
            "../docs/plain.md",
            "../src/binary.bin",
            "../../outside.lua",
            "../.open-zread/wiki/page.lua",
            "../src/missing.lua",
        ] {
            assert!(
                read_project_markdown_source_from_root(&canonical_root, "docs/guide.md", invalid,)
                    .is_err(),
                "invalid source path should fail: {invalid}"
            );
        }
        fs::remove_dir_all(root).expect("fixture root should be removed");
    }
}
