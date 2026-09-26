use crate::contracts::{
    HubCommandError, HubMarkdownNode, HubMarkdownSearchFailure, HubMarkdownSearchResult,
    HubProjectMarkdownSearchResponse, HubWikiSearchFailure, HubWikiSearchResponse,
    HubWikiSearchResult,
};
use crate::projects::{list_projects, safe_page_path};
use crate::wiki_instances::{list_project_wikis, resolve_wiki_instance};
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

const MAX_MARKDOWN_SEARCH_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_MARKDOWN_SEARCH_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MARKDOWN_SEARCH_RESULTS: usize = 2_000;
const MAX_MARKDOWN_SEARCH_QUERY_CHARS: usize = 256;

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
    let byte_start = folded.find(&query_folded).unwrap_or(0);
    let char_start = folded[..byte_start].chars().count();
    let chars = content.chars().collect::<Vec<_>>();
    let start = char_start.saturating_sub(80);
    let end = (start + 220).min(chars.len());
    chars[start..end]
        .iter()
        .collect::<String>()
        .replace('\n', " ")
}

fn collect_markdown_files(nodes: &[HubMarkdownNode], files: &mut Vec<(String, String, u64)>) {
    for node in nodes {
        if node.kind == "file" {
            files.push((
                node.relative_path.clone(),
                node.title.clone().unwrap_or_else(|| node.name.clone()),
                node.bytes.unwrap_or_default(),
            ));
        } else if let Some(children) = &node.children {
            collect_markdown_files(children, files);
        }
    }
}

fn markdown_content_location(content: &str, query: &str) -> Option<(usize, usize, usize)> {
    let query = query.to_lowercase();
    for (line_index, line) in content.lines().enumerate() {
        let lowered = line.to_lowercase();
        if let Some(byte_index) = lowered.find(&query) {
            let column = lowered[..byte_index].chars().count() + 1;
            return Some((line_index + 1, column, query.chars().count()));
        }
    }
    None
}

fn search_markdown_project(
    app: &AppHandle,
    project_id: &str,
    project_name: &str,
    query: &str,
) -> Result<HubProjectMarkdownSearchResponse, HubCommandError> {
    let tree = crate::markdown::scan_project_markdown(app, project_id)?;
    let mut files = Vec::new();
    collect_markdown_files(&tree.roots, &mut files);
    let folded_query = query.to_lowercase();
    let mut results = Vec::new();
    let mut errors = tree.errors.clone();
    let mut scan_complete = tree.scan_complete;
    let mut warning = tree.warning.clone();
    let mut searched_bytes = 0u64;

    for (path, title, bytes) in files {
        if results.len() >= MAX_MARKDOWN_SEARCH_RESULTS {
            scan_complete = false;
            warning = Some(format!(
                "Markdown 搜索达到 {} 条结果上限；可增加关键词缩小范围。",
                MAX_MARKDOWN_SEARCH_RESULTS
            ));
            break;
        }
        let path_matches = format!("{path}\n{title}")
            .to_lowercase()
            .contains(&folded_query);
        if path_matches {
            results.push(HubMarkdownSearchResult {
                source_kind: "local_markdown",
                project_id: project_id.to_string(),
                project_name: project_name.to_string(),
                path: path.clone(),
                title: title.clone(),
                snippet: if path.to_lowercase().contains(&folded_query) {
                    path.clone()
                } else {
                    title.clone()
                },
                match_kind: "path",
                match_line: None,
                match_column: None,
                match_length: None,
            });
            continue;
        }
        if bytes > MAX_MARKDOWN_SEARCH_FILE_BYTES {
            scan_complete = false;
            if errors.len() < 100 {
                errors.push(crate::contracts::HubMarkdownFileError {
                    relative_path: path,
                    message: "File exceeds the 4 MiB per-document search limit; filename and path remain searchable.".to_string(),
                });
            }
            continue;
        }
        if searched_bytes.saturating_add(bytes) > MAX_MARKDOWN_SEARCH_TOTAL_BYTES {
            scan_complete = false;
            warning =
                Some("Markdown 正文搜索达到 64 MiB 读取预算；当前结果为部分结果。".to_string());
            break;
        }
        searched_bytes = searched_bytes.saturating_add(bytes);
        let document = match crate::markdown::read_project_markdown(app, project_id, &path) {
            Ok(document) => document,
            Err(error) => {
                scan_complete = false;
                if errors.len() < 100 {
                    errors.push(crate::contracts::HubMarkdownFileError {
                        relative_path: path,
                        message: error.message,
                    });
                }
                continue;
            }
        };
        if let Some((line, column, length)) = markdown_content_location(&document.content, query) {
            results.push(HubMarkdownSearchResult {
                source_kind: "local_markdown",
                project_id: project_id.to_string(),
                project_name: project_name.to_string(),
                path: document.relative_path,
                title: document.title,
                snippet: snippet(&document.content, query),
                match_kind: "content",
                match_line: Some(line),
                match_column: Some(column),
                match_length: Some(length),
            });
        }
    }
    results.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    Ok(HubProjectMarkdownSearchResponse {
        project_id: project_id.to_string(),
        query: query.to_string(),
        results,
        scan_complete,
        scanned_files: tree.scanned_files,
        errors,
        warning,
    })
}

