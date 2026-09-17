use crate::contracts::{HubCommandError, HubWikiPageMutationResponse};
use crate::projects::{project_root, safe_page_path, safe_relative_path};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

struct CatalogLocation {
    provider: &'static str,
    wiki_root: PathBuf,
    catalog_path: PathBuf,
    flat_pages: bool,
}

fn error(code: &'static str, message: impl Into<String>, retryable: bool) -> HubCommandError {
    HubCommandError {
        code,
        message: message.into(),
        retryable,
    }
}

fn valid_component(value: &str) -> bool {
    !value.trim().is_empty()
        && safe_relative_path(value)
        && Path::new(value).components().count() == 1
        && !value
            .chars()
            .any(|character| "<>:\"/\\|?*".contains(character))
}

fn valid_relative(value: &str) -> bool {
    !value.trim().is_empty()
        && safe_relative_path(value)
        && !Path::new(value)
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
}

fn location(root: &Path, provider: &str) -> Result<CatalogLocation, HubCommandError> {
    match provider {
        "open_zread" => {
            let wiki_root = root.join(".open-zread").join("wiki");
            Ok(CatalogLocation {
                provider: "open_zread",
                catalog_path: wiki_root.join("wiki.json"),
                wiki_root,
                flat_pages: false,
            })
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
            let version_root = safe_page_path(&wiki_root, &[&pointer]).ok_or_else(|| {
                error(
                    "wiki_invalid",
                    "The Zread current pointer is invalid.",
                    false,
                )
            })?;
            Ok(CatalogLocation {
                provider: "zread",
                catalog_path: version_root.join("wiki.json"),
                wiki_root: version_root,
                flat_pages: true,
            })
        }
        _ => Err(error(
            "invalid_request",
            "Wiki provider must be open_zread or zread.",
            false,
        )),
    }
}

fn read_catalog(location: &CatalogLocation) -> Result<(Vec<u8>, Value), HubCommandError> {
    let original = fs::read(&location.catalog_path).map_err(|_| {
        error(
            "wiki_not_found",
            "The Wiki catalog could not be read.",
            true,
        )
    })?;
    let catalog = serde_json::from_slice::<Value>(&original)
        .map_err(|_| error("wiki_invalid", "The Wiki catalog is not valid JSON.", false))?;
    if !catalog.get("pages").and_then(Value::as_array).is_some() {
        return Err(error(
            "wiki_invalid",
            "The Wiki catalog has no pages array.",
            false,
        ));
    }
    Ok((original, catalog))
}

fn page_path(
    location: &CatalogLocation,
    page: &Map<String, Value>,
) -> Result<(PathBuf, String), HubCommandError> {
    let file = page
        .get("file")
        .and_then(Value::as_str)
        .filter(|file| valid_relative(file))
        .ok_or_else(|| error("wiki_invalid", "The Wiki page file path is invalid.", false))?;
    let section = if location.flat_pages {
        None
    } else {
        page.get("section").and_then(Value::as_str)
    };
    let parts = section
        .into_iter()
        .chain(std::iter::once(file))
        .collect::<Vec<_>>();
    let path = safe_page_path(&location.wiki_root, &parts).ok_or_else(|| {
        error(
            "wiki_invalid",
            "The Wiki page path escapes its root.",
            false,
        )
    })?;
    Ok((path, parts.join("/")))
}

fn find_page_index(catalog: &Value, slug: &str) -> Result<usize, HubCommandError> {
    catalog
        .get("pages")
        .and_then(Value::as_array)
        .and_then(|pages| {
            pages
                .iter()
                .position(|page| page.get("slug").and_then(Value::as_str) == Some(slug))
        })
        .ok_or_else(|| {
            error(
                "source_not_found",
                format!("Wiki page '{slug}' was not found."),
                false,
            )
        })
}

fn write_catalog(path: &Path, value: &Value) -> Result<(), HubCommandError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|serialization_error| {
        error("internal_error", serialization_error.to_string(), true)
    })?;
    fs::write(path, bytes).map_err(|write_error| {
        error(
            "internal_error",
            format!("Unable to write Wiki catalog: {write_error}"),
            true,
        )
    })
}

fn rollback_catalog(path: &Path, original: &[u8]) {
    let _ = fs::write(path, original);
}

