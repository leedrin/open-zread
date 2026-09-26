use crate::contracts::{
    HubCommandError, HubOpenZreadWiki, HubSourceFile, HubWikiAsset, HubWikiCatalog, HubWikiPage,
};
use crate::projects::{project_root, safe_page_path, safe_relative_path};
use crate::wiki_instances::resolve_wiki_instance;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn reader_error(
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

fn wiki_root(project_root: &Path) -> PathBuf {
    project_root.join(".open-zread").join("wiki")
}

fn object_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn associated_files(object: &Map<String, Value>) -> Vec<String> {
    object
        .get("associatedFiles")
        .or_else(|| object.get("sourceRefs"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn page_path(wiki_root: &Path, section: &str, file: &str) -> Option<PathBuf> {
    let section_candidate = if section.is_empty() {
        None
    } else {
        safe_page_path(wiki_root, &[section, file])
    };

    if section_candidate
        .as_ref()
        .is_some_and(|path| path.is_file())
    {
        return section_candidate;
    }

    let direct_candidate = safe_page_path(wiki_root, &[file]);
    if direct_candidate.as_ref().is_some_and(|path| path.is_file()) {
        return direct_candidate;
    }

    section_candidate.or(direct_candidate)
}

fn malformed_page(index: usize, raw: Value, error: &str) -> HubWikiPage {
    HubWikiPage {
        slug: format!("page-{}", index + 1),
        title: format!("Page {}", index + 1),
        file: format!("page-{}.md", index + 1),
        section: "Uncategorized".to_string(),
        group: None,
        level: None,
        associated_files: Vec::new(),
        status: "unreadable",
        content: None,
        error: Some(error.to_string()),
        native: raw,
    }
}

fn read_page(index: usize, raw: Value, wiki_root: &Path) -> HubWikiPage {
    let Some(object) = raw.as_object() else {
        return malformed_page(index, raw, "The catalog page entry is not an object.");
    };

    let slug = object_string(object, "slug").unwrap_or_else(|| format!("page-{}", index + 1));
    let title = object_string(object, "title").unwrap_or_else(|| format!("Page {}", index + 1));
    let file = object_string(object, "file").unwrap_or_else(|| format!("page-{}.md", index + 1));
    let section = object_string(object, "section").unwrap_or_else(|| "Uncategorized".to_string());
    let group = object_string(object, "group");
    let level = object_string(object, "level");
    let associated_files = associated_files(object);

    let (status, content, error) = if let Some(path) = page_path(wiki_root, &section, &file) {
        match fs::read_to_string(path) {
            Ok(content) => ("readable", Some(content), None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
                "missing",
                None,
                Some("The Markdown page is missing.".to_string()),
            ),
            Err(_) => (
                "unreadable",
                None,
                Some("The Markdown page could not be read.".to_string()),
            ),
        }
    } else {
        (
            "unreadable",
            None,
            Some("The catalog page path is outside the Project Wiki.".to_string()),
        )
    };

    HubWikiPage {
        slug,
        title,
        file,
        section,
        group,
        level,
        associated_files,
        status,
        content,
        error,
        native: raw,
    }
}

pub(crate) fn read_open_zread_wiki_from_root(
    project_root: &Path,
) -> Result<HubOpenZreadWiki, HubCommandError> {
    let wiki_root = wiki_root(project_root);
    if !wiki_root.is_dir() {
        return Err(reader_error(
            "wiki_not_found",
            "This Project does not contain an OpenZread Wiki.",
            false,
        ));
    }

    let catalog_path = wiki_root.join("wiki.json");
    let catalog_contents = fs::read_to_string(&catalog_path).map_err(|_| {
        reader_error(
            "wiki_not_found",
            "The OpenZread Wiki catalog could not be read.",
            true,
        )
    })?;
    let native_catalog = serde_json::from_str::<Value>(&catalog_contents).map_err(|_| {
        reader_error(
            "wiki_invalid",
            "The OpenZread Wiki catalog is not valid JSON.",
            false,
        )
    })?;
    let Some(catalog_object) = native_catalog.as_object() else {
        return Err(reader_error(
            "wiki_invalid",
            "The OpenZread Wiki catalog must be a JSON object.",
            false,
        ));
    };
    let Some(page_values) = catalog_object.get("pages").and_then(Value::as_array) else {
        return Err(reader_error(
            "wiki_invalid",
            "The OpenZread Wiki catalog does not contain a pages array.",
            false,
        ));
    };
    if page_values.is_empty() {
        return Err(reader_error(
            "wiki_invalid",
            "The OpenZread Wiki catalog does not contain any pages.",
            false,
        ));
    }

    let pages = page_values
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, page)| read_page(index, page, &wiki_root))
        .collect::<Vec<_>>();
    let status = if pages.iter().all(|page| page.status == "readable") {
        "readable"
    } else {
        "partial"
    };

    Ok(HubOpenZreadWiki {
        provider: "open_zread",
        wiki_id: "open_zread@.".to_string(),
        source_root: ".".to_string(),
        status,
        catalog: HubWikiCatalog {
            id: object_string(catalog_object, "id"),
            generated_at: object_string(catalog_object, "generated_at"),
            language: object_string(catalog_object, "language"),
            native: native_catalog,
        },
        pages,
        current_pointer: None,
        version_id: None,
    })
}

fn zread_wiki_root(project_root: &Path) -> PathBuf {
    project_root.join(".zread").join("wiki")
}

fn read_zread_version_root(project_root: &Path) -> Result<(PathBuf, String), HubCommandError> {
    let wiki_root = zread_wiki_root(project_root);
    if !wiki_root.is_dir() {
        return Err(reader_error(
            "wiki_not_found",
            "This Project does not contain a Zread Wiki.",
            false,
        ));
    }

    let current_path = wiki_root.join("current");
    if !current_path.is_file() {
        return Err(reader_error(
            "wiki_invalid",
            "The Zread Wiki current pointer is missing or unreadable.",
            false,
        ));
    }
    let pointer = fs::read_to_string(&current_path)
        .map_err(|_| {
            reader_error(
                "wiki_read_failed",
                "The Zread Wiki current pointer could not be read.",
                true,
            )
        })?
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    if !safe_relative_path(&pointer) {
        return Err(reader_error(
            "wiki_invalid",
            "The Zread Wiki current pointer must be a non-empty relative path.",
            false,
        ));
    }
    let version_root = safe_page_path(&wiki_root, &[&pointer]).ok_or_else(|| {
        reader_error(
            "wiki_invalid",
            "The Zread Wiki current pointer resolves outside the Wiki versions directory.",
            false,
        )
    })?;
    if !version_root.is_dir() {
        return Err(reader_error(
            "wiki_invalid",
            format!("The Zread Wiki current pointer does not resolve to a version: {pointer}"),
            false,
        ));
    }
    Ok((version_root, pointer))
}

fn read_zread_wiki_from_root(
    project_root: &Path,
) -> Result<crate::contracts::HubZreadWiki, HubCommandError> {
    let (wiki_root, current_pointer) = read_zread_version_root(project_root)?;
    let catalog_path = wiki_root.join("wiki.json");
    let catalog_contents = fs::read_to_string(&catalog_path).map_err(|_| {
        reader_error(
            "wiki_not_found",
            format!(
                "The Zread Wiki catalog for current version '{current_pointer}' could not be read."
            ),
            true,
        )
    })?;
    let native_catalog = serde_json::from_str::<Value>(&catalog_contents).map_err(|_| {
        reader_error(
            "wiki_invalid",
            format!(
                "The Zread Wiki catalog for current version '{current_pointer}' is not valid JSON."
            ),
            false,
        )
    })?;
    let Some(catalog_object) = native_catalog.as_object() else {
        return Err(reader_error(
            "wiki_invalid",
            "The Zread Wiki catalog must be a JSON object.",
            false,
        ));
    };
    let Some(page_values) = catalog_object.get("pages").and_then(Value::as_array) else {
        return Err(reader_error(
            "wiki_invalid",
            "The Zread Wiki catalog does not contain a pages array.",
            false,
        ));
    };
    if page_values.is_empty() {
        return Err(reader_error(
            "wiki_invalid",
            "The Zread Wiki catalog does not contain any pages.",
            false,
        ));
    }
    let pages = page_values
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, page)| read_page(index, page, &wiki_root))
        .collect::<Vec<_>>();
    let status = if pages.iter().all(|page| page.status == "readable") {
        "readable"
    } else {
        "partial"
    };
    let version_id = object_string(catalog_object, "id").or_else(|| {
        current_pointer
            .rsplit(['/', '\\'])
            .next()
            .map(ToOwned::to_owned)
    });
    Ok(crate::contracts::HubZreadWiki {
        provider: "zread",
        wiki_id: "zread@.".to_string(),
        source_root: ".".to_string(),
        status,
        catalog: HubWikiCatalog {
            id: object_string(catalog_object, "id"),
            generated_at: object_string(catalog_object, "generated_at"),
            language: object_string(catalog_object, "language"),
            native: native_catalog,
        },
        pages,
        current_pointer: Some(current_pointer),
        version_id,
    })
}

