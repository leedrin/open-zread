use crate::commands::{embedded_runner_executable, native_zread_runner_executable};
use crate::contracts::{
    CancelTaskResponse, HubCommandError, HubTask, HubTaskEvent, HubTaskProgress, TASK_EVENT,
};
use crate::projects::list_projects;
use crate::wiki_instances::resolve_task_source_root;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const MODEL_LABEL: &str = "Hub shared model configuration";

#[derive(Default, Clone)]
pub struct TaskCoordinator {
    processes: Arc<Mutex<HashMap<String, TaskProcess>>>,
    queue: Arc<Mutex<VecDeque<QueuedTask>>>,
    starting_next: Arc<AtomicBool>,
    starting_identity: Arc<Mutex<Option<QueuedTask>>>,
}

#[derive(Clone)]
struct QueuedTask {
    task_id: String,
    project_id: String,
    wiki_id: String,
    provider: &'static str,
    operation: &'static str,
    resume: bool,
    started_at: String,
}

struct TaskProcess {
    kind: &'static str,
    project_id: String,
    wiki_id: String,
    child: Arc<Mutex<Child>>,
    cancel_requested: Arc<AtomicBool>,
    terminal_emitted: Arc<AtomicBool>,
}

#[derive(Clone)]
struct TaskIdentity {
    project_id: String,
    wiki_id: String,
}

#[derive(Clone)]
enum TaskFlavor {
    OpenZread,
    Zread(ZreadTaskState),
}

