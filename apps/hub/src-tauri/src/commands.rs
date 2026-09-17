use crate::contracts::{
    CancelTaskResponse, HubCommandError, HubHealth, HubOpenZreadWiki, HubProject,
    HubProviderCapabilities, HubProviderContentHealth, HubProviderGeneratorHealth,
    HubProviderHealth, HubRunnerInfo, HubServiceHealth, HubSourceFile, HubTask, HubTaskEvent,
    HubWikiAnswerReference, HubWikiAnswerResponse, HubWikiAsset, HubWikiChangeSet,
    HubWikiHistoryEntry, HubWikiMergeResponse, HubWikiPageDraftResponse,
    HubWikiPageMutationResponse, HubWikiSearchResponse, RegisterProjectResponse, TASK_EVENT,
};
use crate::mutations::ChangeSetCoordinator;
use crate::projects::{
    list_projects, open_project_folder, open_project_terminal, register_project, relocate_project,
    remove_project, set_project_favorite,
};
use crate::reader::{
    read_open_zread_asset, read_open_zread_source, read_open_zread_wiki, read_zread_asset,
    read_zread_source, read_zread_wiki,
};
use crate::tasks::TaskCoordinator;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const RUNNER_RESOURCE_DIR: &str = "open-zread";
const RUNNER_EXECUTABLE: &str = "open-zread.exe";
const RUNNER_MANIFEST: &str = "open-zread.manifest.json";
const PROVIDER_SETTINGS_FILE: &str = "provider-settings.json";
const ZREAD_NOT_DETECTED: &str = "Not detected";

fn command_error(
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

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSettings {
    zread_executable: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerManifest {
    schema_version: u8,
    provider: String,
    version: String,
    executable: String,
    resources: Vec<String>,
}

fn runner_resource_root(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|path| path.join(RUNNER_RESOURCE_DIR))
}

fn read_runner_manifest(manifest_path: &Path) -> Option<RunnerManifest> {
    std::fs::read_to_string(manifest_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<RunnerManifest>(&contents).ok())
}

fn manifest_version(manifest: Option<&RunnerManifest>) -> Option<String> {
    manifest
        .map(|manifest| manifest.version.trim().to_string())
        .filter(|version| !version.is_empty())
}

fn read_executable_version(executable: &Path) -> Option<String> {
    let output = Command::new(executable).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty())
}

fn has_expected_resources(root: &Path, resources: &[String]) -> bool {
    resources.iter().all(|resource| match resource.as_str() {
        "browse" => root.join("browse").is_dir(),
        "yoga.wasm" => root.join("yoga.wasm").is_file(),
        "tree-sitter.wasm" => root.join("tree-sitter.wasm").is_file(),
        "mappings.wasm" => root.join("mappings.wasm").is_file(),
        _ => false,
    })
}

fn is_runner_available(
    root: &Path,
    executable: &Path,
    manifest: Option<&RunnerManifest>,
    executable_version: Option<&str>,
) -> bool {
    executable.is_file()
        && manifest.is_some_and(|manifest| {
            manifest.schema_version == 1
                && manifest.provider == "open-zread"
                && manifest.executable == RUNNER_EXECUTABLE
                && !manifest.version.trim().is_empty()
                && executable_version == Some(manifest.version.trim())
                && has_expected_resources(root, &manifest.resources)
        })
}

fn inspect_runner(app: &AppHandle) -> HubRunnerInfo {
    let Some(root) = runner_resource_root(app) else {
        return HubRunnerInfo {
            status: "unavailable",
            version: "unknown".to_string(),
            executable_path: "resource directory unavailable".to_string(),
        };
    };
    let executable = root.join(RUNNER_EXECUTABLE);
    let manifest = root.join(RUNNER_MANIFEST);
    let parsed_manifest = read_runner_manifest(&manifest);
    let executable_version = executable
        .is_file()
        .then(|| read_executable_version(&executable))
        .flatten();
    let available = is_runner_available(
        &root,
        &executable,
        parsed_manifest.as_ref(),
        executable_version.as_deref(),
    );

    HubRunnerInfo {
        status: if available {
            "available"
        } else {
            "unavailable"
        },
        version: executable_version
            .or_else(|| manifest_version(parsed_manifest.as_ref()))
            .unwrap_or_else(|| "unknown".to_string()),
        executable_path: executable.to_string_lossy().into_owned(),
    }
}

pub(crate) fn embedded_runner_executable(app: &AppHandle) -> Result<PathBuf, HubCommandError> {
    let runner = inspect_runner(app);
    if runner.status != "available" {
        return Err(HubCommandError {
            code: "service_unavailable",
            message: "The embedded OpenZread runner is unavailable.".to_string(),
            retryable: true,
        });
    }
    Ok(PathBuf::from(runner.executable_path))
}

fn unavailable_provider_capabilities() -> HubProviderCapabilities {
    HubProviderCapabilities {
        generate: false,
        regenerate: false,
        sync: false,
        login: false,
        custom_api_key_login: false,
        machine_readable: false,
        unattended: false,
        existing_draft_actions: false,
        skip_failed_pages: false,
        cli_self_update: false,
        structured_progress: false,
        incremental_wiki_update: false,
    }
}