fn response(
    project_id: &str,
    location: &CatalogLocation,
    slug: &str,
    action: &'static str,
    relative_path: String,
) -> HubWikiPageMutationResponse {
    HubWikiPageMutationResponse {
        project_id: project_id.to_string(),
        provider: location.provider,
        slug: slug.to_string(),
        action,
        relative_path,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_page(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    slug: &str,
    title: &str,
    section: &str,
    group: Option<&str>,
    content: &str,
    associated_files: &[String],
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    if !valid_component(slug) || title.trim().is_empty() || !valid_component(section) {
        return Err(error(
            "invalid_request",
            "Page slug, title, and section are invalid.",
            false,
        ));
    }
    if associated_files.iter().any(|path| !valid_relative(path)) {
        return Err(error(
            "source_invalid_path",
            "A SourceReference path is invalid.",
            false,
        ));
    }
    let root = project_root(app, project_id)?;
    let location = location(&root, provider)?;
    let (original_catalog, mut catalog) = read_catalog(&location)?;
    if catalog
        .get("pages")
        .and_then(Value::as_array)
        .is_some_and(|pages| {
            pages
                .iter()
                .any(|page| page.get("slug").and_then(Value::as_str) == Some(slug))
        })
    {
        return Err(error(
            "conflict",
            format!("Page slug '{slug}' already exists."),
            false,
        ));
    }
    let file = format!("{slug}.md");
    let relative_path = if location.flat_pages {
        file.clone()
    } else {
        format!("{section}/{file}")
    };
    let target = safe_page_path(&location.wiki_root, &[&relative_path]).ok_or_else(|| {
        error(
            "source_invalid_path",
            "The new page path is invalid.",
            false,
        )
    })?;
    if target.exists() {
        return Err(error(
            "conflict",
            "The new page file already exists.",
            false,
        ));
    }
    let mut page = Map::new();
    page.insert("slug".to_string(), Value::String(slug.to_string()));
    page.insert("title".to_string(), Value::String(title.trim().to_string()));
    page.insert("file".to_string(), Value::String(file));
    page.insert("section".to_string(), Value::String(section.to_string()));
    if let Some(group) = group.filter(|group| !group.trim().is_empty()) {
        page.insert("group".to_string(), Value::String(group.trim().to_string()));
    }
    page.insert(
        "associatedFiles".to_string(),
        serde_json::to_value(associated_files).unwrap_or(Value::Array(Vec::new())),
    );
    page.insert("status".to_string(), Value::String("new".to_string()));
    catalog
        .get_mut("pages")
        .and_then(Value::as_array_mut)
        .expect("validated pages array")
        .push(Value::Object(page));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|write_error| error("internal_error", write_error.to_string(), true))?;
    }
    fs::write(&target, content)
        .map_err(|write_error| error("internal_error", write_error.to_string(), true))?;
    if let Err(write_error) = write_catalog(&location.catalog_path, &catalog) {
        let _ = fs::remove_file(&target);
        rollback_catalog(&location.catalog_path, &original_catalog);
        return Err(write_error);
    }
    Ok(response(
        project_id,
        &location,
        slug,
        "created",
        relative_path,
    ))
}