#[derive(Clone)]
struct ZreadTaskState {
    project_root: PathBuf,
    previous_pointer: Option<String>,
    previous_current_contents: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerEvent {
    kind: String,
    status: String,
    phase: String,
    message: Option<String>,
    #[serde(default)]
    details: Option<String>,
    progress: Option<RunnerProgress>,
    #[serde(default)]
    can_resume: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RunnerProgress {
    current: u32,
    total: u32,
    #[serde(default)]
    succeeded: Option<u32>,
    #[serde(default)]
    failed: Option<u32>,
}

#[derive(Clone)]
struct StderrTail {
    lines: Arc<Mutex<VecDeque<String>>>,
    closed: Arc<AtomicBool>,
}

fn empty_stderr_tail() -> StderrTail {
    StderrTail {
        lines: Arc::new(Mutex::new(VecDeque::new())),
        closed: Arc::new(AtomicBool::new(true)),
    }
}

fn capture_stderr(stderr: impl BufRead + Send + 'static) -> StderrTail {
    let tail = StderrTail {
        lines: Arc::new(Mutex::new(VecDeque::new())),
        closed: Arc::new(AtomicBool::new(false)),
    };
    let reader_tail = tail.clone();
    std::thread::spawn(move || {
        for line in stderr.lines().map_while(Result::ok) {
            let bounded_line: String = line.chars().take(2_000).collect();
            if let Ok(mut lines) = reader_tail.lines.lock() {
                lines.push_back(bounded_line);
                while lines.len() > 60 {
                    lines.pop_front();
                }
            }
        }
        reader_tail.closed.store(true, Ordering::Release);
    });
    tail
}

fn stderr_details(tail: &StderrTail) -> Option<String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !tail.closed.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let lines = tail.lines.lock().ok()?;
    let details = lines.iter().cloned().collect::<Vec<_>>().join("\n");
    let bounded: String = details
        .chars()
        .rev()
        .take(12_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    (!bounded.trim().is_empty()).then_some(bounded)
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

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

fn emit_event(app: &AppHandle, event: HubTaskEvent) {
    let _ = app.emit(TASK_EVENT, event);
}

fn status_is_terminal(status: &str) -> bool {
    matches!(status, "succeeded" | "failed" | "cancelled" | "interrupted")
}

fn task_is_busy(coordinator: &TaskCoordinator) -> bool {
    coordinator
        .processes
        .lock()
        .map(|processes| !processes.is_empty())
        .unwrap_or(true)
        || coordinator
            .queue
            .lock()
            .map(|queue| !queue.is_empty())
            .unwrap_or(true)
}

fn queued_identity(coordinator: &TaskCoordinator) -> Option<QueuedTask> {
    coordinator
        .starting_identity
        .lock()
        .ok()
        .and_then(|mut identity| identity.take())
}

fn queue_task(
    app: &AppHandle,
    coordinator: &TaskCoordinator,
    task: QueuedTask,
) -> Result<HubTask, HubCommandError> {
    coordinator
        .queue
        .lock()
        .map_err(|_| command_error("internal_error", "Task coordinator is unavailable.", true))?
        .push_back(task.clone());
    emit_event(
        app,
        HubTaskEvent {
            task_id: task.task_id.clone(),
            project_id: Some(task.project_id.clone()),
            wiki_id: Some(task.wiki_id.clone()),
            kind: task_kind(task.operation),
            status: "queued",
            phase: "queued".to_string(),
            occurred_at: now_millis(),
            message: Some("Task queued behind the active Hub task.".to_string()),
            details: None,
            progress: None,
            can_resume: None,
        },
    );
    Ok(HubTask {
        task_id: task.task_id,
        kind: task_kind(task.operation),
        status: "queued",
        project_id: task.project_id,
        wiki_id: task.wiki_id,
        provider: task.provider,
        operation: task.operation,
        model: if task.provider == "zread" {
            "Zread native configuration"
        } else {
            MODEL_LABEL
        },
        started_at: task.started_at,
    })
}

fn restore_zread_current(state: &ZreadTaskState) {
    let current_path = state
        .project_root
        .join(".zread")
        .join("wiki")
        .join("current");
    match &state.previous_current_contents {
        Some(contents) => {
            let _ = std::fs::write(current_path, contents);
        }
        None => {
            let _ = std::fs::remove_file(current_path);
        }
    }
}

fn contained_path(root: &Path, target: &Path) -> bool {
    let Ok(relative) = target.strip_prefix(root) else {
        return false;
    };
    !relative.is_empty() && !relative.is_absolute()
}

fn validate_zread_output(state: &ZreadTaskState) -> Result<(), String> {
    let wiki_root = state.project_root.join(".zread").join("wiki");
    let current_path = wiki_root.join("current");
    let current = std::fs::read_to_string(&current_path)
        .map_err(|error| format!("Zread current pointer is unreadable: {error}"))?;
    let current = current.trim_start_matches('\u{feff}').trim();
    if current.is_empty() {
        return Err("Zread generation did not produce a current version pointer.".to_string());
    }
    if Path::new(current).is_absolute() {
        return Err("Zread current pointer must be relative.".to_string());
    }
    if state.previous_pointer.as_deref() == Some(current) {
        return Err("Zread generation left the previous current version unchanged.".to_string());
    }
    let version_path = wiki_root.join(current);
    let canonical_root = std::fs::canonicalize(&wiki_root)
        .map_err(|error| format!("Zread Wiki root is unreadable: {error}"))?;
    let canonical_version = std::fs::canonicalize(&version_path)
        .map_err(|error| format!("Zread generated version is incomplete: {error}"))?;
    if !contained_path(&canonical_root, &canonical_version) {
        return Err("Zread current version escapes the Wiki root.".to_string());
    }
    let catalog_path = canonical_version.join("wiki.json");
    let catalog: Value = serde_json::from_str(
        &std::fs::read_to_string(&catalog_path)
            .map_err(|error| format!("Zread generated catalog is unreadable: {error}"))?,
    )
    .map_err(|error| format!("Zread generated catalog is invalid: {error}"))?;
    let pages = catalog
        .get("pages")
        .and_then(Value::as_array)
        .filter(|pages| !pages.is_empty())
        .ok_or_else(|| "Zread generated catalog has no pages.".to_string())?;
    for page in pages {
        let file = page
            .get("file")
            .and_then(Value::as_str)
            .filter(|file| !file.trim().is_empty())
            .ok_or_else(|| "Zread generated catalog contains an invalid page path.".to_string())?;
        let page_path = canonical_version.join(file);
        let canonical_page = std::fs::canonicalize(&page_path)
            .map_err(|error| format!("Zread generated page is unreadable: {error}"))?;
        if !contained_path(&canonical_version, &canonical_page)
            || !std::fs::metadata(&canonical_page)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
        {
            return Err(format!("Zread generated page is invalid: {file}"));
        }
        std::fs::read_to_string(canonical_page)
            .map_err(|error| format!("Zread generated page is unreadable: {error}"))?;
    }
    Ok(())
}

fn task_kind(operation: &str) -> &'static str {
    if operation == "sync" {
        "update"
    } else {
        "generation"
    }
}

fn event_status(runner_status: &str, cancel_requested: bool) -> &'static str {
    if cancel_requested && status_is_terminal(runner_status) {
        "cancelled"
    } else if runner_status == "succeeded" {
        "succeeded"
    } else if runner_status == "failed" {
        "failed"
    } else {
        "running"
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_terminal_event(
    app: &AppHandle,
    task_id: &str,
    identity: &TaskIdentity,
    kind: &'static str,
    status: &'static str,
    phase: &str,
    message: Option<String>,
    progress: Option<HubTaskProgress>,
    can_resume: Option<bool>,
    details: Option<String>,
    terminal_emitted: &AtomicBool,
) {
    if terminal_emitted.swap(true, Ordering::SeqCst) {
        return;
    }
    emit_event(
        app,
        HubTaskEvent {
            task_id: task_id.to_string(),
            project_id: Some(identity.project_id.clone()),
            wiki_id: Some(identity.wiki_id.clone()),
            kind,
            status,
            phase: phase.to_string(),
            occurred_at: now_millis(),
            message,
            details,
            progress,
            can_resume,
        },
    );
}

fn forward_runner_event(
    app: &AppHandle,
    task_id: &str,
    identity: &TaskIdentity,
    kind: &'static str,
    event: RunnerEvent,
    cancel_requested: &AtomicBool,
    terminal_emitted: &AtomicBool,
    stderr_tail: &StderrTail,
) {
    if event.kind != "generation" {
        return;
    }
    let cancelled = cancel_requested.load(Ordering::SeqCst);
    let status = event_status(&event.status, cancelled);
    let progress = event.progress.map(|value| HubTaskProgress {
        current: value.current,
        total: value.total,
        succeeded: value.succeeded,
        failed: value.failed,
    });
    if status_is_terminal(status) {
        let stderr = (status == "failed")
            .then(|| stderr_details(stderr_tail))
            .flatten();
        let details = match (event.details, stderr) {
            (Some(details), Some(stderr)) => {
                Some(format!("{details}\n\nProcess stderr:\n{stderr}"))
            }
            (details, stderr) => details.or(stderr),
        };
        emit_terminal_event(
            app,
            task_id,
            identity,
            kind,
            status,
            &event.phase,
            event.message,
            progress,
            event.can_resume,
            details,
            terminal_emitted,
        );
    } else {
        emit_event(
            app,
            HubTaskEvent {
                task_id: task_id.to_string(),
                project_id: Some(identity.project_id.clone()),
                wiki_id: Some(identity.wiki_id.clone()),
                kind,
                status: "running",
                phase: event.phase,
                occurred_at: now_millis(),
                message: event.message,
                details: event.details,
                progress,
                can_resume: event.can_resume,
            },
        );
    }
}

fn forward_zread_snapshot(
    app: &AppHandle,
    task_id: &str,
    identity: &TaskIdentity,
    event: Value,
    terminal_emitted: &AtomicBool,
) {
    let vm = event.get("vm").and_then(Value::as_object);
    if vm.is_none() && event.get("done") != Some(&Value::Bool(true)) {
        return;
    }
    let phase = vm
        .and_then(|vm| vm.get("state"))
        .and_then(Value::as_str)
        .or_else(|| {
            vm.and_then(|vm| vm.get("catalog"))
                .and_then(Value::as_object)
                .and_then(|catalog| catalog.get("status"))
                .and_then(Value::as_str)
        })
        .unwrap_or(if event.get("done") == Some(&Value::Bool(true)) {
            "done"
        } else {
            "running"
        });
    let progress = vm
        .and_then(|vm| vm.get("pages"))
        .and_then(Value::as_object)
        .and_then(|pages| {
            Some(HubTaskProgress {
                current: pages.get("done")?.as_u64()? as u32,
                total: pages.get("total")?.as_u64()? as u32,
                succeeded: None,
                failed: None,
            })
        });
    if event.get("done") == Some(&Value::Bool(true)) {
        // The process observer validates current/wiki.json/pages after exit;
        // this snapshot is informational and must not claim success early.
        emit_event(
            app,
            HubTaskEvent {
                task_id: task_id.to_string(),
                project_id: Some(identity.project_id.clone()),
                wiki_id: Some(identity.wiki_id.clone()),
                kind: "generation",
                status: "running",
                phase: phase.to_string(),
                occurred_at: now_millis(),
                message: Some("Zread reported completion; validating output.".to_string()),
                progress,
                can_resume: None,
                details: None,
            },
        );
        return;
    }
    if !terminal_emitted.load(Ordering::SeqCst) {
        emit_event(
            app,
            HubTaskEvent {
                task_id: task_id.to_string(),
                project_id: Some(identity.project_id.clone()),
                wiki_id: Some(identity.wiki_id.clone()),
                kind: "generation",
                status: "running",
                phase: phase.to_string(),
                occurred_at: now_millis(),
                message: None,
                progress,
                can_resume: None,
                details: None,
            },
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn start_process_observers(
    app: AppHandle,
    task_id: String,
    identity: TaskIdentity,
    kind: &'static str,
    child: Arc<Mutex<Child>>,
    stdout: impl BufRead + Send + 'static,
    cancel_requested: Arc<AtomicBool>,
    terminal_emitted: Arc<AtomicBool>,
    coordinator: TaskCoordinator,
    flavor: TaskFlavor,
    stderr_tail: StderrTail,
) {
    let event_app = app.clone();
    let event_task_id = task_id.clone();
    let event_identity = identity.clone();
    let event_cancel = cancel_requested.clone();
    let event_terminal = terminal_emitted.clone();
    let event_flavor = flavor.clone();
    let event_stderr_tail = stderr_tail.clone();
    std::thread::spawn(move || {
        for line in stdout.lines().map_while(Result::ok) {
            match &event_flavor {
                TaskFlavor::OpenZread => {
                    let Ok(event) = serde_json::from_str::<RunnerEvent>(&line) else {
                        continue;
                    };
                    forward_runner_event(
                        &event_app,
                        &event_task_id,
                        &event_identity,
                        kind,
                        event,
                        &event_cancel,
                        &event_terminal,
                        &event_stderr_tail,
                    );
                }
                TaskFlavor::Zread(_) => {
                    let Ok(event) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    forward_zread_snapshot(
                        &event_app,
                        &event_task_id,
                        &event_identity,
                        event,
                        &event_terminal,
                    );
                }
            }
        }
    });

    std::thread::spawn(move || {
        // Do not hold the child mutex while waiting. Cancellation needs the same
        // lock to call kill(), so a blocking wait here can deadlock cancellation.
        let result = loop {
            let status = child
                .lock()
                .map_err(|_| "process lock poisoned".to_string())
                .and_then(|mut process| process.try_wait().map_err(|error| error.to_string()));
            match status {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(error) => break Err(error),
            }
        };
        if !terminal_emitted.load(Ordering::SeqCst) {
            let cancelled = cancel_requested.load(Ordering::SeqCst);
            let (status, phase, message) = if cancelled {
                if let TaskFlavor::Zread(state) = &flavor {
                    restore_zread_current(state);
                }
                (
                    "cancelled",
                    "cancelled",
                    Some("Task cancelled by the user.".to_string()),
                )
            } else {
                match result {
                    Ok(status) if status.success() => match &flavor {
                        TaskFlavor::OpenZread => ("succeeded", "process-exited", None),
                        TaskFlavor::Zread(state) => match validate_zread_output(state) {
                            Ok(()) => ("succeeded", "validated", None),
                            Err(error) => {
                                restore_zread_current(state);
                                ("failed", "validation-failed", Some(error))
                            }
                        },
                    },
                    Ok(status) => (
                        "failed",
                        "process-exited",
                        Some(format!(
                            "OpenZread runner exited with code {}.",
                            status.code().unwrap_or(-1)
                        )),
                    ),
                    Err(error) => ("failed", "process-exit-error", Some(error)),
                }
            };
            emit_terminal_event(
                &app,
                &task_id,
                &identity,
                kind,
                status,
                phase,
                message,
                None,
                None,
                stderr_details(&stderr_tail),
                &terminal_emitted,
            );
        }
        if let Ok(mut processes) = coordinator.processes.lock() {
            processes.remove(&task_id);
        }
        start_next_queued(&app, &coordinator);
    });
}

fn start_next_queued(app: &AppHandle, coordinator: &TaskCoordinator) {
    let next = {
        let Ok(processes) = coordinator.processes.lock() else {
            return;
        };
        if !processes.is_empty() {
            return;
        }
        coordinator
            .queue
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front())
    };
    let Some(next) = next else {
        return;
    };
    if let Ok(mut identity) = coordinator.starting_identity.lock() {
        *identity = Some(next.clone());
    }
    coordinator.starting_next.store(true, Ordering::SeqCst);
    let result = if next.provider == "zread" {
        start_zread_task(app, coordinator, &next.project_id, &next.wiki_id)
    } else {
        start_open_zread_task(
            app,
            coordinator,
            &next.project_id,
            &next.wiki_id,
            next.operation,
            next.resume,
        )
    };
    coordinator.starting_next.store(false, Ordering::SeqCst);
    if let Err(error) = result {
        if let Ok(mut identity) = coordinator.starting_identity.lock() {
            let _ = identity.take();
        }
        emit_event(
            app,
            HubTaskEvent {
                task_id: next.task_id,
                project_id: Some(next.project_id),
                wiki_id: Some(next.wiki_id),
                kind: task_kind(next.operation),
                status: "failed",
                phase: "queue-start-failed".to_string(),
                occurred_at: now_millis(),
                message: Some(error.message),
                progress: None,
                can_resume: None,
                details: None,
            },
        );
        start_next_queued(app, coordinator);
    }
}

pub(crate) fn start_open_zread_task(
    app: &AppHandle,
    coordinator: &TaskCoordinator,
    project_id: &str,
    wiki_id: &str,
    operation: &str,
    resume: bool,
) -> Result<HubTask, HubCommandError> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Project id is required.",
            false,
        ));
    }
    if operation != "generate" && operation != "sync" {
        return Err(command_error(
            "invalid_request",
            "OpenZread operation must be generate or sync.",
            false,
        ));
    }
    let project = list_projects(app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| {
            command_error(
                "project_not_found",
                "The selected Project is not registered.",
                false,
            )
        })?;
    if project.availability != "available" {
        return Err(command_error(
            "project_unavailable",
            format!("Project '{}' is not available.", project.name),
            true,
        ));
    }
    let resolved =
        resolve_task_source_root(app, &project.id, "open_zread", wiki_id, operation == "sync")?;
    let wiki_id = resolved.wiki_id.clone();
    let task_scope = TaskIdentity {
        project_id: project.id.clone(),
        wiki_id: wiki_id.clone(),
    };
    let executable = embedded_runner_executable(app)?;
    let operation_name = if operation == "sync" {
        "sync"
    } else {
        "generate"
    };
    if !coordinator.starting_next.load(Ordering::SeqCst) && task_is_busy(coordinator) {
        return queue_task(
            app,
            coordinator,
            QueuedTask {
                task_id: Uuid::new_v4().to_string(),
                project_id: project.id,
                wiki_id,
                provider: "open_zread",
                operation: operation_name,
                resume,
                started_at: now_millis(),
            },
        );
    }
    let identity = queued_identity(coordinator);
    let task_id = identity
        .as_ref()
        .map(|identity| identity.task_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let kind = task_kind(operation);
    let started_at = identity
        .as_ref()
        .map(|identity| identity.started_at.clone())
        .unwrap_or_else(now_millis);
    let mut process = Command::new(executable)
        .arg("wiki")
        .arg("--stdio")
        .arg("--operation")
        .arg(operation_name)
        .args(if resume { vec!["--resume"] } else { vec![] })
        .current_dir(&resolved.source_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            command_error(
                "service_unavailable",
                format!("Unable to start OpenZread task: {error}"),
                true,
            )
        })?;
    let stdout = process.stdout.take().ok_or_else(|| {
        command_error(
            "internal_error",
            "OpenZread task did not expose stdout.",
            true,
        )
    })?;
    let stderr_tail = process
        .stderr
        .take()
        .map(|stderr| capture_stderr(BufReader::new(stderr)))
        .unwrap_or_else(empty_stderr_tail);
    let child = Arc::new(Mutex::new(process));
    let cancel_requested = Arc::new(AtomicBool::new(false));
    let terminal_emitted = Arc::new(AtomicBool::new(false));
    let task_process = TaskProcess {
        kind,
        project_id: task_scope.project_id.clone(),
        wiki_id: task_scope.wiki_id.clone(),
        child: child.clone(),
        cancel_requested: cancel_requested.clone(),
        terminal_emitted: terminal_emitted.clone(),
    };
    coordinator
        .processes
        .lock()
        .map_err(|_| command_error("internal_error", "Task coordinator is unavailable.", true))?
        .insert(task_id.clone(), task_process);
    emit_event(
        app,
        HubTaskEvent {
            task_id: task_id.clone(),
            project_id: Some(task_scope.project_id.clone()),
            wiki_id: Some(task_scope.wiki_id.clone()),
            kind,
            status: "running",
            phase: "starting".to_string(),
            occurred_at: started_at.clone(),
            message: Some(format!(
                "Starting OpenZread {operation} for {}.",
                project.name
            )),
            progress: None,
            can_resume: None,
            details: None,
        },
    );
    start_process_observers(
        app.clone(),
        task_id.clone(),
        task_scope,
        kind,
        child,
        BufReader::new(stdout),
        cancel_requested,
        terminal_emitted,
        coordinator.clone(),
        TaskFlavor::OpenZread,
        stderr_tail,
    );
    Ok(HubTask {
        task_id,
        kind,
        status: "running",
        project_id: project.id,
        wiki_id,
        provider: "open_zread",
        operation: operation_name,
        model: MODEL_LABEL,
        started_at,
    })
}

fn previous_zread_state(project_root: &Path) -> ZreadTaskState {
    let current_path = project_root.join(".zread").join("wiki").join("current");
    let previous_current_contents = std::fs::read_to_string(&current_path).ok();
    let previous_pointer = previous_current_contents
        .as_deref()
        .map(|contents| contents.trim_start_matches('\u{feff}').trim().to_string())
        .filter(|pointer| !pointer.is_empty());
    ZreadTaskState {
        project_root: project_root.to_path_buf(),
        previous_pointer,
        previous_current_contents,
    }
}

pub(crate) fn start_zread_task(
    app: &AppHandle,
    coordinator: &TaskCoordinator,
    project_id: &str,
    wiki_id: &str,
) -> Result<HubTask, HubCommandError> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Project id is required.",
            false,
        ));
    }
    let project = crate::projects::list_projects(app)?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| {
            command_error(
                "project_not_found",
                "The selected Project is not registered.",
                false,
            )
        })?;
    if project.availability != "available" {
        return Err(command_error(
            "project_unavailable",
            format!("Project '{}' is not available.", project.name),
            true,
        ));
    }
    let resolved = resolve_task_source_root(app, &project.id, "zread", wiki_id, false)?;
    let wiki_id = resolved.wiki_id.clone();
    let task_scope = TaskIdentity {
        project_id: project.id.clone(),
        wiki_id: wiki_id.clone(),
    };
    let executable = native_zread_runner_executable(app)?;
    if !coordinator.starting_next.load(Ordering::SeqCst) && task_is_busy(coordinator) {
        return queue_task(
            app,
            coordinator,
            QueuedTask {
                task_id: Uuid::new_v4().to_string(),
                project_id: project.id,
                wiki_id,
                provider: "zread",
                operation: "generate",
                resume: false,
                started_at: now_millis(),
            },
        );
    }
    let flavor = TaskFlavor::Zread(previous_zread_state(&resolved.source_root));
    let identity = queued_identity(coordinator);
    let task_id = identity
        .as_ref()
        .map(|identity| identity.task_id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let started_at = identity
        .as_ref()
        .map(|identity| identity.started_at.clone())
        .unwrap_or_else(now_millis);
    let mut process = Command::new(executable)
        .arg("generate")
        .arg("--stdio")
        .arg("--yes")
        .current_dir(&resolved.source_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            command_error(
                "service_unavailable",
                format!("Unable to start Zread task: {error}"),
                true,
            )
        })?;
    let stdout = process.stdout.take().ok_or_else(|| {
        command_error("internal_error", "Zread task did not expose stdout.", true)
    })?;
    let stderr_tail = process
        .stderr
        .take()
        .map(|stderr| capture_stderr(BufReader::new(stderr)))
        .unwrap_or_else(empty_stderr_tail);
    let child = Arc::new(Mutex::new(process));
    let cancel_requested = Arc::new(AtomicBool::new(false));
    let terminal_emitted = Arc::new(AtomicBool::new(false));
    coordinator
        .processes
        .lock()
        .map_err(|_| command_error("internal_error", "Task coordinator is unavailable.", true))?
        .insert(
            task_id.clone(),
            TaskProcess {
                kind: "generation",
                project_id: task_scope.project_id.clone(),
                wiki_id: task_scope.wiki_id.clone(),
                child: child.clone(),
                cancel_requested: cancel_requested.clone(),
                terminal_emitted: terminal_emitted.clone(),
            },
        );
    emit_event(
        app,
        HubTaskEvent {
            task_id: task_id.clone(),
            project_id: Some(task_scope.project_id.clone()),
            wiki_id: Some(task_scope.wiki_id.clone()),
            kind: "generation",
            status: "running",
            phase: "starting".to_string(),
            occurred_at: started_at.clone(),
            message: Some(format!("Starting Zread generation for {}.", project.name)),
            progress: None,
            can_resume: None,
            details: None,
        },
    );
    start_process_observers(
        app.clone(),
        task_id.clone(),
        task_scope,
        "generation",
        child,
        BufReader::new(stdout),
        cancel_requested,
        terminal_emitted,
        coordinator.clone(),
        flavor,
        stderr_tail,
    );
    Ok(HubTask {
        task_id,
        kind: "generation",
        status: "running",
        project_id: project.id,
        wiki_id,
        provider: "zread",
        operation: "generate",
        model: "Zread native configuration",
        started_at,
    })
}