fn open_zread_capabilities() -> HubProviderCapabilities {
    // The embedded runner exposes the Hub-owned machine-readable wiki command.
    // Sync is implemented by the OpenZread application service: it computes a
    // real manifest diff before asking the model to regenerate affected pages.
    HubProviderCapabilities {
        generate: true,
        regenerate: true,
        sync: true,
        login: false,
        custom_api_key_login: false,
        machine_readable: true,
        unattended: true,
        existing_draft_actions: false,
        skip_failed_pages: false,
        cli_self_update: false,
        structured_progress: true,
        incremental_wiki_update: true,
    }
}

fn provider_content() -> HubProviderContentHealth {
    HubProviderContentHealth {
        status: "project_scoped",
    }
}

fn open_zread_provider_health(runner: &HubRunnerInfo) -> HubProviderHealth {
    HubProviderHealth {
        provider: "open_zread",
        content: provider_content(),
        generator: HubProviderGeneratorHealth {
            status: if runner.status == "available" {
                "available"
            } else {
                "unavailable"
            },
            version: runner.version.clone(),
            executable_path: runner.executable_path.clone(),
            executable_source: "embedded",
            diagnostics: if runner.status == "available" {
                Vec::new()
            } else {
                vec!["The embedded OpenZread runner is unavailable.".to_string()]
            },
        },
        capabilities: if runner.status == "available" {
            open_zread_capabilities()
        } else {
            unavailable_provider_capabilities()
        },
        config_source: "hub_shared",
    }
}

fn zread_command(executable: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new(executable)
        .args(args)
        .output()
        .map_err(|error| format!("Unable to run Zread {}: {error}", args.join(" ")))
}

fn zread_version(stdout: &[u8]) -> Option<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .find_map(|value| {
            value
                .get("vm")
                .and_then(|vm| vm.get("version"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .filter(|version| !version.trim().is_empty())
}

fn zread_output_diagnostics(label: &str, output: &Output) -> Vec<String> {
    if output.status.success() {
        return Vec::new();
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let details = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if details.is_empty() {
        vec![format!(
            "Zread {label} command failed with exit code {}.",
            output.status.code().unwrap_or(-1)
        )]
    } else {
        details
            .into_iter()
            .map(|line| format!("Zread {label}: {line}"))
            .collect()
    }
}

fn zread_cli_capabilities(
    version: &str,
    generate_help: &str,
    login_help: &str,
    update_help: &str,
) -> HubProviderCapabilities {
    let machine_readable = generate_help.contains("--stdio");
    let generate = generate_help.contains("Generate wiki documentation");
    HubProviderCapabilities {
        generate,
        regenerate: generate,
        sync: false,
        login: login_help.contains("Login flow"),
        custom_api_key_login: login_help.contains("--custom"),
        machine_readable,
        unattended: generate_help.contains("--yes"),
        existing_draft_actions: generate_help.contains("--draft"),
        skip_failed_pages: generate_help.contains("--skip-failed"),
        cli_self_update: update_help.contains("Update Zread to the latest version"),
        structured_progress: machine_readable && version == "0.2.13",
        incremental_wiki_update: false,
    }
}

fn native_zread_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

fn zread_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(output) = Command::new("where.exe").arg("zread.exe").output() {
        candidates.extend(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from),
        );
    }
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Ok(root) = std::env::var(variable) {
            candidates.push(
                PathBuf::from(root)
                    .join("npm")
                    .join("node_modules")
                    .join("zread_cli")
                    .join("node_modules")
                    .join("@zread")
                    .join("cli-win32-x64")
                    .join("zread.exe"),
            );
        }
    }
    candidates
}

fn discover_zread_executable() -> Option<PathBuf> {
    zread_candidates()
        .into_iter()
        .find(|candidate| native_zread_executable(candidate))
}

fn provider_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(PROVIDER_SETTINGS_FILE))
        .map_err(|error| format!("Unable to resolve Hub provider settings: {error}"))
}

fn configured_zread_executable(app: &AppHandle) -> (Option<(PathBuf, &'static str)>, Vec<String>) {
    let Ok(path) = provider_settings_path(app) else {
        return (
            discover_zread_executable().map(|path| (path, "auto_detected")),
            vec!["Hub provider settings are unavailable; using automatic detection.".to_string()],
        );
    };
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (
                discover_zread_executable().map(|path| (path, "auto_detected")),
                Vec::new(),
            )
        }
        Err(error) => {
            return (
                discover_zread_executable().map(|path| (path, "auto_detected")),
                vec![format!("Unable to read Hub provider settings: {error}")],
            )
        }
    };
    match serde_json::from_str::<ProviderSettings>(&contents) {
        Ok(settings) => settings
            .zread_executable
            .filter(|path| !path.trim().is_empty())
            .map(|path| (PathBuf::from(path), "manual"))
            .map_or_else(
                || {
                    (
                        discover_zread_executable().map(|path| (path, "auto_detected")),
                        Vec::new(),
                    )
                },
                |path| (Some(path), Vec::new()),
            ),
        Err(error) => (
            discover_zread_executable().map(|path| (path, "auto_detected")),
            vec![format!("Hub provider settings are invalid: {error}")],
        ),
    }
}