pub(crate) fn read_zread_wiki(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<crate::contracts::HubZreadWiki, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    read_zread_wiki_from_root(&project_root)
}

pub(crate) fn read_open_zread_wiki(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<HubOpenZreadWiki, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    read_open_zread_wiki_from_root(&project_root)
}

pub(crate) fn read_wiki_instance(
    app: &tauri::AppHandle,
    project_id: &str,
    wiki_id: &str,
    expected_provider: &str,
) -> Result<HubOpenZreadWiki, HubCommandError> {
    let instance = resolve_wiki_instance(app, project_id, wiki_id)?;
    if instance.provider != expected_provider {
        return Err(reader_error(
            "wiki_invalid",
            "The selected Wiki provider does not match this instance.",
            false,
        ));
    }
    let mut wiki = match instance.provider {
        "open_zread" => read_open_zread_wiki_from_root(&instance.source_root)?,
        "zread" => read_zread_wiki_from_root(&instance.source_root)?,
        _ => {
            return Err(reader_error(
                "wiki_invalid",
                "The selected Wiki provider is unsupported.",
                false,
            ))
        }
    };
    wiki.wiki_id = instance.wiki_id;
    wiki.source_root = instance
        .source_root
        .strip_prefix(&instance.project_root)
        .unwrap_or(Path::new("."))
        .to_string_lossy()
        .replace('\\', "/");
    Ok(wiki)
}

