use crate::contracts::{
    HubCommandError, HubOpenZreadWiki, HubSourceFile, HubWikiAsset, HubWikiCatalog, HubWikiPage,
};
use crate::projects::{project_root, safe_page_path, safe_relative_path};
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

fn read_open_zread_wiki_from_root(
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
        status,
        catalog: HubWikiCatalog {
            id: object_string(catalog_object, "id"),
            generated_at: object_string(catalog_object, "generated_at"),
            language: object_string(catalog_object, "language"),
            native: native_catalog,
        },
        pages,
    })
}

pub(crate) fn read_open_zread_wiki(
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<HubOpenZreadWiki, HubCommandError> {
    let project_root = project_root(app, project_id)?;
    read_open_zread_wiki_from_root(&project_root)
}

pub(crate) fn read_open_zread_source(
    app: &tauri::AppHandle,
    project_id: &str,
    raw_path: &str,
) -> Result<HubSourceFile, HubCommandError> {
    let path = raw_path.trim();
    if !safe_relative_path(path) {
        return Err(reader_error(
            "source_invalid_path",
            "Source references must stay inside the registered Project.",
            false,
        ));
    }
    let root = project_root(app, project_id)?;
    let candidate = safe_page_path(&root, &[path]).ok_or_else(|| {
        reader_error(
            "source_invalid_path",
            "Source references must stay inside the registered Project.",
            false,
        )
    })?;
    let content = fs::read_to_string(&candidate).map_err(|error| {
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

fn mime_type(path: &Path) -> &'static str {
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
    let page_path_text = page_path_text.trim();
    let asset_path_text = asset_path_text.trim();
    if !safe_relative_path(page_path_text) || !safe_relative_path(asset_path_text) {
        return Err(reader_error(
            "asset_invalid_path",
            "Wiki assets must stay inside the registered Project Wiki.",
            false,
        ));
    }
    let root = project_root(app, project_id)?;
    let wiki_root = wiki_root(&root);
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
    fn maps_supported_image_extensions_to_safe_mime_types() {
        assert_eq!(mime_type(Path::new("diagram.PNG")), "image/png");
        assert_eq!(mime_type(Path::new("diagram.svg")), "image/svg+xml");
        assert_eq!(
            mime_type(Path::new("unknown.bin")),
            "application/octet-stream"
        );
    }
}