fn inspect_zread_provider(
    executable: Option<(PathBuf, &'static str)>,
    mut diagnostics: Vec<String>,
) -> HubProviderHealth {
    let Some((path, executable_source)) = executable else {
        diagnostics.push(
            "No native zread.exe was detected. Choose the executable path to configure Zread."
                .to_string(),
        );
        return HubProviderHealth {
            provider: "zread",
            content: provider_content(),
            generator: HubProviderGeneratorHealth {
                status: "not_configured",
                version: "unknown".to_string(),
                executable_path: ZREAD_NOT_DETECTED.to_string(),
                executable_source: "not_detected",
                diagnostics,
            },
            capabilities: unavailable_provider_capabilities(),
            config_source: "not_configured",
        };
    };

    let executable_path = path.to_string_lossy().into_owned();
    let mut version = "unknown".to_string();
    let mut capabilities = unavailable_provider_capabilities();
    let mut status = "unavailable";

    if !native_zread_executable(&path) {
        diagnostics.push("The configured path is not an existing native zread.exe.".to_string());
    } else {
        match zread_command(&path, &["version", "--stdio"]) {
            Ok(output) if output.status.success() => {
                if let Some(detected_version) = zread_version(&output.stdout) {
                    version = detected_version;
                    let checks = [
                        ("generate", ["generate", "--help"].as_slice()),
                        ("login", ["login", "--help"].as_slice()),
                        ("update", ["update", "--help"].as_slice()),
                    ];
                    let mut help_outputs = Vec::new();
                    for (label, args) in checks {
                        match zread_command(&path, args) {
                            Ok(output) => {
                                diagnostics.extend(zread_output_diagnostics(label, &output));
                                help_outputs.push(output);
                            }
                            Err(error) => diagnostics.push(error),
                        }
                    }
                    if help_outputs.len() == 3 && diagnostics.is_empty() {
                        let generate_help = String::from_utf8_lossy(&help_outputs[0].stdout);
                        let login_help = String::from_utf8_lossy(&help_outputs[1].stdout);
                        let update_help = String::from_utf8_lossy(&help_outputs[2].stdout);
                        capabilities = zread_cli_capabilities(
                            &version,
                            &generate_help,
                            &login_help,
                            &update_help,
                        );
                        status = "available";
                    }
                } else {
                    diagnostics.push(
                        "Zread version output did not contain machine-readable version data."
                            .to_string(),
                    );
                }
            }
            Ok(output) => diagnostics.extend(zread_output_diagnostics("version", &output)),
            Err(error) => diagnostics.push(error),
        }
    }

    HubProviderHealth {
        provider: "zread",
        content: provider_content(),
        generator: HubProviderGeneratorHealth {
            status,
            version,
            executable_path,
            executable_source,
            diagnostics,
        },
        capabilities,
        config_source: "zread_native",
    }
}

pub(crate) fn native_zread_runner_executable(app: &AppHandle) -> Result<PathBuf, HubCommandError> {
    let (configured, diagnostics) = configured_zread_executable(app);
    let health = inspect_zread_provider(configured.clone(), diagnostics);
    if health.generator.status != "available" {
        return Err(HubCommandError {
            code: "service_unavailable",
            message: if health.generator.diagnostics.is_empty() {
                "The configured native Zread runner is unavailable.".to_string()
            } else {
                health.generator.diagnostics.join(" ")
            },
            retryable: true,
        });
    }
    configured
        .map(|(path, _)| path)
        .ok_or_else(|| HubCommandError {
            code: "service_unavailable",
            message: "No native zread.exe is configured.".to_string(),
            retryable: true,
        })
}

fn save_zread_executable(app: &AppHandle, executable: &Path) -> Result<(), HubCommandError> {
    let path = provider_settings_path(app).map_err(|message| HubCommandError {
        code: "internal_error",
        message,
        retryable: true,
    })?;
    let directory = path.parent().ok_or_else(|| HubCommandError {
        code: "internal_error",
        message: "Unable to resolve Hub provider settings directory.".to_string(),
        retryable: true,
    })?;
    std::fs::create_dir_all(directory).map_err(|error| HubCommandError {
        code: "internal_error",
        message: format!("Unable to create Hub provider settings: {error}"),
        retryable: true,
    })?;
    let contents = serde_json::to_string_pretty(&ProviderSettings {
        zread_executable: Some(executable.to_string_lossy().into_owned()),
    })
    .map_err(|error| HubCommandError {
        code: "internal_error",
        message: format!("Unable to serialize Hub provider settings: {error}"),
        retryable: true,
    })?;
    std::fs::write(path, contents).map_err(|error| HubCommandError {
        code: "internal_error",
        message: format!("Unable to persist Hub provider settings: {error}"),
        retryable: true,
    })
}

fn build_hub_health(app: &AppHandle) -> HubHealth {
    let runner = inspect_runner(app);
    let (zread_executable, diagnostics) = configured_zread_executable(app);
    HubHealth {
        app_version: env!("CARGO_PKG_VERSION"),
        runtime: "tauri",
        os: std::env::consts::OS,
        service: HubServiceHealth {
            name: "Hub Application Service",
            status: "healthy",
        },
        providers: vec![
            open_zread_provider_health(&runner),
            inspect_zread_provider(zread_executable, diagnostics),
        ],
        runner,
    }
}

pub(crate) fn emit_task_event(app: &AppHandle, event: HubTaskEvent) -> Result<(), HubCommandError> {
    app.emit(TASK_EVENT, event)
        .map_err(|error| HubCommandError {
            code: "internal_error",
            message: format!("Unable to publish task event: {error}"),
            retryable: true,
        })
}

/// Thin command facade. Workflow logic belongs in the Hub Application Service,
/// not in React and not in the transport handlers.
#[tauri::command]
pub fn get_hub_health(app: AppHandle) -> HubHealth {
    let health = build_hub_health(&app);

    // The foundation command also proves that a typed task event can travel
    // from the Tauri application service to React. Real generation commands
    // will emit the same contract for their queued/running/terminal stages.
    let _ = emit_task_event(
        &app,
        HubTaskEvent {
            task_id: "health-check".to_string(),
            kind: "maintenance",
            status: "succeeded",
            phase: "health-check".to_string(),
            occurred_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis().to_string())
                .unwrap_or_else(|_| "0".to_string()),
            message: Some("Application service health check completed.".to_string()),
            progress: None,
        },
    );

    health
}