pub(crate) fn read_open_zread_source(
    app: &tauri::AppHandle,
    project_id: &str,
    raw_path: &str,
) -> Result<HubSourceFile, HubCommandError> {
    read_source_from_root(&project_root(app, project_id)?, raw_path)
}

fn read_source_from_root(root: &Path, raw_path: &str) -> Result<HubSourceFile, HubCommandError> {
    let path = raw_path.trim();
    if !safe_relative_path(path) {
        return Err(reader_error(
            "source_invalid_path",
            "Source references must stay inside the registered Project.",
            false,
        ));
    }
    let candidate = safe_page_path(root, &[path]).ok_or_else(|| {
        reader_error(
            "source_invalid_path",
            "Source references must stay inside the registered Project.",
            false,
        )
    })?;
    let canonical_root = fs::canonicalize(root).map_err(|_| {
        reader_error(
            "source_invalid_path",
            "The registered Project could not be resolved.",
            true,
        )
    })?;
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|_| {
        reader_error(
            "source_not_found",
            "The associated source file could not be read.",
            true,
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err(reader_error(
            "source_invalid_path",
            "Source references must stay inside the registered Project.",
            false,
        ));
    }
    let content = fs::read_to_string(&canonical_candidate).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "source_not_found"
        } else {
            "wiki_read_failed"
        };
        reader_error(
            code,
            "The associated source file could not be read.",
            code == "wiki_read_failed",
        )
    })?;
    Ok(HubSourceFile {
        path: path.replace('\\', "/"),
        content,
    })
}

pub(crate) fn read_source_for_instance(
    app: &tauri::AppHandle,
    project_id: &str,
    wiki_id: &str,
    expected_provider: &'static str,
    raw_path: &str,
) -> Result<HubSourceFile, HubCommandError> {
    let instance = resolve_wiki_instance(app, project_id, wiki_id)?;
    ensure_instance_provider(instance.provider, expected_provider)?;
    read_source_from_root(&instance.source_root, raw_path)
}

fn ensure_instance_provider(
    actual_provider: &str,
    expected_provider: &str,
) -> Result<(), HubCommandError> {
    if actual_provider == expected_provider {
        return Ok(());
    }
    Err(reader_error(
        "wiki_provider_mismatch",
        "The selected Wiki instance belongs to a different Provider. Rescan and select it again.",
        false,
    ))
}

