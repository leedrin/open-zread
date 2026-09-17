use serde::Serialize;
use serde_json::Value;

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
pub struct HubProviderGeneratorHealth {
    pub status: &'static str,
    pub version: String,
    pub executable_path: String,
    pub executable_source: &'static str,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProviderCapabilities {
    pub generate: bool,
    pub regenerate: bool,
    pub sync: bool,
    pub login: bool,
    pub custom_api_key_login: bool,
    pub machine_readable: bool,
    pub unattended: bool,
    pub existing_draft_actions: bool,
    pub skip_failed_pages: bool,
    pub cli_self_update: bool,
    pub structured_progress: bool,
    pub incremental_wiki_update: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProviderHealth {
    pub provider: &'static str,
    pub content: HubProviderContentHealth,
    pub generator: HubProviderGeneratorHealth,
    pub capabilities: HubProviderCapabilities,
    pub config_source: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProviderContentHealth {
    pub status: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubHealth {
    pub app_version: &'static str,
    pub runtime: &'static str,
    pub os: &'static str,
    pub service: HubServiceHealth,
    pub runner: HubRunnerInfo,
    pub providers: Vec<HubProviderHealth>,
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
pub struct HubWikiCatalog {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub native: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiPage {
    pub slug: String,
    pub title: String,
    pub file: String,
    pub section: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    pub associated_files: Vec<String>,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub native: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubOpenZreadWiki {
    pub provider: &'static str,
    pub status: &'static str,
    pub catalog: HubWikiCatalog,
    pub pages: Vec<HubWikiPage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_pointer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
}

pub type HubZreadWiki = HubOpenZreadWiki;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubSourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiAsset {
    pub path: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubTask {
    pub task_id: String,
    pub kind: &'static str,
    pub status: &'static str,
    pub project_id: String,
    pub provider: &'static str,
    pub operation: &'static str,
    pub model: &'static str,
    pub started_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiChangeSet {
    pub change_set_id: String,
    pub project_id: String,
    pub provider: &'static str,
    pub slug: String,
    pub relative_path: String,
    pub before: String,
    pub after: String,
    pub status: &'static str,
    pub created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiHistoryEntry {
    pub id: String,
    pub project_id: String,
    pub provider: &'static str,
    pub label: String,
    pub created_at: String,
    pub current: bool,
    pub page_count: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiSearchResult {
    pub project_id: String,
    pub project_name: String,
    pub provider: &'static str,
    pub slug: String,
    pub title: String,
    pub snippet: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiSearchFailure {
    pub project_id: String,
    pub project_name: String,
    pub provider: &'static str,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiSearchResponse {
    pub query: String,
    pub results: Vec<HubWikiSearchResult>,
    pub failures: Vec<HubWikiSearchFailure>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWikiPageMutationResponse {
    pub project_id: String,
    pub provider: &'static str,
    pub slug: String,
    pub action: &'static str,
    pub relative_path: String,
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