#[tauri::command]
pub fn set_hub_zread_executable(
    app: AppHandle,
    executable_path: String,
) -> Result<HubHealth, HubCommandError> {
    let trimmed = executable_path.trim();
    let path = PathBuf::from(trimmed);
    if trimmed.is_empty() || !path.is_absolute() || !native_zread_executable(&path) {
        return Err(HubCommandError {
            code: "invalid_request",
            message: "An existing absolute native zread.exe path is required.".to_string(),
            retryable: false,
        });
    }
    save_zread_executable(&app, &path)?;
    Ok(build_hub_health(&app))
}

#[tauri::command]
pub fn start_hub_open_zread_task(
    app: AppHandle,
    coordinator: State<'_, TaskCoordinator>,
    project_id: String,
    operation: String,
) -> Result<HubTask, HubCommandError> {
    crate::tasks::start_open_zread_task(&app, &coordinator, &project_id, &operation)
}

#[tauri::command]
pub fn start_hub_zread_task(
    app: AppHandle,
    coordinator: State<'_, TaskCoordinator>,
    project_id: String,
) -> Result<HubTask, HubCommandError> {
    crate::tasks::start_zread_task(&app, &coordinator, &project_id)
}

#[tauri::command]
pub fn preview_hub_wiki_change(
    app: AppHandle,
    coordinator: State<'_, ChangeSetCoordinator>,
    project_id: String,
    provider: String,
    slug: String,
    content: String,
) -> Result<HubWikiChangeSet, HubCommandError> {
    crate::mutations::preview_change(&app, &coordinator, &project_id, &provider, &slug, &content)
}

#[tauri::command]
pub fn apply_hub_wiki_change(
    app: AppHandle,
    coordinator: State<'_, ChangeSetCoordinator>,
    change_set_id: String,
) -> Result<HubWikiChangeSet, HubCommandError> {
    crate::mutations::apply_change(&app, &coordinator, &change_set_id)
}

#[tauri::command]
pub fn list_hub_wiki_history(
    app: AppHandle,
    project_id: String,
    provider: String,
) -> Result<Vec<HubWikiHistoryEntry>, HubCommandError> {
    crate::history::list_history(&app, &project_id, &provider)
}

#[tauri::command]
pub fn restore_hub_wiki_history(
    app: AppHandle,
    project_id: String,
    provider: String,
    history_id: String,
) -> Result<HubWikiHistoryEntry, HubCommandError> {
    crate::history::restore_history(&app, &project_id, &provider, &history_id)
}