pub(crate) fn read_zread_source(
    app: &tauri::AppHandle,
    project_id: &str,
    raw_path: &str,
) -> Result<HubSourceFile, HubCommandError> {
    read_open_zread_source(app, project_id, raw_path)
}

pub(crate) fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

pub(crate) fn read_open_zread_asset(
    app: &tauri::AppHandle,
    project_id: &str,
    page_path_text: &str,
    asset_path_text: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    read_open_zread_asset_from_root(
        &project_root(app, project_id)?,
        page_path_text,
        asset_path_text,
    )
}

fn read_open_zread_asset_from_root(
    root: &Path,
    page_path_text: &str,
    asset_path_text: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    let page_path_text = page_path_text.trim();
    let asset_path_text = asset_path_text.trim();
    if !safe_relative_path(page_path_text) || !safe_relative_path(asset_path_text) {
        return Err(reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        ));
    }
    let wiki_root = wiki_root(root);
    let requested_page = Path::new(page_path_text);
    let requested_file = requested_page
        .file_name()
        .and_then(|file| file.to_str())
        .unwrap_or(page_path_text);
    let requested_section = requested_page
        .parent()
        .and_then(|section| section.to_str())
        .unwrap_or_default();
    let page_path = page_path(&wiki_root, requested_section, requested_file).ok_or_else(|| {
        reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        )
    })?;
    let candidate = page_path
        .parent()
        .unwrap_or(&wiki_root)
        .join(asset_path_text);
    let canonical_root = fs::canonicalize(&wiki_root).map_err(|_| {
        reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        )
    })?;
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|_| {
        reader_error(
            "asset_not_found",
            "The Wiki image could not be read.",
            false,
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err(reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        ));
    }
    let bytes = fs::read(&canonical_candidate)
        .map_err(|_| reader_error("asset_not_found", "The Wiki image could not be read.", true))?;
    let relative_path = canonical_candidate
        .strip_prefix(&canonical_root)
        .unwrap_or(&canonical_candidate)
        .to_string_lossy()
        .replace('\\', "/");
    Ok(HubWikiAsset {
        path: relative_path,
        mime_type: mime_type(&canonical_candidate).to_string(),
        bytes,
    })
}

pub(crate) fn read_asset_for_instance(
    app: &tauri::AppHandle,
    project_id: &str,
    wiki_id: &str,
    expected_provider: &'static str,
    page_path_text: &str,
    asset_path_text: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    let instance = resolve_wiki_instance(app, project_id, wiki_id)?;
    ensure_instance_provider(instance.provider, expected_provider)?;
    match expected_provider {
        "open_zread" => {
            read_open_zread_asset_from_root(&instance.source_root, page_path_text, asset_path_text)
        }
        "zread" => {
            read_zread_asset_from_root(&instance.source_root, page_path_text, asset_path_text)
        }
        _ => Err(reader_error(
            "asset_invalid_path",
            "The selected Wiki provider is unsupported.",
            false,
        )),
    }
}

pub(crate) fn read_zread_asset(
    app: &tauri::AppHandle,
    project_id: &str,
    page_path_text: &str,
    asset_path_text: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    read_zread_asset_from_root(
        &project_root(app, project_id)?,
        page_path_text,
        asset_path_text,
    )
}