pub(crate) fn search_project_markdown(
    app: &AppHandle,
    project_id: &str,
    query: &str,
) -> Result<HubProjectMarkdownSearchResponse, HubCommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(error("Search query is required."));
    }
    if query.chars().count() > MAX_MARKDOWN_SEARCH_QUERY_CHARS {
        return Err(error(format!(
            "Search query exceeds the {MAX_MARKDOWN_SEARCH_QUERY_CHARS}-character limit."
        )));
    }
    let project = list_projects(app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| error("Project is not registered."))?;
    if project.availability != "available" {
        return Err(error("Project directory is currently unavailable."));
    }
    search_markdown_project(app, &project.id, &project.name, query)
}

fn search_catalog(
    project_id: &str,
    project_name: &str,
    provider: &'static str,
    wiki_id: &str,
    source_root: &str,
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
                wiki_id: wiki_id.to_string(),
                source_root: source_root.to_string(),
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
    if query.chars().count() > MAX_MARKDOWN_SEARCH_QUERY_CHARS {
        return Err(error(format!(
            "Search query exceeds the {MAX_MARKDOWN_SEARCH_QUERY_CHARS}-character limit."
        )));
    }
    let projects = list_projects(app)?;
    let mut results = Vec::new();
    let mut failures = Vec::new();
    for project in projects {
        if project.availability != "available" {
            continue;
        }
        let listing = match list_project_wikis(app, &project.id) {
            Ok(listing) => listing,
            Err(_) => continue,
        };
        for instance in listing.instances {
            let resolved = match resolve_wiki_instance(app, &project.id, &instance.wiki_id) {
                Ok(resolved) if resolved.provider == instance.provider => resolved,
                Ok(_) => {
                    failures.push(HubWikiSearchFailure {
                        project_id: project.id.clone(),
                        project_name: project.name.clone(),
                        provider: instance.provider,
                        wiki_id: instance.wiki_id,
                        source_root: instance.source_root,
                        message: "Wiki instance provider does not match its identity.".to_string(),
                    });
                    continue;
                }
                Err(error) => {
                    failures.push(HubWikiSearchFailure {
                        project_id: project.id.clone(),
                        project_name: project.name.clone(),
                        provider: instance.provider,
                        wiki_id: instance.wiki_id,
                        source_root: instance.source_root,
                        message: error.message,
                    });
                    continue;
                }
            };
            let source_root = instance.source_root;
            let (wiki_root, catalog_path, flat_pages) = match instance.provider {
                "open_zread" => {
                    let wiki_root = resolved.source_root.join(".open-zread").join("wiki");
                    let catalog_path = wiki_root.join("wiki.json");
                    (wiki_root, catalog_path, false)
                }
                "zread" => {
                    let zread_root = resolved.source_root.join(".zread").join("wiki");
                    let pointer = fs::read_to_string(zread_root.join("current"))
                        .ok()
                        .map(|value| value.trim_start_matches('\u{feff}').trim().to_string());
                    let Some(pointer) = pointer else {
                        failures.push(HubWikiSearchFailure {
                            project_id: project.id.clone(),
                            project_name: project.name.clone(),
                            provider: "zread",
                            wiki_id: instance.wiki_id,
                            source_root,
                            message: "Zread version pointer is missing or unreadable.".to_string(),
                        });
                        continue;
                    };
                    let Some(version_root) = safe_page_path(&zread_root, &[&pointer]) else {
                        failures.push(HubWikiSearchFailure {
                            project_id: project.id.clone(),
                            project_name: project.name.clone(),
                            provider: "zread",
                            wiki_id: instance.wiki_id,
                            source_root,
                            message: "Zread version pointer is invalid or outside its Wiki."
                                .to_string(),
                        });
                        continue;
                    };
                    let catalog_path = version_root.join("wiki.json");
                    (version_root, catalog_path, true)
                }
                _ => continue,
            };
            match search_catalog(
                &project.id,
                &project.name,
                instance.provider,
                &instance.wiki_id,
                &source_root,
                &wiki_root,
                &catalog_path,
                query,
                flat_pages,
            ) {
                Ok(mut matches) => results.append(&mut matches),
                Err(message) => failures.push(HubWikiSearchFailure {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    provider: instance.provider,
                    wiki_id: instance.wiki_id,
                    source_root,
                    message,
                }),
            }
        }
    }
    let mut markdown_results = Vec::new();
    let mut markdown_failures = Vec::new();
    for project in list_projects(app)? {
        if project.availability != "available" {
            markdown_failures.push(HubMarkdownSearchFailure {
                project_id: project.id,
                project_name: project.name,
                relative_path: None,
                message: "Project directory is unavailable; local Markdown was not searched."
                    .to_string(),
            });
            continue;
        }
        match search_markdown_project(app, &project.id, &project.name, query) {
            Ok(response) => {
                markdown_results.extend(response.results);
                for file_error in response.errors {
                    markdown_failures.push(HubMarkdownSearchFailure {
                        project_id: project.id.clone(),
                        project_name: project.name.clone(),
                        relative_path: Some(file_error.relative_path),
                        message: file_error.message,
                    });
                }
                if let Some(warning) = response.warning {
                    markdown_failures.push(HubMarkdownSearchFailure {
                        project_id: project.id.clone(),
                        project_name: project.name.clone(),
                        relative_path: None,
                        message: warning,
                    });
                }
            }
            Err(error) => markdown_failures.push(HubMarkdownSearchFailure {
                project_id: project.id,
                project_name: project.name,
                relative_path: None,
                message: error.message,
            }),
        }
    }
    Ok(HubWikiSearchResponse {
        query: query.to_string(),
        results,
        failures,
        markdown_results,
        markdown_failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn snippet_keeps_unicode_context() {
        let value = snippet("前文\nProvider 协同工作\n后文", "协同");
        assert!(value.contains("协同"));
    }

    #[test]
    fn snippet_is_bounded_without_splitting_multibyte_characters() {
        let content = format!("{}命中{}", "前文。".repeat(150), "后文。".repeat(150));
        let value = snippet(&content, "命中");
        assert!(value.contains("命中"));
        assert!(value.chars().count() <= 220);
    }

    #[test]
    fn markdown_match_location_reports_unicode_line_and_column() {
        assert_eq!(
            markdown_content_location("标题\n说明 协同 Provider", "协同"),
            Some((2, 4, 2))
        );
    }

    #[test]
    fn catalog_results_keep_their_wiki_instance_identity() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("open-zread-search-{suffix}"));
        create_dir_all(&root).expect("temporary Wiki root should be created");
        write(
            root.join("wiki.json"),
            r#"{"pages":[{"slug":"overview","title":"Overview","file":"overview.md"}]}"#,
        )
        .expect("test catalog should be written");
        write(root.join("overview.md"), "needle in nested Wiki")
            .expect("test page should be written");

        let results = search_catalog(
            "project-1",
            "Project",
            "open_zread",
            "open_zread@framework",
            "framework",
            &root,
            &root.join("wiki.json"),
            "needle",
            false,
        )
        .expect("valid Wiki catalog should be searchable");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].wiki_id, "open_zread@framework");
        assert_eq!(results[0].source_root, "framework");
        remove_dir_all(root).expect("temporary Wiki root should be removed");
    }
}
