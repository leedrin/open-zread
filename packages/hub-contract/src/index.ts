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
  previewWikiStructureChange: 'preview_hub_wiki_structure_change',
  applyWikiChange: 'apply_hub_wiki_change',
  listWikiHistory: 'list_hub_wiki_history',
  restoreWikiHistory: 'restore_hub_wiki_history',
  searchWiki: 'search_hub_wiki',
  searchProjectMarkdown: 'search_hub_project_markdown',
  askProjectMarkdown: 'ask_hub_project_markdown',
  createWikiPage: 'create_hub_wiki_page',
  createWikiPages: 'create_hub_wiki_pages',
  deleteWikiPage: 'delete_hub_wiki_page',
  updateWikiPageMetadata: 'update_hub_wiki_page_metadata',
  mergeWikiText: 'merge_hub_wiki_text',
  askWiki: 'ask_hub_wiki',
  rewriteWikiPage: 'rewrite_hub_wiki_page',
  draftWikiPage: 'draft_hub_wiki_page',
  cancelTask: 'cancel_hub_task',
  listProjects: 'list_hub_projects',
  registerProject: 'register_hub_project',
  renameProject: 'rename_hub_project',
  setProjectFavorite: 'set_hub_project_favorite',
  listProjectWikis: 'list_hub_project_wikis',
  locateProjectWikis: 'locate_hub_project_wikis',
  listProjectMarkdown: 'list_hub_project_markdown',
  readProjectMarkdown: 'read_hub_project_markdown',
  saveProjectMarkdown: 'save_hub_project_markdown',
  readProjectMarkdownAsset: 'read_hub_project_markdown_asset',
  readProjectMarkdownSource: 'read_hub_project_markdown_source',
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
  addedAt?: string;
  lastOpenedAt?: string;
}

export type HubWikiInstanceStatus = 'readable' | 'partial' | 'invalid';

export interface HubWikiInstance {
  wikiId: string;
  provider: HubWikiProvider;
  sourceRoot: string;
  label: string;
  status: HubWikiInstanceStatus;
}

export interface HubWikiInstanceList {
  projectId: string;
  instances: HubWikiInstance[];
  scanComplete: boolean;
  scannedDirectories: number;
  warning?: string;
}

export type HubMarkdownNodeKind = 'directory' | 'file';

export interface HubMarkdownNode {
  kind: HubMarkdownNodeKind;
  name: string;
  relativePath: string;
  title?: string;
  bytes?: number;
  modifiedAt?: string;
  children?: HubMarkdownNode[];
}

export interface HubMarkdownFileError {
  relativePath: string;
  message: string;
}

export interface HubProjectMarkdownTree {
  projectId: string;
  roots: HubMarkdownNode[];
  scanComplete: boolean;
  scannedDirectories: number;
  scannedFiles: number;
  errors: HubMarkdownFileError[];
  warning?: string;
}

export interface HubMarkdownDocument {
  projectId: string;
  relativePath: string;
  title: string;
  content: string;
  revision: string;
}

export interface HubMarkdownAnswerResponse {
  projectId: string;
  path: string;
  title: string;
  model: string;
  answer: string;
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
  wikiId: string;
  sourceRoot: string;
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
  succeeded?: number;
  failed?: number;
}

export interface HubTaskEvent {
  taskId: string;
  projectId?: string;
  wikiId?: string;
  kind: HubTaskKind;
  status: HubTaskStatus;
  phase: string;
  occurredAt: string;
  message?: string;
  details?: string;
  progress?: HubTaskProgress;
  canResume?: boolean;
}

export type HubTaskOperation = 'generate' | 'sync';
export type HubOpenZreadOperation = HubTaskOperation;

export interface HubTask {
  taskId: string;
  kind: Extract<HubTaskKind, 'generation' | 'update'>;
  status: Extract<HubTaskStatus, 'queued' | 'running'>;
  projectId: string;
  wikiId: string;
  provider: 'open_zread' | 'zread';
  operation: HubTaskOperation;
  model: string;
  startedAt: string;
}

export type HubChangeSetStatus = 'preview' | 'applied' | 'rejected';

export type HubWikiFileChangeAction = 'create' | 'update' | 'delete';

