/**
 * Typed wire contracts shared by the React Hub client and the Tauri commands.
 *
 * Keep these values JSON-serializable. The Rust side mirrors the structures in
 * apps/hub/src-tauri/src/contracts.rs because Rust cannot import TypeScript.
 */

export const HUB_COMMANDS = {
  getHealth: 'get_hub_health',
  setZreadExecutable: 'set_hub_zread_executable',
  startOpenZreadTask: 'start_hub_open_zread_task',
  startZreadTask: 'start_hub_zread_task',
  previewWikiChange: 'preview_hub_wiki_change',
  applyWikiChange: 'apply_hub_wiki_change',
  listWikiHistory: 'list_hub_wiki_history',
  restoreWikiHistory: 'restore_hub_wiki_history',
  cancelTask: 'cancel_hub_task',
  listProjects: 'list_hub_projects',
  registerProject: 'register_hub_project',
  setProjectFavorite: 'set_hub_project_favorite',
  relocateProject: 'relocate_hub_project',
  removeProject: 'remove_hub_project',
  openProjectFolder: 'open_hub_project_folder',
  openProjectTerminal: 'open_hub_project_terminal',
  readOpenZreadWiki: 'read_hub_open_zread_wiki',
  readOpenZreadSource: 'read_hub_open_zread_source',
  readOpenZreadAsset: 'read_hub_open_zread_asset',
  readZreadWiki: 'read_hub_zread_wiki',
  readZreadSource: 'read_hub_zread_source',
  readZreadAsset: 'read_hub_zread_asset',
} as const;

export const HUB_EVENTS = {
  task: 'hub://task-event',
} as const;

export type HubCommandName = typeof HUB_COMMANDS[keyof typeof HUB_COMMANDS];

export type HubRuntime = 'tauri';
export type HubServiceStatus = 'healthy' | 'degraded' | 'unavailable';
export type HubRunnerStatus = 'available' | 'unavailable';
export type HubProviderGeneratorStatus = 'available' | 'unavailable' | 'not_configured';
export type HubProviderConfigSource = 'hub_shared' | 'zread_native' | 'not_configured';
export type HubProviderExecutableSource = 'embedded' | 'auto_detected' | 'manual' | 'not_detected';

export interface HubServiceHealth {
  name: 'Hub Application Service';
  status: HubServiceStatus;
}

export interface HubRunnerInfo {
  status: HubRunnerStatus;
  version: string;
  executablePath: string;
}

export interface HubProviderGeneratorHealth {
  status: HubProviderGeneratorStatus;
  version: string;
  executablePath: string;
  executableSource: HubProviderExecutableSource;
  diagnostics: string[];
}

export interface HubProviderCapabilities {
  generate: boolean;
  regenerate: boolean;
  sync: boolean;
  login: boolean;
  customApiKeyLogin: boolean;
  machineReadable: boolean;
  unattended: boolean;
  existingDraftActions: boolean;
  skipFailedPages: boolean;
  cliSelfUpdate: boolean;
  structuredProgress: boolean;
  incrementalWikiUpdate: boolean;
}

export interface HubProviderHealth {
  provider: HubWikiProvider;
  /** Content readability is evaluated against each registered project. */
  content: { status: 'project_scoped' };
  generator: HubProviderGeneratorHealth;
  capabilities: HubProviderCapabilities;
  /** Hub never imports or overwrites credentials from a native provider. */
  configSource: HubProviderConfigSource;
}

export interface HubHealth {
  appVersion: string;
  runtime: HubRuntime;
  os: string;
  service: HubServiceHealth;
  runner: HubRunnerInfo;
  providers: HubProviderHealth[];
}

export type HubProjectAvailability = 'available' | 'missing' | 'inaccessible' | 'permission_denied';
export type HubWikiStatus = 'missing' | 'readable' | 'partial' | 'invalid' | 'unavailable';
export type HubSourceControl = 'git' | 'non_git';

export interface HubProjectWikiSummary {
  openZread: HubWikiStatus;
  zread: HubWikiStatus;
}

