use crate::contracts::{
    HubCommandError, HubWikiSearchFailure, HubWikiSearchResponse, HubWikiSearchResult,
};
use crate::projects::{list_projects, safe_page_path};
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

fn error(message: impl Into<String>) -> HubCommandError {
    HubCommandError {
        code: "invalid_request",
        message: message.into(),
        retryable: false,
    }
}

fn snippet(content: &str, query: &str) -> String {
    let folded = content.to_lowercase();
    let query_folded = query.to_lowercase();
    let start = folded.find(&query_folded).unwrap_or(0);
    let start = start.saturating_sub(80);
    let end = (start + 220).min(content.len());
    content
        .get(start..end)
        .unwrap_or(content)
        .replace('\n', " ")
}

fn search_catalog(
    project_id: &str,
    project_name: &str,
    provider: &'static str,
    wiki_root: &Path,
    catalog_path: &Path,
    query: &str,
    flat_pages: bool,
) -> Result<Vec<HubWikiSearchResult>, String> {
    let catalog: Value = serde_json::from_str(
        &fs::read_to_string(catalog_path).map_err(|_| "Wiki catalog is unreadable.")?,
    )
    .map_err(|_| "Wiki catalog is invalid JSON.")?;
    let pages = catalog
        .get("pages")
        .and_then(Value::as_array)
        .ok_or("Wiki catalog has no pages array.")?;
    let mut results = Vec::new();
    for page in pages {
        let Some(page) = page.as_object() else {
            continue;
        };
        let slug = page.get("slug").and_then(Value::as_str).unwrap_or_default();
        let title = page.get("title").and_then(Value::as_str).unwrap_or(slug);
        let file = page.get("file").and_then(Value::as_str).unwrap_or_default();
        if slug.is_empty() || file.is_empty() {
            continue;
        }
        let section = if flat_pages {
            None
        } else {
            page.get("section").and_then(Value::as_str)
        };
        let parts = section
            .into_iter()
            .chain(std::iter::once(file))
            .collect::<Vec<_>>();
        let Some(path) = safe_page_path(wiki_root, &parts) else {
            continue;
        };
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let haystack = format!("{slug}\n{title}\n{content}").to_lowercase();
        if haystack.contains(&query.to_lowercase()) {
            results.push(HubWikiSearchResult {
                project_id: project_id.to_string(),
                project_name: project_name.to_string(),
                provider,
                slug: slug.to_string(),
                title: title.to_string(),
                snippet: snippet(&content, query),
                path: parts.join("/"),
            });
        }
    }
    Ok(results)
}

pub(crate) fn search_wiki(
    app: &AppHandle,
    query: &str,
) -> Result<HubWikiSearchResponse, HubCommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(error("Search query is required."));
    }
    let projects = list_projects(app)?;
    let mut results = Vec::new();
    let mut failures = Vec::new();
    for project in projects {
        if project.availability != "available" {
            continue;
        }
        let open_root = Path::new(&project.path).join(".open-zread").join("wiki");
        if open_root.is_dir() {
            match search_catalog(
                &project.id,
                &project.name,
                "open_zread",
                &open_root,
                &open_root.join("wiki.json"),
                query,
                false,
            ) {
                Ok(mut matches) => results.append(&mut matches),
                Err(message) => failures.push(HubWikiSearchFailure {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    provider: "open_zread",
                    message,
                }),
            }
        }
        let zread_root = Path::new(&project.path).join(".zread").join("wiki");
        if zread_root.is_dir() {
            let pointer = fs::read_to_string(zread_root.join("current"))
                .ok()
                .map(|value| value.trim_start_matches('\u{feff}').trim().to_string());
            if let Some(pointer) = pointer {
                if let Some(version_root) = safe_page_path(&zread_root, &[&pointer]) {
                    match search_catalog(
                        &project.id,
                        &project.name,
                        "zread",
                        &version_root,
                        &version_root.join("wiki.json"),
                        query,
                        true,
                    ) {
                        Ok(mut matches) => results.append(&mut matches),
                        Err(message) => failures.push(HubWikiSearchFailure {
                            project_id: project.id.clone(),
                            project_name: project.name.clone(),
                            provider: "zread",
                            message,
                        }),
                    }
                }
            }
        }
    }
    Ok(HubWikiSearchResponse {
        query: query.to_string(),
        results,
        failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_keeps_unicode_context() {
        let value = snippet("前文\nProvider 协同工作\n后文", "协同");
        assert!(value.contains("协同"));
    }
}