#[tauri::command]
pub fn search_hub_wiki(
    app: AppHandle,
    query: String,
) -> Result<HubWikiSearchResponse, HubCommandError> {
    crate::search::search_wiki(&app, &query)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_hub_wiki_page(
    app: AppHandle,
    project_id: String,
    provider: String,
    slug: String,
    title: String,
    section: String,
    group: Option<String>,
    content: String,
    associated_files: Vec<String>,
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    crate::page_ops::create_page(
        &app,
        &project_id,
        &provider,
        &slug,
        &title,
        &section,
        group.as_deref(),
        &content,
        &associated_files,
    )
}

#[tauri::command]
pub fn delete_hub_wiki_page(
    app: AppHandle,
    project_id: String,
    provider: String,
    slug: String,
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    crate::page_ops::delete_page(&app, &project_id, &provider, &slug)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_hub_wiki_page_metadata(
    app: AppHandle,
    project_id: String,
    provider: String,
    slug: String,
    new_slug: Option<String>,
    title: Option<String>,
    section: Option<String>,
    group: Option<String>,
    associated_files: Option<Vec<String>>,
    order: Option<u32>,
    clear_group: Option<bool>,
) -> Result<HubWikiPageMutationResponse, HubCommandError> {
    crate::page_ops::update_metadata(
        &app,
        &project_id,
        &provider,
        &slug,
        new_slug.as_deref(),
        title.as_deref(),
        section.as_deref(),
        group.as_deref(),
        associated_files.as_deref(),
        order,
        clear_group.unwrap_or(false),
    )
}

#[tauri::command]
pub fn merge_hub_wiki_text(
    base: String,
    local: String,
    incoming: String,
) -> Result<HubWikiMergeResponse, HubCommandError> {
    crate::merge::merge_text(&base, &local, &incoming)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerAnswerReference {
    slug: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerAnswer {
    kind: String,
    status: String,
    answer: String,
    references: Vec<RunnerAnswerReference>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerRewrite {
    kind: String,
    status: String,
    after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerDraft {
    kind: String,
    status: String,
    slug: String,
    title: String,
    section: String,
    content: String,
    associated_files: Vec<String>,
}

fn markdown_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim();
    let level = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&level) || trimmed.chars().nth(level) != Some(' ') {
        return None;
    }
    let text = trimmed[level..].trim().trim_end_matches('#').trim();
    (!text.is_empty()).then(|| (level, text.to_string()))
}

fn rewrite_scope_is_preserved(before: &str, after: &str, requested_heading: &str) -> bool {
    let requested = requested_heading
        .trim()
        .trim_start_matches('#')
        .trim()
        .trim_end_matches('#')
        .trim();
    if requested.is_empty() {
        return false;
    }
    let locate = |content: &str| {
        let mut fenced = false;
        let lines = content.split_inclusive('\n').collect::<Vec<_>>();
        let start = lines.iter().enumerate().find_map(|(index, line)| {
            if line.trim_start().starts_with("```") {
                fenced = !fenced;
                return None;
            }
            if fenced {
                return None;
            }
            markdown_heading(line)
                .filter(|(_, text)| text == requested)
                .map(|(level, _)| (index, level))
        })?;
        let end = lines
            .iter()
            .enumerate()
            .skip(start.0 + 1)
            .find_map(|(index, line)| {
                markdown_heading(line)
                    .filter(|(level, _)| *level <= start.1)
                    .map(|_| index)
            })
            .unwrap_or(lines.len());
        Some((
            lines[..start.0].concat(),
            lines[start.0..end].concat(),
            lines[end..].concat(),
        ))
    };
    let Some((before_prefix, _, before_suffix)) = locate(before) else {
        return false;
    };
    let Some((after_prefix, _, after_suffix)) = locate(after) else {
        return false;
    };
    before_prefix == after_prefix && before_suffix == after_suffix
}

#[tauri::command]
pub fn ask_hub_wiki(
    app: AppHandle,
    project_id: String,
    provider: String,
    slug: String,
    question: String,
    selected_text: Option<String>,
) -> Result<HubWikiAnswerResponse, HubCommandError> {
    let project_id = project_id.trim();
    let slug = slug.trim();
    let question = question.trim();
    if project_id.is_empty() || slug.is_empty() || question.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Project id, page slug, and question are required.",
            false,
        ));
    }
    let page = match provider.as_str() {
        "open_zread" => read_open_zread_wiki(&app, project_id)?,
        "zread" => read_zread_wiki(&app, project_id)?,
        _ => {
            return Err(command_error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let page = page
        .pages
        .iter()
        .find(|page| page.slug == slug)
        .ok_or_else(|| command_error("source_not_found", "The Wiki page was not found.", false))?;
    let content = page.content.clone().ok_or_else(|| {
        command_error(
            "wiki_read_failed",
            "The selected Wiki page has no readable content.",
            true,
        )
    })?;
    let project = list_projects(&app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| {
            command_error(
                "project_not_found",
                "The selected Project is not registered.",
                false,
            )
        })?;
    let executable = embedded_runner_executable(&app)?;
    let input = serde_json::json!({
        "question": question,
        "pageTitle": page.title,
        "pageSlug": page.slug,
        "pageContent": content,
        "selectedText": selected_text.filter(|text| !text.trim().is_empty()),
    });
    let mut process = Command::new(executable)
        .arg("wiki")
        .arg("--stdio")
        .arg("--operation")
        .arg("ask")
        .current_dir(&project.path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|spawn_error| {
            command_error(
                "service_unavailable",
                format!("Unable to start the Hub Q&A runner: {spawn_error}"),
                true,
            )
        })?;
    if let Some(mut stdin) = process.stdin.take() {
        serde_json::to_writer(&mut stdin, &input).map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
        stdin.flush().map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
    }
    let output = process
        .wait_with_output()
        .map_err(|wait_error| command_error("service_unavailable", wait_error.to_string(), true))?;
    if !output.status.success() {
        return Err(command_error(
            "service_unavailable",
            "The configured Hub model could not answer the Wiki question.",
            true,
        ));
    }
    let answer = serde_json::from_slice::<RunnerAnswer>(&output.stdout).map_err(|_| {
        command_error(
            "internal_error",
            "The Hub Q&A runner returned an invalid response.",
            true,
        )
    })?;
    if answer.kind != "qa" || answer.status != "succeeded" || answer.answer.trim().is_empty() {
        return Err(command_error(
            "service_unavailable",
            "The Hub Q&A runner did not return an answer.",
            true,
        ));
    }
    Ok(HubWikiAnswerResponse {
        project_id: project_id.to_string(),
        provider: if provider == "zread" {
            "zread"
        } else {
            "open_zread"
        },
        slug: slug.to_string(),
        answer: answer.answer,
        references: answer
            .references
            .into_iter()
            .map(|reference| HubWikiAnswerReference {
                slug: reference.slug,
                title: reference.title,
            })
            .collect(),
    })
}

#[tauri::command]
pub fn rewrite_hub_wiki_page(
    app: AppHandle,
    coordinator: State<'_, ChangeSetCoordinator>,
    project_id: String,
    provider: String,
    slug: String,
    instruction: String,
    section_heading: Option<String>,
) -> Result<HubWikiChangeSet, HubCommandError> {
    let project_id = project_id.trim();
    let slug = slug.trim();
    let instruction = instruction.trim();
    if project_id.is_empty() || slug.is_empty() || instruction.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Project id, page slug, and rewrite instruction are required.",
            false,
        ));
    }
    let page = match provider.as_str() {
        "open_zread" => read_open_zread_wiki(&app, project_id)?,
        "zread" => read_zread_wiki(&app, project_id)?,
        _ => {
            return Err(command_error(
                "invalid_request",
                "Wiki provider must be open_zread or zread.",
                false,
            ))
        }
    };
    let page = page
        .pages
        .iter()
        .find(|page| page.slug == slug)
        .ok_or_else(|| command_error("source_not_found", "The Wiki page was not found.", false))?;
    let before = page.content.clone().ok_or_else(|| {
        command_error(
            "wiki_read_failed",
            "The selected Wiki page has no readable content.",
            true,
        )
    })?;
    let project = list_projects(&app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| {
            command_error(
                "project_not_found",
                "The selected Project is not registered.",
                false,
            )
        })?;
    let executable = embedded_runner_executable(&app)?;
    let input = serde_json::json!({
        "instruction": instruction,
        "pageTitle": page.title,
        "pageSlug": page.slug,
        "pageContent": before,
        "sectionHeading": section_heading,
    });
    let mut process = Command::new(executable)
        .arg("wiki")
        .arg("--stdio")
        .arg("--operation")
        .arg("rewrite")
        .current_dir(&project.path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|spawn_error| {
            command_error("service_unavailable", spawn_error.to_string(), true)
        })?;
    if let Some(mut stdin) = process.stdin.take() {
        serde_json::to_writer(&mut stdin, &input).map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
        stdin.flush().map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
    }
    let output = process
        .wait_with_output()
        .map_err(|wait_error| command_error("service_unavailable", wait_error.to_string(), true))?;
    if !output.status.success() {
        return Err(command_error(
            "service_unavailable",
            "The configured Hub model could not create a Wiki rewrite draft.",
            true,
        ));
    }
    let rewrite = serde_json::from_slice::<RunnerRewrite>(&output.stdout).map_err(|_| {
        command_error(
            "internal_error",
            "The rewrite runner returned an invalid response.",
            true,
        )
    })?;
    if rewrite.kind != "rewrite" || rewrite.status != "succeeded" || rewrite.after.trim().is_empty()
    {
        return Err(command_error(
            "service_unavailable",
            "The rewrite runner did not return a Markdown draft.",
            true,
        ));
    }
    if let Some(heading) = section_heading.as_deref() {
        if !rewrite_scope_is_preserved(&before, &rewrite.after, heading) {
            return Err(command_error(
                "conflict",
                "The rewrite draft changed content outside the selected Markdown section.",
                false,
            ));
        }
    }
    crate::mutations::preview_change(
        &app,
        &coordinator,
        project_id,
        &provider,
        slug,
        &rewrite.after,
    )
}

#[tauri::command]
pub fn draft_hub_wiki_page(
    app: AppHandle,
    project_id: String,
    provider: String,
    topic: String,
    section: Option<String>,
) -> Result<HubWikiPageDraftResponse, HubCommandError> {
    let project_id = project_id.trim();
    let topic = topic.trim();
    if project_id.is_empty() || topic.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Project id and page topic are required.",
            false,
        ));
    }
    if provider != "open_zread" && provider != "zread" {
        return Err(command_error(
            "invalid_request",
            "Wiki provider must be open_zread or zread.",
            false,
        ));
    }
    let project = list_projects(&app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| {
            command_error(
                "project_not_found",
                "The selected Project is not registered.",
                false,
            )
        })?;
    let existing_sections = match provider.as_str() {
        "open_zread" => read_open_zread_wiki(&app, project_id)?.pages,
        "zread" => read_zread_wiki(&app, project_id)?.pages,
        _ => unreachable!(),
    }
    .into_iter()
    .map(|page| page.section)
    .collect::<std::collections::BTreeSet<_>>();
    let executable = embedded_runner_executable(&app)?;
    let input = serde_json::json!({
        "topic": topic,
        "section": section.filter(|value| !value.trim().is_empty()),
        "existingSections": existing_sections,
    });
    let mut process = Command::new(executable)
        .arg("wiki")
        .arg("--stdio")
        .arg("--operation")
        .arg("draft")
        .current_dir(&project.path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|spawn_error| {
            command_error("service_unavailable", spawn_error.to_string(), true)
        })?;
    if let Some(mut stdin) = process.stdin.take() {
        serde_json::to_writer(&mut stdin, &input).map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
        stdin.flush().map_err(|write_error| {
            command_error("internal_error", write_error.to_string(), true)
        })?;
    }
    let output = process
        .wait_with_output()
        .map_err(|wait_error| command_error("service_unavailable", wait_error.to_string(), true))?;
    if !output.status.success() {
        return Err(command_error(
            "service_unavailable",
            "The configured Hub model could not create a Wiki page draft.",
            true,
        ));
    }
    let draft = serde_json::from_slice::<RunnerDraft>(&output.stdout).map_err(|_| {
        command_error(
            "internal_error",
            "The draft runner returned an invalid response.",
            true,
        )
    })?;
    if draft.kind != "draft"
        || draft.status != "succeeded"
        || draft.slug.trim().is_empty()
        || draft.title.trim().is_empty()
        || draft.section.trim().is_empty()
        || draft.content.trim().is_empty()
    {
        return Err(command_error(
            "service_unavailable",
            "The draft runner did not return a complete Wiki page draft.",
            true,
        ));
    }
    Ok(HubWikiPageDraftResponse {
        provider: if provider == "zread" {
            "zread"
        } else {
            "open_zread"
        },
        slug: draft.slug,
        title: draft.title,
        section: draft.section,
        content: draft.content,
        associated_files: draft.associated_files,
    })
}

