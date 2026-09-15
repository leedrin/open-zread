use crate::contracts::{
    CancelTaskResponse, HubCommandError, HubHealth, HubServiceHealth, HubTaskEvent, TASK_EVENT,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub(crate) fn emit_task_event(
    app: &AppHandle,
    event: HubTaskEvent,
) -> Result<(), HubCommandError> {
    app.emit(TASK_EVENT, event).map_err(|error| HubCommandError {
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
