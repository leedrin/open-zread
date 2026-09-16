use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubServiceHealth {
    pub name: &'static str,
    pub status: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubRunnerInfo {
    pub status: &'static str,
    pub version: String,
    pub executable_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubHealth {
    pub app_version: &'static str,
    pub runtime: &'static str,
    pub os: &'static str,
    pub service: HubServiceHealth,
    pub runner: HubRunnerInfo,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProjectWikiSummary {
    pub open_zread: &'static str,
    pub zread: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub previous_paths: Vec<String>,
    pub source_control: &'static str,
    pub availability: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub availability_reason: Option<String>,
    pub wiki: HubProjectWikiSummary,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterProjectResponse {
    pub project: HubProject,
    pub created: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTaskResponse {
    pub task_id: String,
    pub accepted: bool,
    pub status: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubCommandError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubTaskProgress {
    pub current: u32,
    pub total: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubTaskEvent {
    pub task_id: String,
    pub kind: &'static str,
    pub status: &'static str,
    pub phase: String,
    pub occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<HubTaskProgress>,
}

pub const TASK_EVENT: &str = "hub://task-event";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_event_omits_absent_optional_fields() {
        let event = HubTaskEvent {
            task_id: "task-1".to_string(),
            kind: "generation",
            status: "running",
            phase: "planning".to_string(),
            occurred_at: "2026-09-16T00:00:00.000Z".to_string(),
            message: None,
            progress: None,
        };
        let value = serde_json::to_value(event).expect("task event should be serializable");
        assert_eq!(value["taskId"], "task-1");
        assert!(value.get("message").is_none());
        assert!(value.get("progress").is_none());
    }
}