export interface HubProject {
  id: string;
  name: string;
  path: string;
  previousPaths: string[];
  sourceControl: HubSourceControl;
  availability: HubProjectAvailability;
  availabilityReason?: string;
  wiki: HubProjectWikiSummary;
  favorite: boolean;
  lastOpenedAt?: string;
}

export interface RegisterProjectResponse {
  project: HubProject;
  created: boolean;
}

export type HubWikiPageStatus = 'readable' | 'missing' | 'unreadable';

export interface HubWikiCatalog {
  id?: string;
  generatedAt?: string;
  language?: string;
  native: Record<string, unknown>;
}

export interface HubWikiPage {
  slug: string;
  title: string;
  file: string;
  section: string;
  group?: string;
  level?: string;
  associatedFiles: string[];
  status: HubWikiPageStatus;
  content?: string;
  error?: string;
  native: Record<string, unknown>;
}

export type HubWikiProvider = 'open_zread' | 'zread';

export interface HubWikiDocument {
  provider: HubWikiProvider;
  status: Extract<HubWikiStatus, 'readable' | 'partial'>;
  catalog: HubWikiCatalog;
  pages: HubWikiPage[];
  currentPointer?: string;
  versionId?: string;
}

export type HubOpenZreadWiki = HubWikiDocument & { provider: 'open_zread' };
export type HubZreadWiki = HubWikiDocument & { provider: 'zread' };

export interface HubSourceFile {
  path: string;
  content: string;
}

export interface HubWikiAsset {
  path: string;
  mimeType: string;
  bytes: number[];
}

export type HubTaskKind = 'generation' | 'update' | 'maintenance';
export type HubTaskStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface HubTaskProgress {
  current: number;
  total: number;
}

export interface HubTaskEvent {
  taskId: string;
  kind: HubTaskKind;
  status: HubTaskStatus;
  phase: string;
  occurredAt: string;
  message?: string;
  progress?: HubTaskProgress;
}

export type HubTaskOperation = 'generate' | 'sync';
export type HubOpenZreadOperation = HubTaskOperation;

export interface HubTask {
  taskId: string;
  kind: Extract<HubTaskKind, 'generation' | 'update'>;
  status: Extract<HubTaskStatus, 'queued' | 'running'>;
  projectId: string;
  provider: 'open_zread' | 'zread';
  operation: HubTaskOperation;
  model: string;
  startedAt: string;
}

export type HubChangeSetStatus = 'preview' | 'applied' | 'rejected';

export interface HubWikiChangeSet {
  changeSetId: string;
  projectId: string;
  provider: HubWikiProvider;
  slug: string;
  relativePath: string;
  before: string;
  after: string;
  status: HubChangeSetStatus;
  createdAt: string;
}

export interface HubWikiHistoryEntry {
  id: string;
  projectId: string;
  provider: HubWikiProvider;
  label: string;
  createdAt: string;
  current: boolean;
  pageCount: number;
}

export const HUB_TASK_KINDS = ['generation', 'update', 'maintenance'] as const;
export const HUB_TASK_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export interface CancelTaskResponse {
  taskId: string;
  accepted: boolean;
  status: Extract<HubTaskStatus, 'cancelling' | 'cancelled'>;
}

export type HubCommandErrorCode =
  | 'invalid_request'
  | 'task_not_found'
  | 'project_invalid_path'
  | 'project_not_found'
  | 'project_duplicate_path'
  | 'project_unavailable'
  | 'unsupported_platform'
  | 'project_registry_corrupt'
  | 'wiki_not_found'
  | 'wiki_invalid'
  | 'wiki_read_failed'
  | 'source_not_found'
  | 'source_invalid_path'
  | 'asset_not_found'
  | 'asset_invalid_path'
  | 'conflict'
  | 'service_unavailable'
  | 'internal_error';

export interface HubCommandError {
  code: HubCommandErrorCode;
  message: string;
  retryable: boolean;
}