export interface HubWikiFileChange {
  relativePath: string;
  action: HubWikiFileChangeAction;
  before: string | null;
  after: string | null;
  baseRevision: string;
}

export interface HubWikiChangeValidation {
  status: 'passed' | 'failed';
  checks: string[];
  warnings: string[];
}

export interface HubWikiStructurePageInput {
  slug: string;
  title: string;
  section: string;
  group?: string;
  content: string;
  associatedFiles: string[];
}

export type HubWikiStructureChangeRequest =
  | { operation: 'create'; pages: HubWikiStructurePageInput[] }
  | { operation: 'delete'; slug: string }
  | {
    operation: 'metadata';
    slug: string;
    newSlug?: string;
    title?: string;
    section?: string;
    group?: string;
    associatedFiles?: string[];
    order?: number;
    clearGroup?: boolean;
  };

export interface HubWikiChangeSet {
  changeSetId: string;
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  slug: string;
  relativePath: string;
  before: string;
  after: string;
  status: HubChangeSetStatus;
  createdAt: string;
  operation?: 'edit' | 'create' | 'batch_create' | 'delete' | 'metadata';
  baseRevision?: string;
  versionPointer?: string | null;
  files?: HubWikiFileChange[];
  validation?: HubWikiChangeValidation;
}

export interface HubWikiHistoryEntry {
  id: string;
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  label: string;
  createdAt: string;
  current: boolean;
  pageCount: number;
}

export interface HubWikiSearchResult {
  projectId: string;
  projectName: string;
  provider: HubWikiProvider;
  wikiId: string;
  sourceRoot: string;
  slug: string;
  title: string;
  snippet: string;
  path: string;
}

export interface HubMarkdownSearchResult {
  sourceKind: 'local_markdown';
  projectId: string;
  projectName: string;
  path: string;
  title: string;
  snippet: string;
  matchKind: 'path' | 'content';
  matchLine?: number;
  matchColumn?: number;
  matchLength?: number;
}

export interface HubMarkdownSearchFailure {
  projectId: string;
  projectName: string;
  relativePath?: string;
  message: string;
}

export interface HubProjectMarkdownSearchResponse {
  projectId: string;
  query: string;
  results: HubMarkdownSearchResult[];
  scanComplete: boolean;
  scannedFiles: number;
  errors: HubMarkdownFileError[];
  warning?: string;
}

export interface HubWikiSearchResponse {
  query: string;
  results: HubWikiSearchResult[];
  failures: Array<{ projectId: string; projectName: string; provider: HubWikiProvider; wikiId: string; sourceRoot: string; message: string }>;
  markdownResults: HubMarkdownSearchResult[];
  markdownFailures: HubMarkdownSearchFailure[];
}

export type HubWikiPageMutationAction = 'created' | 'deleted' | 'updated';

export interface HubWikiPageMutationResponse {
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  slug: string;
  action: HubWikiPageMutationAction;
  relativePath: string;
}

export interface HubWikiBatchMutationResponse {
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  mutations: HubWikiPageMutationResponse[];
}

export type HubWikiMergeStatus = 'clean' | 'conflicted';

export interface HubWikiMergeConflict {
  base: string;
  local: string;
  incoming: string;
}

export interface HubWikiMergeResponse {
  status: HubWikiMergeStatus;
  content: string;
  conflicts: HubWikiMergeConflict[];
}

export interface HubWikiAnswerReference {
  slug: string;
  title: string;
}

export interface HubWikiAnswerResponse {
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  slug: string;
  answer: string;
  references: HubWikiAnswerReference[];
}

export interface HubWikiPageDraftResponse {
  provider: HubWikiProvider;
  wikiId?: string;
  slug: string;
  title: string;
  section: string;
  content: string;
  associatedFiles: string[];
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
  | 'project_invalid_name'
  | 'task_not_found'
  | 'project_invalid_path'
  | 'project_not_found'
  | 'project_duplicate_path'
  | 'project_unavailable'
  | 'unsupported_platform'
  | 'project_registry_corrupt'
  | 'wiki_not_found'
  | 'wiki_invalid'
  | 'wiki_scan_failed'
  | 'markdown_scan_failed'
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