fn read_zread_asset_from_root(
    root: &Path,
    page_path_text: &str,
    asset_path_text: &str,
) -> Result<HubWikiAsset, HubCommandError> {
    let page_path_text = page_path_text.trim();
    let asset_path_text = asset_path_text.trim();
    if !safe_relative_path(page_path_text) || !safe_relative_path(asset_path_text) {
        return Err(reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        ));
    }
    let (wiki_root, _) = read_zread_version_root(root)?;
    let requested_page = Path::new(page_path_text);
    let requested_file = requested_page
        .file_name()
        .and_then(|file| file.to_str())
        .unwrap_or(page_path_text);
    let requested_section = requested_page
        .parent()
        .and_then(|section| section.to_str())
        .unwrap_or_default();
    let page_path = page_path(&wiki_root, requested_section, requested_file).ok_or_else(|| {
        reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        )
    })?;
    let candidate = page_path
        .parent()
        .unwrap_or(&wiki_root)
        .join(asset_path_text);
    let canonical_root = fs::canonicalize(&wiki_root).map_err(|_| {
        reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        )
    })?;
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|_| {
        reader_error(
            "asset_not_found",
            "The Wiki image could not be read.",
            false,
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err(reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        ));
    }
    let bytes = fs::read(&canonical_candidate)
        .map_err(|_| reader_error("asset_not_found", "The Wiki image could not be read.", true))?;
    let relative_path = canonical_candidate
        .strip_prefix(&canonical_root)
        .unwrap_or(&canonical_candidate)
        .to_string_lossy()
        .replace('\\', "/");
    Ok(HubWikiAsset {
        path: relative_path,
        mime_type: mime_type(&canonical_candidate).to_string(),
        bytes,
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
        let root = std::env::temp_dir().join(format!("open-zread-reader-{label}-{suffix}"));
        create_dir_all(&root).expect("temporary root should be created");
        root
    }

    #[test]
    fn instance_resources_reject_a_provider_mismatch() {
        assert!(ensure_instance_provider("open_zread", "open_zread").is_ok());
        let error = ensure_instance_provider("zread", "open_zread")
            .expect_err("an instance from another Provider must be rejected");
        assert_eq!(error.code, "wiki_provider_mismatch");
        assert!(!error.retryable);
    }

    #[test]
    fn source_and_asset_paths_cannot_escape_their_instance_roots() {
        let root = temporary_root("instance-resource-boundary");
        let page = root.join(".open-zread/wiki/docs/page.md");
        create_dir_all(page.parent().expect("page parent should exist"))
            .expect("Wiki page directory should be created");
        write(&page, b"# Page").expect("Wiki page should be written");
        write(root.join("outside.txt"), b"outside").expect("outside file should be written");

        assert!(matches!(
            read_source_from_root(&root, "../outside.txt"),
            Err(error) if error.code == "source_invalid_path"
        ));
        assert!(matches!(
            read_open_zread_asset_from_root(&root, "docs/page.md", "../../../../outside.txt"),
            Err(error) if error.code == "asset_invalid_path"
        ));
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn reads_valid_pages_and_keeps_missing_pages_local_to_partial_status() {
        let root = temporary_root("partial");
        let wiki_root = root.join(".open-zread/wiki");
        create_dir_all(wiki_root.join("guide")).expect("wiki directory should be created");
        write(
            wiki_root.join("wiki.json"),
            br#"{"id":"catalog-1","generated_at":"now","providerMeta":{"opaque":true},"pages":[{"slug":"good","title":"Good","file":"good.md","section":"guide","associatedFiles":["src/main.ts"],"providerOnly":"kept"},{"slug":"missing","title":"Missing","file":"missing.md","section":"guide"}]}"#,
        )
        .expect("catalog should be written");
        write(
            wiki_root.join("guide/good.md"),
            b"# Good\n\n```mermaid\nflowchart LR\n```",
        )
        .expect("page should be written");

        let result =
            read_open_zread_wiki_from_root(&root).expect("reader should return partial Wiki");
        assert_eq!(result.status, "partial");
        assert_eq!(result.pages[0].status, "readable");
        assert_eq!(result.pages[0].associated_files, vec!["src/main.ts"]);
        assert_eq!(result.pages[0].native["providerOnly"], "kept");
        assert_eq!(result.pages[1].status, "missing");
        assert_eq!(result.catalog.native["providerMeta"]["opaque"], true);
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn rejects_catalog_paths_that_escape_the_wiki_root() {
        let root = temporary_root("escape");
        let wiki_root = root.join(".open-zread/wiki");
        create_dir_all(&wiki_root).expect("wiki directory should be created");
        write(
            wiki_root.join("wiki.json"),
            br#"{"pages":[{"slug":"escape","title":"Escape","file":"../outside.md","section":"guide"}]}"#,
        )
        .expect("catalog should be written");

        let result = read_open_zread_wiki_from_root(&root).expect("invalid page should be local");
        assert_eq!(result.status, "partial");
        assert_eq!(result.pages[0].status, "unreadable");
        assert_eq!(
            result.pages[0].error.as_deref(),
            Some("The catalog page path is outside the Project Wiki.")
        );
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn resolves_zread_current_pointer_without_using_the_cli() {
        let root = temporary_root("zread-current");
        let wiki_root = root.join(".zread/wiki");
        let version_root = wiki_root.join("versions/v2");
        create_dir_all(&version_root).expect("Zread version directory should be created");
        write(wiki_root.join("current"), b"versions/v2\n")
            .expect("current pointer should be written");
        write(
            version_root.join("wiki.json"),
            br#"{"id":"v2","language":"zh","providerMeta":{"opaque":"kept"},"pages":[{"slug":"overview","title":"Overview","file":"overview.md","section":"Start","sourceRefs":["src/main.ts"]}]}"#,
        )
        .expect("Zread catalog should be written");
        write(version_root.join("overview.md"), b"# Version two").expect("page should be written");

        let result =
            read_zread_wiki_from_root(&root).expect("current Zread version should be readable");
        assert_eq!(result.provider, "zread");
        assert_eq!(result.status, "readable");
        assert_eq!(result.current_pointer.as_deref(), Some("versions/v2"));
        assert_eq!(result.version_id.as_deref(), Some("v2"));
        assert_eq!(result.pages[0].content.as_deref(), Some("# Version two"));
        assert_eq!(result.pages[0].associated_files, vec!["src/main.ts"]);
        assert_eq!(result.catalog.native["providerMeta"]["opaque"], "kept");
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn rejects_invalid_zread_current_pointer_without_falling_back() {
        let root = temporary_root("zread-pointer");
        let wiki_root = root.join(".zread/wiki");
        let old_version = wiki_root.join("versions/old");
        create_dir_all(&old_version).expect("old version directory should be created");
        write(wiki_root.join("current"), b"../versions/old\n")
            .expect("invalid current pointer should be written");
        write(
            old_version.join("wiki.json"),
            br#"{"pages":[{"slug":"old","title":"Old","file":"old.md"}]}"#,
        )
        .expect("old catalog should be written");
        write(old_version.join("old.md"), b"old").expect("old page should be written");

        let error = match read_zread_wiki_from_root(&root) {
            Ok(_) => panic!("invalid pointer must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, "wiki_invalid");
        assert!(error.message.contains("current pointer"));
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn rejects_a_missing_zread_current_version_instead_of_using_an_old_version() {
        let root = temporary_root("zread-missing-version");
        let wiki_root = root.join(".zread/wiki");
        let old_version = wiki_root.join("versions/old");
        create_dir_all(&old_version).expect("old version directory should be created");
        write(wiki_root.join("current"), b"versions/missing")
            .expect("current pointer should be written");
        write(
            old_version.join("wiki.json"),
            br#"{"pages":[{"slug":"old","title":"Old","file":"old.md"}]}"#,
        )
        .expect("old catalog should be written");
        write(old_version.join("old.md"), b"old").expect("old page should be written");

        let error = match read_zread_wiki_from_root(&root) {
            Ok(_) => panic!("missing current version must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, "wiki_invalid");
        assert!(error.message.contains("versions/missing"));
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn reads_the_version_selected_after_current_pointer_switch() {
        let root = temporary_root("zread-switch");
        let wiki_root = root.join(".zread/wiki");
        let first = wiki_root.join("versions/first");
        let second = wiki_root.join("versions/second");
        create_dir_all(&first).expect("first version should be created");
        create_dir_all(&second).expect("second version should be created");
        for (version, text) in [("first", "first content"), ("second", "second content")] {
            let version_root = wiki_root.join(format!("versions/{version}"));
            write(
                version_root.join("wiki.json"),
                format!(r#"{{"id":"{version}","pages":[{{"slug":"page","title":"Page","file":"page.md"}}]}}"#),
            )
            .expect("catalog should be written");
            write(version_root.join("page.md"), text).expect("page should be written");
        }
        write(wiki_root.join("current"), b"versions/second")
            .expect("current pointer should be written");

        let result = read_zread_wiki_from_root(&root).expect("selected version should be readable");
        assert_eq!(result.version_id.as_deref(), Some("second"));
        assert_eq!(result.pages[0].content.as_deref(), Some("second content"));
        remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn maps_supported_image_extensions_to_safe_mime_types() {
        assert_eq!(mime_type(Path::new("diagram.PNG")), "image/png");
        assert_eq!(mime_type(Path::new("diagram.svg")), "image/svg+xml");
        assert_eq!(
            mime_type(Path::new("unknown.bin")),
            "application/octet-stream"
        );
    }
}