#[tauri::command]
pub fn list_hub_projects(app: AppHandle) -> Result<Vec<HubProject>, HubCommandError> {
    list_projects(&app)
}

#[tauri::command]
pub fn register_hub_project(
    app: AppHandle,
    path: String,
) -> Result<RegisterProjectResponse, HubCommandError> {
    register_project(&app, &path)
}

#[tauri::command]
pub fn set_hub_project_favorite(
    app: AppHandle,
    project_id: String,
    favorite: bool,
) -> Result<HubProject, HubCommandError> {
    set_project_favorite(&app, &project_id, favorite)
}

#[tauri::command]
pub fn relocate_hub_project(
    app: AppHandle,
    project_id: String,
    path: String,
) -> Result<HubProject, HubCommandError> {
    relocate_project(&app, &project_id, &path)
}

#[tauri::command]
pub fn remove_hub_project(app: AppHandle, project_id: String) -> Result<(), HubCommandError> {
    remove_project(&app, &project_id)
}

#[tauri::command]
pub fn open_hub_project_folder(
    app: AppHandle,
    project_id: String,
) -> Result<HubProject, HubCommandError> {
    open_project_folder(&app, &project_id)
}

#[tauri::command]
pub fn open_hub_project_terminal(
    app: AppHandle,
    project_id: String,
) -> Result<HubProject, HubCommandError> {
    open_project_terminal(&app, &project_id)
}