pub(crate) fn delete_page(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    slug: &str,
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    let root = project_root(app, project_id)?;
    let location = location(&root, provider)?;
    let (original_catalog, mut catalog) = read_catalog(&location)?;
    let index = find_page_index(&catalog, slug)?;
    let page = catalog
        .get("pages")
        .and_then(Value::as_array)
        .and_then(|pages| pages.get(index))
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| error("wiki_invalid", "The Wiki page entry is invalid.", false))?;
    let (target, relative_path) = page_path(&location, &page)?;
    let original_page = fs::read(&target).map_err(|_| {
        error(
            "wiki_not_found",
            "The Wiki page file could not be read.",
            true,
        )
    })?;
    catalog
        .get_mut("pages")
        .and_then(Value::as_array_mut)
        .expect("validated pages array")
        .remove(index);
    write_catalog(&location.catalog_path, &catalog)?;
    if let Err(remove_error) = fs::remove_file(&target) {
        rollback_catalog(&location.catalog_path, &original_catalog);
        let _ = fs::write(&target, original_page);
        return Err(error(
            "internal_error",
            format!("Unable to delete the Wiki page: {remove_error}"),
            true,
        ));
    }
    Ok(response(
        project_id,
        &location,
        slug,
        "deleted",
        relative_path,
    ))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn update_metadata(
    app: &AppHandle,
    project_id: &str,
    provider: &str,
    slug: &str,
    new_slug: Option<&str>,
    title: Option<&str>,
    section: Option<&str>,
    group: Option<&str>,
    associated_files: Option<&[String]>,
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    let root = project_root(app, project_id)?;
    let location = location(&root, provider)?;
    let (original_catalog, mut catalog) = read_catalog(&location)?;
    let index = find_page_index(&catalog, slug)?;
    let pages = catalog
        .get_mut("pages")
        .and_then(Value::as_array_mut)
        .expect("validated pages array");
    let page_snapshot = pages
        .get(index)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| error("wiki_invalid", "The Wiki page entry is invalid.", false))?;
    let current_file = page_snapshot
        .get("file")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let current_section = page_snapshot
        .get("section")
        .and_then(Value::as_str)
        .unwrap_or("Uncategorized")
        .to_string();
    let next_slug = new_slug.unwrap_or(slug);
    let next_section = section.unwrap_or(&current_section);
    if !valid_component(next_slug) || !valid_component(next_section) {
        return Err(error(
            "invalid_request",
            "The new slug or section is invalid.",
            false,
        ));
    }
    if next_slug != slug
        && pages
            .iter()
            .any(|candidate| candidate.get("slug").and_then(Value::as_str) == Some(next_slug))
    {
        return Err(error(
            "conflict",
            format!("Page slug '{next_slug}' already exists."),
            false,
        ));
    }
    if let Some(files) = associated_files {
        if files.iter().any(|path| !valid_relative(path)) {
            return Err(error(
                "source_invalid_path",
                "A SourceReference path is invalid.",
                false,
            ));
        }
    }
    let (old_target, _) = page_path(&location, &page_snapshot)?;
    let next_relative = if location.flat_pages {
        current_file.clone()
    } else {
        format!("{next_section}/{current_file}")
    };
    let next_target = safe_page_path(&location.wiki_root, &[&next_relative]).ok_or_else(|| {
        error(
            "source_invalid_path",
            "The new Wiki page path is invalid.",
            false,
        )
    })?;
    let moved = old_target != next_target;
    if moved && next_target.exists() {
        return Err(error(
            "conflict",
            "The destination Wiki page path already exists.",
            false,
        ));
    }
    let page = pages
        .get_mut(index)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| error("wiki_invalid", "The Wiki page entry is invalid.", false))?;
    if let Some(title) = title.filter(|value| !value.trim().is_empty()) {
        page.insert("title".to_string(), Value::String(title.trim().to_string()));
    }
    if new_slug.is_some() {
        page.insert("slug".to_string(), Value::String(next_slug.to_string()));
    }
    if section.is_some() && !location.flat_pages {
        page.insert(
            "section".to_string(),
            Value::String(next_section.to_string()),
        );
    }
    if let Some(group) = group {
        page.insert("group".to_string(), Value::String(group.to_string()));
    }
    if let Some(files) = associated_files {
        let key = if page.contains_key("sourceRefs") {
            "sourceRefs"
        } else {
            "associatedFiles"
        };
        page.insert(
            key.to_string(),
            serde_json::to_value(files).unwrap_or(Value::Array(Vec::new())),
        );
    }
    if moved {
        if let Some(parent) = next_target.parent() {
            fs::create_dir_all(parent)
                .map_err(|write_error| error("internal_error", write_error.to_string(), true))?;
        }
        fs::rename(&old_target, &next_target)
            .map_err(|write_error| error("internal_error", write_error.to_string(), true))?;
    }
    if let Err(write_error) = write_catalog(&location.catalog_path, &catalog) {
        if moved {
            let _ = fs::rename(&next_target, &old_target);
        }
        rollback_catalog(&location.catalog_path, &original_catalog);
        return Err(write_error);
    }
    Ok(response(
        project_id,
        &location,
        next_slug,
        "updated",
        next_relative,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_names_reject_absolute_and_nested_components() {
        assert!(valid_component("architecture"));
        assert!(!valid_component(""));
        assert!(!valid_component("../architecture"));
        assert!(!valid_component("nested/architecture"));
        assert!(!valid_component("C:\\architecture"));
        assert!(valid_component("architecture.md"));
    }

    #[test]
    fn source_references_allow_nested_relative_files_but_not_escape() {
        assert!(valid_relative("src/main.ts"));
        assert!(valid_relative("docs/README.md"));
        assert!(!valid_relative("../secrets.txt"));
        assert!(!valid_relative("/absolute/path"));
        assert!(!valid_relative("C:\\secrets.txt"));
    }
}