pub(crate) fn cancel_task(
    app: &AppHandle,
    coordinator: &TaskCoordinator,
    task_id: &str,
) -> Result<CancelTaskResponse, HubCommandError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(command_error(
            "invalid_request",
            "Task id is required.",
            false,
        ));
    }
    let task = coordinator
        .processes
        .lock()
        .map_err(|_| command_error("internal_error", "Task coordinator is unavailable.", true))?
        .get(task_id)
        .map(|task| {
            (
                task.kind,
                task.project_id.clone(),
                task.wiki_id.clone(),
                task.child.clone(),
                task.cancel_requested.clone(),
                task.terminal_emitted.clone(),
            )
        })
        .ok_or_else(|| {
            command_error(
                "task_not_found",
                format!("Task '{task_id}' is not active."),
                false,
            )
        });
    let Ok(task) = task else {
        let queued = {
            let mut queue = coordinator.queue.lock().map_err(|_| {
                command_error("internal_error", "Task coordinator is unavailable.", true)
            })?;
            queue
                .iter()
                .position(|queued| queued.task_id == task_id)
                .and_then(|index| queue.remove(index))
        };
        let Some(queued) = queued else {
            return Err(command_error(
                "task_not_found",
                format!("Task '{task_id}' is not active."),
                false,
            ));
        };
        emit_event(
            app,
            HubTaskEvent {
                task_id: task_id.to_string(),
                project_id: Some(queued.project_id),
                wiki_id: Some(queued.wiki_id),
                kind: task_kind(queued.operation),
                status: "cancelled",
                phase: "cancelled".to_string(),
                occurred_at: now_millis(),
                message: Some("Queued task cancelled by the user.".to_string()),
                progress: None,
                can_resume: None,
                details: None,
            },
        );
        return Ok(CancelTaskResponse {
            task_id: task_id.to_string(),
            accepted: true,
            status: "cancelled",
        });
    };
    if task.5.load(Ordering::SeqCst) {
        return Err(command_error(
            "task_not_found",
            format!("Task '{task_id}' is no longer active."),
            false,
        ));
    }
    task.4.store(true, Ordering::SeqCst);
    if let Ok(mut child) = task.3.lock() {
        child.kill().map_err(|error| {
            command_error(
                "internal_error",
                format!("Unable to cancel task: {error}"),
                true,
            )
        })?;
    }
    emit_event(
        app,
        HubTaskEvent {
            task_id: task_id.to_string(),
            project_id: Some(task.1),
            wiki_id: Some(task.2),
            kind: task.0,
            status: "cancelling",
            phase: "cancelling".to_string(),
            occurred_at: now_millis(),
            message: Some("Cancellation requested.".to_string()),
            progress: None,
            can_resume: None,
            details: None,
        },
    );
    Ok(CancelTaskResponse {
        task_id: task_id.to_string(),
        accepted: true,
        status: "cancelling",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};

    #[test]
    fn maps_sync_to_update_tasks() {
        assert_eq!(task_kind("sync"), "update");
        assert_eq!(task_kind("generate"), "generation");
    }

    #[test]
    fn cancellation_wins_over_runner_failure() {
        assert_eq!(event_status("failed", true), "cancelled");
        assert_eq!(event_status("failed", false), "failed");
        assert_eq!(event_status("running", true), "running");
    }

    #[test]
    fn parses_runner_progress_without_inventing_percentage() {
        let event = serde_json::from_str::<RunnerEvent>(
            r#"{"kind":"generation","status":"failed","phase":"failed","message":"failed","details":"quota detail","progress":{"current":3,"total":5,"succeeded":2,"failed":1}}"#,
        )
        .expect("runner event should parse");
        let progress = event.progress.expect("progress");
        assert_eq!(progress.current, 3);
        assert_eq!(progress.total, 5);
        assert_eq!(progress.succeeded, Some(2));
        assert_eq!(progress.failed, Some(1));
        assert_eq!(event.details.as_deref(), Some("quota detail"));
    }

    #[test]
    fn keeps_captured_stderr_details_available_for_failed_task_events() {
        let tail = capture_stderr(BufReader::new(std::io::Cursor::new(
            "provider request failed\nHTTP 429: quota exceeded\n",
        )));
        assert_eq!(
            stderr_details(&tail).as_deref(),
            Some("provider request failed\nHTTP 429: quota exceeded")
        );
    }

    #[test]
    fn validates_zread_current_catalog_and_pages() {
        let root = std::env::temp_dir().join(format!("open-zread-zread-task-{}", Uuid::new_v4()));
        let version = root
            .join(".zread")
            .join("wiki")
            .join("versions")
            .join("new");
        create_dir_all(&version).expect("version directory should be created");
        write(
            root.join(".zread").join("wiki").join("current"),
            "versions/new\n",
        )
        .expect("current pointer should be written");
        write(
            version.join("wiki.json"),
            r#"{"id":"new","pages":[{"slug":"overview","file":"overview.md"}]}"#,
        )
        .expect("catalog should be written");
        write(version.join("overview.md"), "# Overview\n").expect("page should be written");

        let state = ZreadTaskState {
            project_root: root.clone(),
            previous_pointer: Some("versions/old".to_string()),
            previous_current_contents: Some("versions/old\n".to_string()),
        };
        assert!(validate_zread_output(&state).is_ok());
        remove_dir_all(root).expect("temporary project should be removed");
    }

    #[test]
    fn rejects_unchanged_zread_current_pointer() {
        let root = std::env::temp_dir().join(format!("open-zread-zread-task-{}", Uuid::new_v4()));
        let version = root
            .join(".zread")
            .join("wiki")
            .join("versions")
            .join("current");
        create_dir_all(&version).expect("version directory should be created");
        write(
            root.join(".zread").join("wiki").join("current"),
            "versions/current\n",
        )
        .expect("current pointer should be written");
        let state = ZreadTaskState {
            project_root: root.clone(),
            previous_pointer: Some("versions/current".to_string()),
            previous_current_contents: Some("versions/current\n".to_string()),
        };
        let error = validate_zread_output(&state).expect_err("unchanged output should fail");
        assert!(error.contains("unchanged"));
        remove_dir_all(root).expect("temporary project should be removed");
    }
}