#[tauri::command]
pub fn read_hub_open_zread_wiki(
    app: AppHandle,
    project_id: String,
) -> Result<HubOpenZreadWiki, HubCommandError> {
    read_open_zread_wiki(&app, &project_id)
}

#[tauri::command]
pub fn read_hub_open_zread_source(
    app: AppHandle,
    project_id: String,
    path: String,
) -> Result<HubSourceFile, HubCommandError> {
    read_open_zread_source(&app, &project_id, &path)
}

#[tauri::command]
pub fn read_hub_open_zread_asset(
    app: AppHandle,
    project_id: String,
    page_path: String,
    asset_path: String,
) -> Result<HubWikiAsset, HubCommandError> {
    read_open_zread_asset(&app, &project_id, &page_path, &asset_path)
}

#[tauri::command]
pub fn read_hub_zread_wiki(
    app: AppHandle,
    project_id: String,
) -> Result<crate::contracts::HubZreadWiki, HubCommandError> {
    read_zread_wiki(&app, &project_id)
}

#[tauri::command]
pub fn read_hub_zread_source(
    app: AppHandle,
    project_id: String,
    path: String,
) -> Result<HubSourceFile, HubCommandError> {
    read_zread_source(&app, &project_id, &path)
}

#[tauri::command]
pub fn read_hub_zread_asset(
    app: AppHandle,
    project_id: String,
    page_path: String,
    asset_path: String,
) -> Result<HubWikiAsset, HubCommandError> {
    read_zread_asset(&app, &project_id, &page_path, &asset_path)
}

