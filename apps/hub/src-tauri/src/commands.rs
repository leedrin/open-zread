use crate::contracts::{
    CancelTaskResponse, HubCommandError, HubHealth, HubProject, HubRunnerInfo, HubServiceHealth,
    HubTaskEvent, RegisterProjectResponse, TASK_EVENT,
};
use crate::projects::{list_projects, register_project};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const RUNNER_RESOURCE_DIR: &str = "open-zread";
const RUNNER_EXECUTABLE: &str = "open-zread.exe";
const RUNNER_MANIFEST: &str = "open-zread.manifest.json";

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
    let health = HubHealth {
        app_version: env!("CARGO_PKG_VERSION"),
        runtime: "tauri",
        os: std::env::consts::OS,
        service: HubServiceHealth {
            name: "Hub Application Service",
            status: "healthy",
        },
        runner: inspect_runner(&app),
    };

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

/// Cancellation is deliberately explicit and typed even before task execution
/// is added. A missing task never looks like a successful cancellation.
#[tauri::command]
pub fn cancel_hub_task(task_id: String) -> Result<CancelTaskResponse, HubCommandError> {
    if task_id.trim().is_empty() {
        return Err(HubCommandError {
            code: "invalid_request",
            message: "Task id is required.".to_string(),
            retryable: false,
        });
    }

    Err(HubCommandError {
        code: "task_not_found",
        message: format!("Task '{}' is not active.", task_id.trim()),
        retryable: false,
    })
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
}