#[tauri::command]
pub fn cancel_hub_task(
    app: AppHandle,
    coordinator: State<'_, TaskCoordinator>,
    task_id: String,
) -> Result<CancelTaskResponse, HubCommandError> {
    crate::tasks::cancel_task(&app, &coordinator, &task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};

    fn test_runner_root() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("open-zread-hub-runner-{suffix}"));
        create_dir_all(root.join("browse")).expect("test runner directory should be created");
        write(root.join(RUNNER_EXECUTABLE), b"test executable")
            .expect("test executable should be created");
        for resource in ["yoga.wasm", "tree-sitter.wasm", "mappings.wasm"] {
            write(root.join(resource), b"test resource").expect("test resource should be created");
        }
        root
    }

    fn valid_manifest() -> RunnerManifest {
        RunnerManifest {
            schema_version: 1,
            provider: "open-zread".to_string(),
            version: "1.2.2".to_string(),
            executable: RUNNER_EXECUTABLE.to_string(),
            resources: vec![
                "browse".to_string(),
                "yoga.wasm".to_string(),
                "tree-sitter.wasm".to_string(),
                "mappings.wasm".to_string(),
            ],
        }
    }

    #[test]
    fn runner_requires_complete_resources_and_matching_executable_version() {
        let root = test_runner_root();
        let executable = root.join(RUNNER_EXECUTABLE);
        let manifest = valid_manifest();

        assert!(is_runner_available(
            &root,
            &executable,
            Some(&manifest),
            Some("1.2.2")
        ));
        assert!(!is_runner_available(
            &root,
            &executable,
            Some(&manifest),
            Some("1.2.1")
        ));

        remove_dir_all(root.join("browse")).expect("test browse directory should be removed");
        assert!(!is_runner_available(
            &root,
            &executable,
            Some(&manifest),
            Some("1.2.2")
        ));

        remove_dir_all(root).expect("test runner directory should be removed");
    }

    #[test]
    fn corrupt_manifest_is_not_accepted() {
        let root = test_runner_root();
        let manifest_path = root.join(RUNNER_MANIFEST);
        write(&manifest_path, b"not json").expect("test manifest should be created");

        assert!(read_runner_manifest(&manifest_path).is_none());
        assert_eq!(manifest_version(None), None);

        remove_dir_all(root).expect("test runner directory should be removed");
    }

    #[test]
    fn parses_machine_readable_zread_version_output() {
        let stdout = br#"noise
{"vm":{"version":"0.2.13","channel":"npm","go_version":"go1.26.0","os":"windows","arch":"amd64"},"done":true}
"#;

        assert_eq!(zread_version(stdout).as_deref(), Some("0.2.13"));
    }

    #[test]
    fn exposes_only_capabilities_verified_by_zread_help_output() {
        let capabilities = zread_cli_capabilities(
            "0.2.13",
            "Generate wiki documentation\n--stdio\n--yes\n--draft\n--skip-failed",
            "Login flow\n--custom",
            "Update Zread to the latest version",
        );

        assert!(capabilities.generate);
        assert!(capabilities.regenerate);
        assert!(capabilities.login);
        assert!(capabilities.custom_api_key_login);
        assert!(capabilities.machine_readable);
        assert!(capabilities.structured_progress);
        assert!(!capabilities.sync);
        assert!(!capabilities.incremental_wiki_update);
    }

    #[test]
    fn section_rewrite_scope_ignores_code_fence_headings_and_rejects_outer_changes() {
        let before = "# Intro\n\n## Target\nold\n\n```md\n# Not a heading\n```\n\n## Other\nkeep\n";
        let inside_changed =
            "# Intro\n\n## Target\nnew\n\n```md\n# Not a heading\n```\n\n## Other\nkeep\n";
        let outside_changed =
            "# Changed\n\n## Target\nnew\n\n```md\n# Not a heading\n```\n\n## Other\nkeep\n";
        assert!(rewrite_scope_is_preserved(before, inside_changed, "Target"));
        assert!(!rewrite_scope_is_preserved(
            before,
            outside_changed,
            "Target"
        ));
        assert!(!rewrite_scope_is_preserved(
            before,
            inside_changed,
            "Not a heading"
        ));
    }

    #[test]
    fn native_zread_detection_requires_an_existing_exe() {
        let root = test_runner_root();
        let executable = root.join("zread.exe");
        write(&executable, b"test executable").expect("test zread executable should be created");

        assert!(native_zread_executable(&executable));
        assert!(!native_zread_executable(&root.join("zread.cmd")));

        remove_dir_all(root).expect("test zread directory should be removed");
    }
}
