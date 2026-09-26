import {
  HUB_COMMANDS,
  HUB_EVENTS,
  HUB_TASK_KINDS,
  HUB_TASK_STATUSES,
  type CancelTaskResponse,
  type HubCommandName,
  type HubHealth,
  type HubProject,
  type HubProjectAvailability,
  type HubProjectWikiSummary,
  type HubWikiInstance,
  type HubWikiInstanceList,
  type HubMarkdownNode,
  type HubProjectMarkdownTree,
  type HubMarkdownDocument,
  type HubMarkdownAnswerResponse,
  type HubOpenZreadWiki,
  type HubZreadWiki,
  type HubWikiDocument,
  type HubWikiProvider,
  type HubSourceFile,
  type HubWikiAsset,
  type HubWikiCatalog,
  type HubWikiPage,
  type HubWikiPageStatus,
  type HubSourceControl,
  type HubWikiStatus,
  type HubRunnerInfo,
  type HubProviderCapabilities,
  type HubProviderHealth,
  type HubProviderGeneratorHealth,
  type HubTaskEvent,
  type HubTask,
  type HubOpenZreadOperation,
  type HubWikiChangeSet,
  type HubWikiStructureChangeRequest,
  type HubWikiHistoryEntry,
  type HubWikiSearchResponse,
  type HubMarkdownSearchResult,
  type HubMarkdownSearchFailure,
  type HubProjectMarkdownSearchResponse,
  type HubWikiPageMutationResponse,
  type HubWikiMergeResponse,
  type HubWikiAnswerResponse,
  type HubWikiPageDraftResponse,
  type HubWikiBatchMutationResponse,
  type RegisterProjectResponse,
} from '@open-zread/hub-contract';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { writeText as tauriWriteText } from '@tauri-apps/plugin-clipboard-manager';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';

export interface HubEvent<T> {
  payload: T;
}

export type HubEventListener<T> = (event: HubEvent<T>) => void;
export type Unsubscribe = () => void;

export interface CreateWikiPageInput {
  slug: string;
  title: string;
  section: string;
  group?: string;
  content: string;
  associatedFiles: string[];
}

export interface UpdateWikiPageMetadataInput {
  newSlug?: string;
  title?: string;
  section?: string;
  group?: string;
  associatedFiles?: string[];
  order?: number;
  clearGroup?: boolean;
}

/** The transport is the only place the application service knows about Tauri. */
export interface HubTransport {
  invoke(command: HubCommandName, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: typeof HUB_EVENTS.task, listener: HubEventListener<unknown>): Promise<Unsubscribe>;
  selectProjectDirectory(): Promise<string | null>;
  selectZreadExecutable?(): Promise<string | null>;
  copyText(text: string): Promise<void>;
}

export interface HubApplicationService {
  getHealth(): Promise<HubHealth>;
  configureZreadExecutable(): Promise<HubHealth | null>;
  listProjects(): Promise<HubProject[]>;
  selectProjectDirectory(): Promise<string | null>;
  copyText(text: string): Promise<void>;
  registerProject(path: string): Promise<RegisterProjectResponse>;
  renameProject(projectId: string, name: string): Promise<HubProject>;
  setProjectFavorite(projectId: string, favorite: boolean): Promise<HubProject>;
  listProjectWikis(projectId: string): Promise<HubWikiInstanceList>;
  locateProjectWikis(projectId: string, directory: string): Promise<HubWikiInstanceList>;
  listProjectMarkdown(projectId: string): Promise<HubProjectMarkdownTree>;
  readProjectMarkdown(projectId: string, relativePath: string): Promise<HubMarkdownDocument>;
  saveProjectMarkdown(projectId: string, relativePath: string, baseRevision: string, content: string): Promise<HubMarkdownDocument>;
  searchProjectMarkdown(projectId: string, query: string): Promise<HubProjectMarkdownSearchResponse>;
  askProjectMarkdown(projectId: string, relativePath: string, question: string, selectedText?: string): Promise<HubMarkdownAnswerResponse>;
  readProjectMarkdownAsset(projectId: string, documentPath: string, assetPath: string): Promise<HubWikiAsset>;
  readProjectMarkdownSource(projectId: string, documentPath: string, sourcePath: string): Promise<HubSourceFile>;
  relocateProject(projectId: string, path: string): Promise<HubProject>;
  removeProject(projectId: string): Promise<void>;
  openProjectFolder(projectId: string): Promise<HubProject>;
  openProjectTerminal(projectId: string): Promise<HubProject>;
  copyProjectPath(path: string): Promise<void>;
  readOpenZreadWiki(projectId: string, wikiId?: string): Promise<HubOpenZreadWiki>;
  readOpenZreadSource(projectId: string, path: string, wikiId?: string): Promise<HubSourceFile>;
  readOpenZreadAsset(projectId: string, pagePath: string, assetPath: string, wikiId?: string): Promise<HubWikiAsset>;
  readZreadWiki(projectId: string, wikiId?: string): Promise<HubZreadWiki>;
  readZreadSource(projectId: string, path: string, wikiId?: string): Promise<HubSourceFile>;
  readZreadAsset(projectId: string, pagePath: string, assetPath: string, wikiId?: string): Promise<HubWikiAsset>;
  startOpenZreadTask(projectId: string, wikiId: string, operation: HubOpenZreadOperation, resume?: boolean): Promise<HubTask>;
  startZreadTask(projectId: string, wikiId: string): Promise<HubTask>;
  previewWikiChange(projectId: string, provider: HubWikiProvider, slug: string, content: string, wikiId?: string): Promise<HubWikiChangeSet>;
  previewWikiStructureChange(projectId: string, provider: HubWikiProvider, request: HubWikiStructureChangeRequest, wikiId?: string): Promise<HubWikiChangeSet>;
  applyWikiChange(changeSetId: string): Promise<HubWikiChangeSet>;
  listWikiHistory(projectId: string, provider: HubWikiProvider, wikiId?: string): Promise<HubWikiHistoryEntry[]>;
  restoreWikiHistory(projectId: string, provider: HubWikiProvider, historyId: string, wikiId?: string): Promise<HubWikiHistoryEntry>;
  searchWiki(query: string): Promise<HubWikiSearchResponse>;
  createWikiPage(projectId: string, provider: HubWikiProvider, input: CreateWikiPageInput, wikiId?: string): Promise<HubWikiPageMutationResponse>;
  createWikiPages(projectId: string, provider: HubWikiProvider, inputs: CreateWikiPageInput[], wikiId?: string): Promise<HubWikiBatchMutationResponse>;
  deleteWikiPage(projectId: string, provider: HubWikiProvider, slug: string, wikiId?: string): Promise<HubWikiPageMutationResponse>;
  updateWikiPageMetadata(
    projectId: string,
    provider: HubWikiProvider,
    slug: string,
    input: UpdateWikiPageMetadataInput,
    wikiId?: string,
  ): Promise<HubWikiPageMutationResponse>;
  mergeWikiText(base: string, local: string, incoming: string): Promise<HubWikiMergeResponse>;
  askWiki(
    projectId: string,
    provider: HubWikiProvider,
    slug: string,
    question: string,
    selectedText?: string,
    wikiId?: string,
  ): Promise<HubWikiAnswerResponse>;
  rewriteWikiPage(
    projectId: string,
    provider: HubWikiProvider,
    slug: string,
    instruction: string,
    sectionHeading?: string,
    wikiId?: string,
  ): Promise<HubWikiChangeSet>;
  draftWikiPage(
    projectId: string,
    provider: HubWikiProvider,
    topic: string,
    section?: string,
    wikiId?: string,
  ): Promise<HubWikiPageDraftResponse>;
  cancelTask(taskId: string): Promise<CancelTaskResponse>;
  subscribeToTaskEvents(listener: (event: HubTaskEvent) => void): Promise<Unsubscribe>;
}

const tauriTransport: HubTransport = {
  invoke(command, args) {
    return tauriInvoke(command, args);
  },
  listen(event, listener) {
    return tauriListen(event, listener);
  },
  selectProjectDirectory() {
    return tauriOpen({
      directory: true,
      multiple: false,
      recursive: false,
      title: 'Select a local project',
    });
  },
  selectZreadExecutable() {
    return tauriOpen({
      directory: false,
      multiple: false,
      title: 'Select native zread.exe',
      filters: [{ name: 'Native Zread executable', extensions: ['exe'] }],
    }) as Promise<string | null>;
  },
  copyText(text) {
    return tauriWriteText(text);
  },
};

export class HubProtocolError extends Error {
  readonly code = 'internal_error';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'HubProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HubProtocolError(`Invalid Hub response: ${field} must be a non-empty string.`);
  }
  return value;
}

function parseRunnerInfo(value: unknown): HubRunnerInfo {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: runner payload is malformed.');
  }
  const status = requiredString(value.status, 'runner.status');
  if (status !== 'available' && status !== 'unavailable') {
    throw new HubProtocolError('Invalid Hub response: unknown runner status.');
  }
  return {
    status,
    version: requiredString(value.version, 'runner.version'),
    executablePath: requiredString(value.executablePath, 'runner.executablePath'),
  };
}

const PROVIDERS = ['open_zread', 'zread'] as const;
const PROVIDER_GENERATOR_STATUSES = ['available', 'unavailable', 'not_configured'] as const;
const PROVIDER_CONFIG_SOURCES = ['hub_shared', 'zread_native', 'not_configured'] as const;
const PROVIDER_EXECUTABLE_SOURCES = ['embedded', 'auto_detected', 'manual', 'not_detected'] as const;
const PROVIDER_CAPABILITY_KEYS: (keyof HubProviderCapabilities)[] = [
  'generate',
  'regenerate',
  'sync',
  'login',
  'customApiKeyLogin',
  'machineReadable',
  'unattended',
  'existingDraftActions',
  'skipFailedPages',
  'cliSelfUpdate',
  'structuredProgress',
  'incrementalWikiUpdate',
];

function parseProviderGenerator(value: unknown): HubProviderGeneratorHealth {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: provider generator payload is malformed.');
  }
  const status = requiredString(value.status, 'provider.generator.status');
  const executableSource = requiredString(value.executableSource, 'provider.generator.executableSource');
  if (!PROVIDER_GENERATOR_STATUSES.includes(status as typeof PROVIDER_GENERATOR_STATUSES[number])) {
    throw new HubProtocolError('Invalid Hub response: unknown provider generator status.');
  }
  if (!PROVIDER_EXECUTABLE_SOURCES.includes(executableSource as typeof PROVIDER_EXECUTABLE_SOURCES[number])) {
    throw new HubProtocolError('Invalid Hub response: unknown provider executable source.');
  }
  if (!Array.isArray(value.diagnostics) || value.diagnostics.some((diagnostic) => typeof diagnostic !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: provider diagnostics are malformed.');
  }
  return {
    status: status as HubProviderGeneratorHealth['status'],
    version: requiredString(value.version, 'provider.generator.version'),
    executablePath: requiredString(value.executablePath, 'provider.generator.executablePath'),
    executableSource: executableSource as HubProviderGeneratorHealth['executableSource'],
    diagnostics: value.diagnostics,
  };
}

function parseProviderCapabilities(value: unknown): HubProviderCapabilities {
  if (!isRecord(value) || PROVIDER_CAPABILITY_KEYS.some((key) => typeof value[key] !== 'boolean')) {
    throw new HubProtocolError('Invalid Hub response: provider capabilities are malformed.');
  }
  const capabilities = {} as HubProviderCapabilities;
  for (const key of PROVIDER_CAPABILITY_KEYS) {
    capabilities[key] = value[key] as boolean;
  }
  return capabilities;
}

function parseProviderHealth(value: unknown): HubProviderHealth {
  if (!isRecord(value) || !isRecord(value.content)) {
    throw new HubProtocolError('Invalid Hub response: provider health payload is malformed.');
  }
  const provider = requiredString(value.provider, 'provider.provider');
  const configSource = requiredString(value.configSource, 'provider.configSource');
  if (!PROVIDERS.includes(provider as typeof PROVIDERS[number])) {
    throw new HubProtocolError('Invalid Hub response: unknown provider.');
  }
  if (value.content.status !== 'project_scoped') {
    throw new HubProtocolError('Invalid Hub response: unknown provider content scope.');
  }
  if (!PROVIDER_CONFIG_SOURCES.includes(configSource as typeof PROVIDER_CONFIG_SOURCES[number])) {
    throw new HubProtocolError('Invalid Hub response: unknown provider config source.');
  }
  return {
    provider: provider as HubProviderHealth['provider'],
    content: { status: 'project_scoped' },
    generator: parseProviderGenerator(value.generator),
    capabilities: parseProviderCapabilities(value.capabilities),
    configSource: configSource as HubProviderHealth['configSource'],
  };
}

function parseProviders(value: unknown): HubProviderHealth[] {
  if (!Array.isArray(value) || value.length !== PROVIDERS.length) {
    throw new HubProtocolError('Invalid Hub response: provider health list is malformed.');
  }
  const providers = value.map(parseProviderHealth);
  if (new Set(providers.map((provider) => provider.provider)).size !== PROVIDERS.length
    || !PROVIDERS.every((provider) => providers.some((candidate) => candidate.provider === provider))) {
    throw new HubProtocolError('Invalid Hub response: provider health list is incomplete.');
  }
  return providers;
}

function parseHealth(value: unknown): HubHealth {
  if (!isRecord(value) || !isRecord(value.service)) {
    throw new HubProtocolError('Invalid Hub response: health payload is malformed.');
  }
  const serviceName = requiredString(value.service.name, 'service.name');
  const status = requiredString(value.service.status, 'service.status');
  if (serviceName !== 'Hub Application Service' || !['healthy', 'degraded', 'unavailable'].includes(status)) {
    throw new HubProtocolError('Invalid Hub response: unknown application-service status.');
  }
  const runtime = requiredString(value.runtime, 'runtime');
  if (runtime !== 'tauri') {
    throw new HubProtocolError('Invalid Hub response: unsupported runtime.');
  }
  return {
    appVersion: requiredString(value.appVersion, 'appVersion'),
    runtime,
    os: requiredString(value.os, 'os'),
    runner: parseRunnerInfo(value.runner),
    providers: parseProviders(value.providers),
    service: {
      name: 'Hub Application Service',
      status: status as HubHealth['service']['status'],
    },
  };
}

const PROJECT_AVAILABILITIES: HubProjectAvailability[] = ['available', 'missing', 'inaccessible', 'permission_denied'];
const WIKI_STATUSES: HubWikiStatus[] = ['missing', 'readable', 'partial', 'invalid', 'unavailable'];

function parseProjectWiki(value: unknown): HubProjectWikiSummary {
  if (!isRecord(value)
    || typeof value.openZread !== 'string'
    || typeof value.zread !== 'string'
    || !WIKI_STATUSES.includes(value.openZread as HubWikiStatus)
    || !WIKI_STATUSES.includes(value.zread as HubWikiStatus)) {
    throw new HubProtocolError('Invalid Hub response: project wiki summary is malformed.');
  }
  return {
    openZread: value.openZread as HubWikiStatus,
    zread: value.zread as HubWikiStatus,
  };
}

function parseProject(value: unknown): HubProject {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: project payload is malformed.');
  }
  const availability = requiredString(value.availability, 'project.availability');
  const sourceControl = requiredString(value.sourceControl, 'project.sourceControl');
  if (!PROJECT_AVAILABILITIES.includes(availability as HubProjectAvailability)) {
    throw new HubProtocolError('Invalid Hub response: unknown project availability.');
  }
  if (sourceControl !== 'git' && sourceControl !== 'non_git') {
    throw new HubProtocolError('Invalid Hub response: unknown project source control.');
  }
  if (!Array.isArray(value.previousPaths) || value.previousPaths.some((path) => typeof path !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: project previous paths are malformed.');
  }
  if (typeof value.favorite !== 'boolean') {
    throw new HubProtocolError('Invalid Hub response: project favorite flag is malformed.');
  }
  if (value.availabilityReason !== undefined && typeof value.availabilityReason !== 'string') {
    throw new HubProtocolError('Invalid Hub response: project availability reason is malformed.');
  }
  if (value.lastOpenedAt !== undefined && typeof value.lastOpenedAt !== 'string') {
    throw new HubProtocolError('Invalid Hub response: project last-opened timestamp is malformed.');
  }
  if (value.addedAt !== undefined && typeof value.addedAt !== 'string') {
    throw new HubProtocolError('Invalid Hub response: project added timestamp is malformed.');
  }
  return {
    id: requiredString(value.id, 'project.id'),
    name: requiredString(value.name, 'project.name'),
    path: requiredString(value.path, 'project.path'),
    previousPaths: value.previousPaths,
    sourceControl: sourceControl as HubSourceControl,
    availability: availability as HubProjectAvailability,
    ...(typeof value.availabilityReason === 'string' ? { availabilityReason: value.availabilityReason } : {}),
    wiki: parseProjectWiki(value.wiki),
    favorite: value.favorite,
    ...(typeof value.addedAt === 'string' ? { addedAt: value.addedAt } : {}),
    ...(typeof value.lastOpenedAt === 'string' ? { lastOpenedAt: value.lastOpenedAt } : {}),
  };
}

function parseWikiInstance(value: unknown): HubWikiInstance {
  if (!isRecord(value) || typeof value.wikiId !== 'string' || !value.wikiId
    || (value.provider !== 'open_zread' && value.provider !== 'zread')
    || typeof value.sourceRoot !== 'string' || typeof value.label !== 'string'
    || (value.status !== 'readable' && value.status !== 'partial' && value.status !== 'invalid')) {
    throw new HubProtocolError('Invalid Hub response: Wiki instance is malformed.');
  }
  return {
    wikiId: value.wikiId,
    provider: value.provider,
    sourceRoot: value.sourceRoot,
    label: value.label,
    status: value.status,
  };
}

function parseWikiInstanceList(value: unknown): HubWikiInstanceList {
  if (!isRecord(value) || typeof value.projectId !== 'string' || !Array.isArray(value.instances)
    || typeof value.scanComplete !== 'boolean' || typeof value.scannedDirectories !== 'number'
    || (value.warning !== undefined && typeof value.warning !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: Wiki instance list is malformed.');
  }
  return {
    projectId: value.projectId,
    instances: value.instances.map(parseWikiInstance),
    scanComplete: value.scanComplete,
    scannedDirectories: value.scannedDirectories,
    ...(typeof value.warning === 'string' ? { warning: value.warning } : {}),
  };
}

function parseMarkdownNode(value: unknown): HubMarkdownNode {
  if (!isRecord(value) || (value.kind !== 'directory' && value.kind !== 'file')
    || typeof value.name !== 'string' || typeof value.relativePath !== 'string'
    || (value.title !== undefined && typeof value.title !== 'string')
    || (value.bytes !== undefined && (typeof value.bytes !== 'number' || !Number.isFinite(value.bytes)))
    || (value.modifiedAt !== undefined && typeof value.modifiedAt !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: Markdown tree node is malformed.');
  }
  if (value.kind === 'directory' && !Array.isArray(value.children)) {
    throw new HubProtocolError('Invalid Hub response: Markdown directory children are malformed.');
  }
  if (value.kind === 'file' && value.children !== undefined) {
    throw new HubProtocolError('Invalid Hub response: Markdown file cannot have children.');
  }
  return {
    kind: value.kind,
    name: value.name,
    relativePath: value.relativePath,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.bytes === 'number' ? { bytes: value.bytes } : {}),
    ...(typeof value.modifiedAt === 'string' ? { modifiedAt: value.modifiedAt } : {}),
    ...(Array.isArray(value.children) ? { children: value.children.map(parseMarkdownNode) } : {}),
  };
}

function parseProjectMarkdownTree(value: unknown): HubProjectMarkdownTree {
  if (!isRecord(value) || typeof value.projectId !== 'string' || !Array.isArray(value.roots)
    || typeof value.scanComplete !== 'boolean' || typeof value.scannedDirectories !== 'number'
    || typeof value.scannedFiles !== 'number' || !Array.isArray(value.errors)
    || (value.warning !== undefined && typeof value.warning !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: Markdown tree is malformed.');
  }
  const errors = value.errors.map((item) => {
    if (!isRecord(item) || typeof item.relativePath !== 'string' || typeof item.message !== 'string') {
      throw new HubProtocolError('Invalid Hub response: Markdown scan error is malformed.');
    }
    return { relativePath: item.relativePath, message: item.message };
  });
  return {
    projectId: value.projectId,
    roots: value.roots.map(parseMarkdownNode),
    scanComplete: value.scanComplete,
    scannedDirectories: value.scannedDirectories,
    scannedFiles: value.scannedFiles,
    errors,
    ...(typeof value.warning === 'string' ? { warning: value.warning } : {}),
  };
}

function parseMarkdownDocument(value: unknown): HubMarkdownDocument {
  if (!isRecord(value) || typeof value.projectId !== 'string'
    || typeof value.relativePath !== 'string' || typeof value.title !== 'string'
    || typeof value.content !== 'string' || typeof value.revision !== 'string') {
    throw new HubProtocolError('Invalid Hub response: Markdown document is malformed.');
  }
  return {
    projectId: value.projectId,
    relativePath: value.relativePath,
    title: value.title,
    content: value.content,
    revision: value.revision,
  };
}

function parseMarkdownAnswerResponse(value: unknown): HubMarkdownAnswerResponse {
  if (!isRecord(value)) throw new HubProtocolError('Invalid Hub response: Markdown answer payload is malformed.');
  return {
    projectId: requiredString(value.projectId, 'markdownAnswer.projectId'),
    path: requiredString(value.path, 'markdownAnswer.path'),
    title: requiredString(value.title, 'markdownAnswer.title'),
    model: requiredString(value.model, 'markdownAnswer.model'),
    answer: requiredString(value.answer, 'markdownAnswer.answer'),
  };
}

function parseProjectList(value: unknown): HubProject[] {
  if (!Array.isArray(value)) {
    throw new HubProtocolError('Invalid Hub response: project list is malformed.');
  }
  return value.map(parseProject);
}

const WIKI_PAGE_STATUSES: HubWikiPageStatus[] = ['readable', 'missing', 'unreadable'];

function parseNativeObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HubProtocolError(`Invalid Hub response: ${field} native fields are malformed.`);
  }
  return value;
}

function parseWikiCatalog(value: unknown, provider: HubWikiProvider): HubWikiCatalog {
  if (!isRecord(value)) {
    throw new HubProtocolError(`Invalid Hub response: ${provider} catalog is malformed.`);
  }
  if (value.id !== undefined && typeof value.id !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} catalog id is malformed.`);
  }
  if (value.generatedAt !== undefined && typeof value.generatedAt !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} catalog timestamp is malformed.`);
  }
  if (value.language !== undefined && typeof value.language !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} catalog language is malformed.`);
  }
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    native: parseNativeObject(value.native, 'catalog'),
  };
}

function parseWikiPage(value: unknown, provider: HubWikiProvider): HubWikiPage {
  if (!isRecord(value)) {
    throw new HubProtocolError(`Invalid Hub response: ${provider} page is malformed.`);
  }
  const status = requiredString(value.status, 'page.status');
  if (!WIKI_PAGE_STATUSES.includes(status as HubWikiPageStatus)) {
    throw new HubProtocolError(`Invalid Hub response: unknown ${provider} page status.`);
  }
  if (!Array.isArray(value.associatedFiles) || value.associatedFiles.some((path) => typeof path !== 'string')) {
    throw new HubProtocolError(`Invalid Hub response: ${provider} source references are malformed.`);
  }
  if (value.content !== undefined && typeof value.content !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} page content is malformed.`);
  }
  if (value.error !== undefined && typeof value.error !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} page error is malformed.`);
  }
  if (value.group !== undefined && typeof value.group !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} page group is malformed.`);
  }
  if (value.level !== undefined && typeof value.level !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${provider} page level is malformed.`);
  }
  return {
    slug: requiredString(value.slug, 'page.slug'),
    title: requiredString(value.title, 'page.title'),
    file: requiredString(value.file, 'page.file'),
    section: requiredString(value.section, 'page.section'),
    ...(typeof value.group === 'string' ? { group: value.group } : {}),
    ...(typeof value.level === 'string' ? { level: value.level } : {}),
    associatedFiles: value.associatedFiles,
    status: status as HubWikiPageStatus,
    ...(typeof value.content === 'string' ? { content: value.content } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    native: parseNativeObject(value.native, 'page'),
  };
}

function parseWikiDocument<T extends HubWikiProvider>(value: unknown, expectedProvider: T): HubWikiDocument & { provider: T } {
  if (!isRecord(value) || value.provider !== expectedProvider) {
    throw new HubProtocolError(`Invalid Hub response: ${expectedProvider} Wiki payload is malformed.`);
  }
  if (value.status !== 'readable' && value.status !== 'partial') {
    throw new HubProtocolError(`Invalid Hub response: unknown ${expectedProvider} Wiki status.`);
  }
  if (!Array.isArray(value.pages)) {
    throw new HubProtocolError(`Invalid Hub response: ${expectedProvider} page list is malformed.`);
  }
  if (value.currentPointer !== undefined && typeof value.currentPointer !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${expectedProvider} current pointer is malformed.`);
  }
  if (value.versionId !== undefined && typeof value.versionId !== 'string') {
    throw new HubProtocolError(`Invalid Hub response: ${expectedProvider} version id is malformed.`);
  }
  return {
    provider: expectedProvider,
    wikiId: typeof value.wikiId === 'string' ? value.wikiId : `${expectedProvider}@.`,
    sourceRoot: typeof value.sourceRoot === 'string' ? value.sourceRoot : '.',
    status: value.status,
    catalog: parseWikiCatalog(value.catalog, expectedProvider),
    pages: value.pages.map((page) => parseWikiPage(page, expectedProvider)),
    ...(typeof value.currentPointer === 'string' ? { currentPointer: value.currentPointer } : {}),
    ...(typeof value.versionId === 'string' ? { versionId: value.versionId } : {}),
  };
}

function parseOpenZreadWiki(value: unknown): HubOpenZreadWiki {
  return parseWikiDocument(value, 'open_zread');
}

function parseZreadWiki(value: unknown): HubZreadWiki {
  return parseWikiDocument(value, 'zread');
}

function parseSourceFile(value: unknown): HubSourceFile {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: source file payload is malformed.');
  }
  if (typeof value.content !== 'string') {
    throw new HubProtocolError('Invalid Hub response: source.content must be a string.');
  }
  return {
    path: requiredString(value.path, 'source.path'),
    content: value.content,
  };
}

function parseWikiAsset(value: unknown): HubWikiAsset {
  if (!isRecord(value) || !Array.isArray(value.bytes) || value.bytes.some((byte) => (
    typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255
  ))) {
    throw new HubProtocolError('Invalid Hub response: Wiki asset payload is malformed.');
  }
  return {
    path: requiredString(value.path, 'asset.path'),
    mimeType: requiredString(value.mimeType, 'asset.mimeType'),
    bytes: value.bytes,
  };
}

function invalidRequest(message: string): Promise<never> {
  return Promise.reject({
    code: 'invalid_request',
    message,
    retryable: false,
  });
}

function parseRegisterProjectResponse(value: unknown): RegisterProjectResponse {
  if (!isRecord(value) || typeof value.created !== 'boolean') {
    throw new HubProtocolError('Invalid Hub response: project registration payload is malformed.');
  }
  return {
    project: parseProject(value.project),
    created: value.created,
  };
}

function parseTaskEvent(value: unknown): HubTaskEvent {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub event: task payload is malformed.');
  }
  const kind = requiredString(value.kind, 'kind');
  const status = requiredString(value.status, 'status');
  if (!HUB_TASK_KINDS.includes(kind as HubTaskEvent['kind']) || !HUB_TASK_STATUSES.includes(status as HubTaskEvent['status'])) {
    throw new HubProtocolError('Invalid Hub event: unknown task kind or status.');
  }
  if (value.message !== undefined && typeof value.message !== 'string') {
    throw new HubProtocolError('Invalid Hub event: message must be a string.');
  }
  if (value.details !== undefined && typeof value.details !== 'string') {
    throw new HubProtocolError('Invalid Hub event: details must be a string.');
  }
  if (value.canResume !== undefined && typeof value.canResume !== 'boolean') {
    throw new HubProtocolError('Invalid Hub event: canResume must be a boolean.');
  }
  if (value.progress !== undefined && (!isRecord(value.progress)
    || typeof value.progress.current !== 'number'
    || typeof value.progress.total !== 'number'
    || !Number.isFinite(value.progress.current)
    || !Number.isFinite(value.progress.total))) {
    throw new HubProtocolError('Invalid Hub event: progress must contain finite numbers.');
  }
  return {
    taskId: requiredString(value.taskId, 'taskId'),
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    kind: kind as HubTaskEvent['kind'],
    status: status as HubTaskEvent['status'],
    phase: requiredString(value.phase, 'phase'),
    occurredAt: requiredString(value.occurredAt, 'occurredAt'),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.details === 'string' ? { details: value.details } : {}),
    ...(typeof value.canResume === 'boolean' ? { canResume: value.canResume } : {}),
    ...(isRecord(value.progress)
      && typeof value.progress.current === 'number'
      && typeof value.progress.total === 'number'
      ? { progress: {
        current: value.progress.current,
        total: value.progress.total,
        ...(typeof value.progress.succeeded === 'number' ? { succeeded: value.progress.succeeded } : {}),
        ...(typeof value.progress.failed === 'number' ? { failed: value.progress.failed } : {}),
      } }
      : {}),
  };
}

function parseTask(value: unknown): HubTask {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: task payload is malformed.');
  }
  const kind = requiredString(value.kind, 'kind');
  const status = requiredString(value.status, 'status');
  const operation = requiredString(value.operation, 'operation');
  if (kind !== 'generation' && kind !== 'update') {
    throw new HubProtocolError('Invalid Hub response: task kind is unsupported.');
  }
  if (status !== 'queued' && status !== 'running') {
    throw new HubProtocolError('Invalid Hub response: task status is unsupported.');
  }
  if (operation !== 'generate' && operation !== 'sync') {
    throw new HubProtocolError('Invalid Hub response: OpenZread operation is unsupported.');
  }
  if (value.provider !== 'open_zread' && value.provider !== 'zread') {
    throw new HubProtocolError('Invalid Hub response: task provider is unsupported.');
  }
  return {
    taskId: requiredString(value.taskId, 'taskId'),
    kind,
    status,
    projectId: requiredString(value.projectId, 'projectId'),
    wikiId: requiredString(value.wikiId, 'wikiId'),
    provider: value.provider,
    operation,
    model: requiredString(value.model, 'model'),
    startedAt: requiredString(value.startedAt, 'startedAt'),
  };
}

function parseChangeSet(value: unknown): HubWikiChangeSet {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: ChangeSet payload is malformed.');
  }
  const provider = value.provider;
  const status = value.status;
  if (provider !== 'open_zread' && provider !== 'zread') {
    throw new HubProtocolError('Invalid Hub response: ChangeSet provider is unsupported.');
  }
  if (status !== 'preview' && status !== 'applied' && status !== 'rejected') {
    throw new HubProtocolError('Invalid Hub response: ChangeSet status is unsupported.');
  }
  const operation = value.operation;
  if (operation !== undefined && operation !== 'edit' && operation !== 'create' && operation !== 'batch_create'
    && operation !== 'delete' && operation !== 'metadata') {
    throw new HubProtocolError('Invalid Hub response: ChangeSet operation is unsupported.');
  }
  const emptyContentAllowed = operation !== undefined && operation !== 'edit';
  const changeContent = (field: 'before' | 'after'): string => {
    const content = value[field];
    if (typeof content !== 'string' || (!emptyContentAllowed && !content.trim())) {
      throw new HubProtocolError(`Invalid Hub response: ${field} must be a ${emptyContentAllowed ? 'string' : 'non-empty string'}.`);
    }
    return content;
  };
  const files = value.files === undefined ? undefined : Array.isArray(value.files)
    ? value.files.map((file) => {
      if (!isRecord(file) || (file.action !== 'create' && file.action !== 'update' && file.action !== 'delete')
        || (file.before !== null && typeof file.before !== 'string')
        || (file.after !== null && typeof file.after !== 'string')) {
        throw new HubProtocolError('Invalid Hub response: ChangeSet file operation is malformed.');
      }
      return {
        relativePath: requiredString(file.relativePath, 'relativePath'),
        action: file.action as 'create' | 'update' | 'delete',
        before: file.before,
        after: file.after,
        baseRevision: requiredString(file.baseRevision, 'baseRevision'),
      };
    })
    : (() => { throw new HubProtocolError('Invalid Hub response: ChangeSet files are malformed.'); })();
  let validation: HubWikiChangeSet['validation'];
  if (value.validation !== undefined) {
    if (!isRecord(value.validation) || (value.validation.status !== 'passed' && value.validation.status !== 'failed')
      || !Array.isArray(value.validation.checks) || !value.validation.checks.every((check) => typeof check === 'string')
      || !Array.isArray(value.validation.warnings) || !value.validation.warnings.every((warning) => typeof warning === 'string')) {
      throw new HubProtocolError('Invalid Hub response: ChangeSet validation is malformed.');
    }
    validation = { status: value.validation.status, checks: value.validation.checks, warnings: value.validation.warnings };
  }
  if (value.versionPointer !== undefined && value.versionPointer !== null && typeof value.versionPointer !== 'string') {
    throw new HubProtocolError('Invalid Hub response: ChangeSet version pointer is malformed.');
  }
  return {
    changeSetId: requiredString(value.changeSetId, 'changeSetId'),
    projectId: requiredString(value.projectId, 'projectId'),
    provider,
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    slug: requiredString(value.slug, 'slug'),
    relativePath: requiredString(value.relativePath, 'relativePath'),
    before: changeContent('before'),
    after: changeContent('after'),
    status,
    createdAt: requiredString(value.createdAt, 'createdAt'),
    ...(operation ? { operation } : {}),
    ...(typeof value.baseRevision === 'string' ? { baseRevision: value.baseRevision } : {}),
    ...(value.versionPointer !== undefined ? { versionPointer: value.versionPointer as string | null } : {}),
    ...(files ? { files } : {}),
    ...(validation ? { validation } : {}),
  };
}

function parseHistoryEntry(value: unknown): HubWikiHistoryEntry {
  if (!isRecord(value) || (value.provider !== 'open_zread' && value.provider !== 'zread')) {
    throw new HubProtocolError('Invalid Hub response: history entry is malformed.');
  }
  if (typeof value.current !== 'boolean' || typeof value.pageCount !== 'number' || !Number.isFinite(value.pageCount)) {
    throw new HubProtocolError('Invalid Hub response: history entry metadata is malformed.');
  }
  return {
    id: requiredString(value.id, 'id'),
    projectId: requiredString(value.projectId, 'projectId'),
    provider: value.provider,
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    label: requiredString(value.label, 'label'),
    createdAt: requiredString(value.createdAt, 'createdAt'),
    current: value.current,
    pageCount: value.pageCount,
  };
}

function parseMarkdownSearchResult(value: unknown): HubMarkdownSearchResult {
  if (!isRecord(value) || value.sourceKind !== 'local_markdown'
    || (value.matchKind !== 'path' && value.matchKind !== 'content')) {
    throw new HubProtocolError('Invalid Hub response: Markdown search result is malformed.');
  }
  for (const field of ['matchLine', 'matchColumn', 'matchLength'] as const) {
    if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0)) {
      throw new HubProtocolError(`Invalid Hub response: Markdown search ${field} is malformed.`);
    }
  }
  return {
    sourceKind: 'local_markdown',
    projectId: requiredString(value.projectId, 'markdownResult.projectId'),
    projectName: requiredString(value.projectName, 'markdownResult.projectName'),
    path: requiredString(value.path, 'markdownResult.path'),
    title: requiredString(value.title, 'markdownResult.title'),
    snippet: requiredString(value.snippet, 'markdownResult.snippet'),
    matchKind: value.matchKind,
    ...(typeof value.matchLine === 'number' ? { matchLine: value.matchLine } : {}),
    ...(typeof value.matchColumn === 'number' ? { matchColumn: value.matchColumn } : {}),
    ...(typeof value.matchLength === 'number' ? { matchLength: value.matchLength } : {}),
  };
}

function parseMarkdownSearchFailure(value: unknown): HubMarkdownSearchFailure {
  if (!isRecord(value)) throw new HubProtocolError('Invalid Hub response: Markdown search failure is malformed.');
  return {
    projectId: requiredString(value.projectId, 'markdownFailure.projectId'),
    projectName: requiredString(value.projectName, 'markdownFailure.projectName'),
    ...(typeof value.relativePath === 'string' ? { relativePath: value.relativePath } : {}),
    message: requiredString(value.message, 'markdownFailure.message'),
  };
}

function parseProjectMarkdownSearchResponse(value: unknown): HubProjectMarkdownSearchResponse {
  if (!isRecord(value) || typeof value.projectId !== 'string' || typeof value.query !== 'string'
    || !Array.isArray(value.results) || typeof value.scanComplete !== 'boolean'
    || typeof value.scannedFiles !== 'number' || !Number.isFinite(value.scannedFiles)
    || !Array.isArray(value.errors) || (value.warning !== undefined && typeof value.warning !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: project Markdown search payload is malformed.');
  }
  const errors = value.errors.map((item) => {
    if (!isRecord(item) || typeof item.relativePath !== 'string' || typeof item.message !== 'string') {
      throw new HubProtocolError('Invalid Hub response: Markdown search file error is malformed.');
    }
    return { relativePath: item.relativePath, message: item.message };
  });
  return {
    projectId: value.projectId,
    query: value.query,
    results: value.results.map(parseMarkdownSearchResult),
    scanComplete: value.scanComplete,
    scannedFiles: value.scannedFiles,
    errors,
    ...(typeof value.warning === 'string' ? { warning: value.warning } : {}),
  };
}

function parseSearchResponse(value: unknown): HubWikiSearchResponse {
  if (!isRecord(value) || typeof value.query !== 'string' || !Array.isArray(value.results) || !Array.isArray(value.failures)
    || (value.markdownResults !== undefined && !Array.isArray(value.markdownResults))
    || (value.markdownFailures !== undefined && !Array.isArray(value.markdownFailures))) {
    throw new HubProtocolError('Invalid Hub response: search payload is malformed.');
  }
  const results = value.results.filter(isRecord).map((result) => {
    if (result.provider !== 'open_zread' && result.provider !== 'zread') {
      throw new HubProtocolError('Invalid Hub response: search provider is unsupported.');
    }
    return {
      projectId: requiredString(result.projectId, 'result.projectId'),
      projectName: requiredString(result.projectName, 'result.projectName'),
      provider: result.provider as HubWikiProvider,
      wikiId: requiredString(result.wikiId, 'result.wikiId'),
      sourceRoot: requiredString(result.sourceRoot, 'result.sourceRoot'),
      slug: requiredString(result.slug, 'result.slug'),
      title: requiredString(result.title, 'result.title'),
      snippet: requiredString(result.snippet, 'result.snippet'),
      path: requiredString(result.path, 'result.path'),
    };
  });
  const failures = value.failures.filter(isRecord).map((failure) => {
    if (failure.provider !== 'open_zread' && failure.provider !== 'zread') {
      throw new HubProtocolError('Invalid Hub response: search failure provider is unsupported.');
    }
    return {
      projectId: requiredString(failure.projectId, 'failure.projectId'),
      projectName: requiredString(failure.projectName, 'failure.projectName'),
      provider: failure.provider as HubWikiProvider,
      wikiId: requiredString(failure.wikiId, 'failure.wikiId'),
      sourceRoot: requiredString(failure.sourceRoot, 'failure.sourceRoot'),
      message: requiredString(failure.message, 'failure.message'),
    };
  });
  const markdownResults = (Array.isArray(value.markdownResults) ? value.markdownResults : []).map(parseMarkdownSearchResult);
  const markdownFailures = (Array.isArray(value.markdownFailures) ? value.markdownFailures : []).map(parseMarkdownSearchFailure);
  return { query: value.query, results, failures, markdownResults, markdownFailures };
}

function parseWikiPageMutationResponse(value: unknown): HubWikiPageMutationResponse {
  if (!isRecord(value) || (value.provider !== 'open_zread' && value.provider !== 'zread')) {
    throw new HubProtocolError('Invalid Hub response: Wiki page mutation provider is unsupported.');
  }
  if (value.action !== 'created' && value.action !== 'deleted' && value.action !== 'updated') {
    throw new HubProtocolError('Invalid Hub response: Wiki page mutation action is unsupported.');
  }
  return {
    projectId: requiredString(value.projectId, 'pageMutation.projectId'),
    provider: value.provider,
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    slug: requiredString(value.slug, 'pageMutation.slug'),
    action: value.action,
    relativePath: requiredString(value.relativePath, 'pageMutation.relativePath'),
  };
}

function parseMergeResponse(value: unknown): HubWikiMergeResponse {
  if (!isRecord(value) || (value.status !== 'clean' && value.status !== 'conflicted')
    || typeof value.content !== 'string' || !Array.isArray(value.conflicts)) {
    throw new HubProtocolError('Invalid Hub response: Wiki merge payload is malformed.');
  }
  const conflicts = value.conflicts.map((conflict) => {
    if (!isRecord(conflict)
      || typeof conflict.base !== 'string'
      || typeof conflict.local !== 'string'
      || typeof conflict.incoming !== 'string') {
      throw new HubProtocolError('Invalid Hub response: Wiki merge conflict is malformed.');
    }
    return { base: conflict.base, local: conflict.local, incoming: conflict.incoming };
  });
  return { status: value.status, content: value.content, conflicts };
}

function parseAnswerResponse(value: unknown): HubWikiAnswerResponse {
  if (!isRecord(value) || (value.provider !== 'open_zread' && value.provider !== 'zread')
    || !Array.isArray(value.references)) {
    throw new HubProtocolError('Invalid Hub response: Wiki answer payload is malformed.');
  }
  const references = value.references.map((reference) => {
    if (!isRecord(reference)) {
      throw new HubProtocolError('Invalid Hub response: Wiki answer reference is malformed.');
    }
    return {
      slug: requiredString(reference.slug, 'answer.reference.slug'),
      title: requiredString(reference.title, 'answer.reference.title'),
    };
  });
  return {
    projectId: requiredString(value.projectId, 'answer.projectId'),
    provider: value.provider,
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    slug: requiredString(value.slug, 'answer.slug'),
    answer: requiredString(value.answer, 'answer.answer'),
    references,
  };
}

function parsePageDraftResponse(value: unknown): HubWikiPageDraftResponse {
  if (!isRecord(value) || (value.provider !== 'open_zread' && value.provider !== 'zread')
    || !Array.isArray(value.associatedFiles)
    || value.associatedFiles.some((path) => typeof path !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: Wiki page draft payload is malformed.');
  }
  return {
    provider: value.provider,
    slug: requiredString(value.slug, 'draft.slug'),
    title: requiredString(value.title, 'draft.title'),
    section: requiredString(value.section, 'draft.section'),
    content: requiredString(value.content, 'draft.content'),
    associatedFiles: value.associatedFiles,
  };
}

function parseBatchMutationResponse(value: unknown): HubWikiBatchMutationResponse {
  if (!isRecord(value) || (value.provider !== 'open_zread' && value.provider !== 'zread') || !Array.isArray(value.mutations)) {
    throw new HubProtocolError('Invalid Hub response: Wiki batch mutation payload is malformed.');
  }
  return {
    projectId: requiredString(value.projectId, 'batchMutation.projectId'),
    provider: value.provider,
    ...(typeof value.wikiId === 'string' ? { wikiId: value.wikiId } : {}),
    mutations: value.mutations.map(parseWikiPageMutationResponse),
  };
}

/**
 * Create the typed client used by React and future Tauri command adapters.
 * React never receives a filesystem or process capability from this boundary.
 */
export function createHubApplicationService(
  transport: HubTransport = tauriTransport,
): HubApplicationService {
  return {
    getHealth() {
      return transport.invoke(HUB_COMMANDS.getHealth).then(parseHealth);
    },

    configureZreadExecutable() {
      if (!transport.selectZreadExecutable) {
        return Promise.reject(new HubProtocolError('Zread executable selection is unavailable in this runtime.'));
      }
      return transport.selectZreadExecutable().then((path) => {
        if (path === null) {
          return null;
        }
        if (typeof path !== 'string' || path.trim().length === 0) {
          throw new HubProtocolError('Invalid Hub response: selected Zread executable path is malformed.');
        }
        return transport.invoke(HUB_COMMANDS.setZreadExecutable, { executablePath: path.trim() })
          .then(parseHealth);
      });
    },

    listProjects() {
      return transport.invoke(HUB_COMMANDS.listProjects).then(parseProjectList);
    },

    selectProjectDirectory() {
      return transport.selectProjectDirectory().then((path) => {
        if (path !== null && typeof path !== 'string') {
          throw new HubProtocolError('Invalid Hub response: selected project path is malformed.');
        }
        return path;
      });
    },

    copyText(text) {
      return transport.copyText(text);
    },

    registerProject(path) {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        return Promise.reject({
          code: 'invalid_request',
          message: 'Project path is required.',
          retryable: false,
        });
      }
      return transport.invoke(HUB_COMMANDS.registerProject, { path: normalizedPath })
        .then(parseRegisterProjectResponse);
    },

    setProjectFavorite(projectId, favorite) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.setProjectFavorite, {
        projectId: normalizedId,
        favorite,
      }).then(parseProject);
    },

    renameProject(projectId, name) {
      const normalizedId = projectId.trim();
      const normalizedName = name.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedName) return invalidRequest('Project name is required.');
      return transport.invoke(HUB_COMMANDS.renameProject, {
        projectId: normalizedId,
        name: normalizedName,
      }).then(parseProject);
    },

    listProjectWikis(projectId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      return transport.invoke(HUB_COMMANDS.listProjectWikis, { projectId: normalizedId })
        .then(parseWikiInstanceList);
    },

    locateProjectWikis(projectId, directory) {
      const normalizedId = projectId.trim();
      const normalizedDirectory = directory.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedDirectory) return invalidRequest('Wiki directory is required.');
      return transport.invoke(HUB_COMMANDS.locateProjectWikis, {
        projectId: normalizedId,
        directory: normalizedDirectory,
      }).then(parseWikiInstanceList);
    },

    listProjectMarkdown(projectId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      return transport.invoke(HUB_COMMANDS.listProjectMarkdown, { projectId: normalizedId })
        .then(parseProjectMarkdownTree);
    },

    readProjectMarkdown(projectId, relativePath) {
      const normalizedId = projectId.trim();
      const normalizedPath = relativePath.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedPath) return invalidRequest('Markdown path is required.');
      return transport.invoke(HUB_COMMANDS.readProjectMarkdown, {
        projectId: normalizedId,
        relativePath: normalizedPath,
      }).then(parseMarkdownDocument);
    },

    saveProjectMarkdown(projectId, relativePath, baseRevision, content) {
      const normalizedId = projectId.trim();
      const normalizedPath = relativePath.trim();
      const normalizedRevision = baseRevision.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedPath) return invalidRequest('Markdown path is required.');
      if (!normalizedRevision) return invalidRequest('Markdown base revision is required.');
      return transport.invoke(HUB_COMMANDS.saveProjectMarkdown, {
        projectId: normalizedId,
        relativePath: normalizedPath,
        baseRevision: normalizedRevision,
        content,
      }).then(parseMarkdownDocument);
    },

    readProjectMarkdownAsset(projectId, documentPath, assetPath) {
      const normalizedId = projectId.trim();
      const normalizedDocumentPath = documentPath.trim();
      const normalizedAssetPath = assetPath.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedDocumentPath) return invalidRequest('Markdown document path is required.');
      if (!normalizedAssetPath) return invalidRequest('Markdown asset path is required.');
      return transport.invoke(HUB_COMMANDS.readProjectMarkdownAsset, {
        projectId: normalizedId,
        documentPath: normalizedDocumentPath,
        assetPath: normalizedAssetPath,
      }).then(parseWikiAsset);
    },

    readProjectMarkdownSource(projectId, documentPath, sourcePath) {
      const normalizedId = projectId.trim();
      const normalizedDocumentPath = documentPath.trim();
      const normalizedSourcePath = sourcePath.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedDocumentPath) return invalidRequest('Markdown document path is required.');
      if (!normalizedSourcePath) return invalidRequest('Markdown source path is required.');
      return transport.invoke(HUB_COMMANDS.readProjectMarkdownSource, {
        projectId: normalizedId,
        documentPath: normalizedDocumentPath,
        sourcePath: normalizedSourcePath,
      }).then(parseSourceFile);
    },

    relocateProject(projectId, path) {
      const normalizedId = projectId.trim();
      const normalizedPath = path.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedPath) {
        return invalidRequest('Project path is required.');
      }
      return transport.invoke(HUB_COMMANDS.relocateProject, {
        projectId: normalizedId,
        path: normalizedPath,
      }).then(parseProject);
    },

    removeProject(projectId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.removeProject, {
        projectId: normalizedId,
      }).then(() => undefined);
    },

    openProjectFolder(projectId) {
      return openProject(projectId, HUB_COMMANDS.openProjectFolder, transport);
    },

    openProjectTerminal(projectId) {
      return openProject(projectId, HUB_COMMANDS.openProjectTerminal, transport);
    },

    copyProjectPath(path) {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        return invalidRequest('Project path is required.');
      }
      return transport.copyText(normalizedPath);
    },

    readOpenZreadWiki(projectId, wikiId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.readOpenZreadWiki, {
        projectId: normalizedId,
        ...(wikiId ? { wikiId } : {}),
      })
        .then(parseOpenZreadWiki);
    },

    readOpenZreadSource(projectId, path, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedPath = path.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedPath) {
        return invalidRequest('Source path is required.');
      }
      return transport.invoke(HUB_COMMANDS.readOpenZreadSource, {
        projectId: normalizedId,
        path: normalizedPath,
        ...(wikiId ? { wikiId } : {}),
      }).then(parseSourceFile);
    },

    readOpenZreadAsset(projectId, pagePath, assetPath, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedPagePath = pagePath.trim();
      const normalizedAssetPath = assetPath.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedPagePath) {
        return invalidRequest('Wiki page path is required.');
      }
      if (!normalizedAssetPath) {
        return invalidRequest('Wiki asset path is required.');
      }
      return transport.invoke(HUB_COMMANDS.readOpenZreadAsset, {
        projectId: normalizedId,
        pagePath: normalizedPagePath,
        assetPath: normalizedAssetPath,
        ...(wikiId ? { wikiId } : {}),
      }).then(parseWikiAsset);
    },

    readZreadWiki(projectId, wikiId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.readZreadWiki, {
        projectId: normalizedId,
        ...(wikiId ? { wikiId } : {}),
      })
        .then(parseZreadWiki);
    },

    readZreadSource(projectId, path, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedPath = path.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedPath) {
        return invalidRequest('Source path is required.');
      }
      return transport.invoke(HUB_COMMANDS.readZreadSource, {
        projectId: normalizedId,
        path: normalizedPath,
        ...(wikiId ? { wikiId } : {}),
      }).then(parseSourceFile);
    },

    readZreadAsset(projectId, pagePath, assetPath, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedPagePath = pagePath.trim();
      const normalizedAssetPath = assetPath.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedPagePath) {
        return invalidRequest('Wiki page path is required.');
      }
      if (!normalizedAssetPath) {
        return invalidRequest('Wiki asset path is required.');
      }
      return transport.invoke(HUB_COMMANDS.readZreadAsset, {
        projectId: normalizedId,
        pagePath: normalizedPagePath,
        assetPath: normalizedAssetPath,
        ...(wikiId ? { wikiId } : {}),
      }).then(parseWikiAsset);
    },

    startOpenZreadTask(projectId, wikiId, operation, resume = false) {
      const normalizedId = projectId.trim();
      const normalizedWikiId = wikiId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedWikiId) {
        return invalidRequest('Wiki instance id is required.');
      }
      if (operation !== 'generate' && operation !== 'sync') {
        return invalidRequest('OpenZread operation must be generate or sync.');
      }
      return transport.invoke(HUB_COMMANDS.startOpenZreadTask, {
        projectId: normalizedId,
        wikiId: normalizedWikiId,
        operation,
        resume,
      }).then(parseTask);
    },

    startZreadTask(projectId, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedWikiId = wikiId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      if (!normalizedWikiId) {
        return invalidRequest('Wiki instance id is required.');
      }
      return transport.invoke(HUB_COMMANDS.startZreadTask, {
        projectId: normalizedId,
        wikiId: normalizedWikiId,
      }).then(parseTask);
    },

    previewWikiChange(projectId, provider, slug, content, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = slug.trim();
      if (!normalizedId || !normalizedSlug) {
        return invalidRequest('Project id and page slug are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.previewWikiChange, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
        content,
      }).then(parseChangeSet);
    },

    previewWikiStructureChange(projectId, provider, request, wikiId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (provider !== 'open_zread' && provider !== 'zread') return invalidRequest('Wiki provider is required.');
      if (request.operation === 'create' && request.pages.length === 0) return invalidRequest('At least one Wiki page is required.');
      if (request.operation === 'delete' && !request.slug.trim()) return invalidRequest('Page slug is required.');
      if (request.operation === 'metadata' && !request.slug.trim()) return invalidRequest('Page slug is required.');
      return transport.invoke(HUB_COMMANDS.previewWikiStructureChange, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        request,
      }).then(parseChangeSet);
    },

    applyWikiChange(changeSetId) {
      const normalizedId = changeSetId.trim();
      if (!normalizedId) {
        return invalidRequest('ChangeSet id is required.');
      }
      return transport.invoke(HUB_COMMANDS.applyWikiChange, {
        changeSetId: normalizedId,
      }).then(parseChangeSet);
    },

    listWikiHistory(projectId, provider, wikiId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.listWikiHistory, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
      }).then((value) => {
        if (!Array.isArray(value)) {
          throw new HubProtocolError('Invalid Hub response: history is not a list.');
        }
        return value.map(parseHistoryEntry);
      });
    },

    restoreWikiHistory(projectId, provider, historyId, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedHistoryId = historyId.trim();
      if (!normalizedId || !normalizedHistoryId) {
        return invalidRequest('Project id and history id are required.');
      }
      return transport.invoke(HUB_COMMANDS.restoreWikiHistory, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        historyId: normalizedHistoryId,
      }).then(parseHistoryEntry);
    },

    searchWiki(query) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return invalidRequest('Search query is required.');
      }
      return transport.invoke(HUB_COMMANDS.searchWiki, { query: normalizedQuery }).then(parseSearchResponse);
    },

    searchProjectMarkdown(projectId, query) {
      const normalizedId = projectId.trim();
      const normalizedQuery = query.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedQuery) return invalidRequest('Search query is required.');
      return transport.invoke(HUB_COMMANDS.searchProjectMarkdown, {
        projectId: normalizedId,
        query: normalizedQuery,
      }).then(parseProjectMarkdownSearchResponse);
    },

    askProjectMarkdown(projectId, relativePath, question, selectedText) {
      const normalizedId = projectId.trim();
      const normalizedPath = relativePath.trim();
      const normalizedQuestion = question.trim();
      if (!normalizedId) return invalidRequest('Project id is required.');
      if (!normalizedPath) return invalidRequest('Markdown path is required.');
      if (!normalizedQuestion) return invalidRequest('A question is required.');
      return transport.invoke(HUB_COMMANDS.askProjectMarkdown, {
        projectId: normalizedId,
        relativePath: normalizedPath,
        question: normalizedQuestion,
        ...(selectedText?.trim() ? { selectedText: selectedText.trim() } : {}),
      }).then(parseMarkdownAnswerResponse);
    },

    createWikiPage(projectId, provider, input, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = input.slug.trim();
      const normalizedTitle = input.title.trim();
      const normalizedSection = input.section.trim();
      if (!normalizedId || !normalizedSlug || !normalizedTitle || !normalizedSection) {
        return invalidRequest('Project id, page slug, title, and section are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.createWikiPage, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
        title: normalizedTitle,
        section: normalizedSection,
        ...(input.group?.trim() ? { group: input.group.trim() } : {}),
        content: input.content,
        associatedFiles: input.associatedFiles,
      }).then(parseWikiPageMutationResponse);
    },

    createWikiPages(projectId, provider, inputs, wikiId) {
      const normalizedId = projectId.trim();
      if (!normalizedId || inputs.length === 0) {
        return invalidRequest('Project id and at least one Wiki page are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.createWikiPages, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        pages: inputs.map((input) => ({
          slug: input.slug.trim(),
          title: input.title.trim(),
          section: input.section.trim(),
          ...(input.group?.trim() ? { group: input.group.trim() } : {}),
          content: input.content,
          associatedFiles: input.associatedFiles,
        })),
      }).then(parseBatchMutationResponse);
    },

    deleteWikiPage(projectId, provider, slug, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = slug.trim();
      if (!normalizedId || !normalizedSlug) {
        return invalidRequest('Project id and page slug are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.deleteWikiPage, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
      }).then(parseWikiPageMutationResponse);
    },

    updateWikiPageMetadata(projectId, provider, slug, input, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = slug.trim();
      if (!normalizedId || !normalizedSlug) {
        return invalidRequest('Project id and page slug are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      const normalizedInput = {
        ...(input.newSlug?.trim() ? { newSlug: input.newSlug.trim() } : {}),
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.section?.trim() ? { section: input.section.trim() } : {}),
        ...(input.group?.trim() ? { group: input.group.trim() } : {}),
        ...(input.associatedFiles !== undefined ? { associatedFiles: input.associatedFiles } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.clearGroup ? { clearGroup: true } : {}),
      };
      if (input.order !== undefined && (!Number.isInteger(input.order) || input.order < 0)) {
        return invalidRequest('Page order must be a non-negative integer.');
      }
      if (Object.keys(normalizedInput).length === 0) {
        return invalidRequest('At least one page metadata field is required.');
      }
      return transport.invoke(HUB_COMMANDS.updateWikiPageMetadata, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
        ...normalizedInput,
      }).then(parseWikiPageMutationResponse);
    },

    mergeWikiText(base, local, incoming) {
      if (!base && !local && !incoming) {
        return invalidRequest('At least one Wiki revision is required.');
      }
      return transport.invoke(HUB_COMMANDS.mergeWikiText, { base, local, incoming }).then(parseMergeResponse);
    },

    askWiki(projectId, provider, slug, question, selectedText, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = slug.trim();
      const normalizedQuestion = question.trim();
      if (!normalizedId || !normalizedSlug || !normalizedQuestion) {
        return invalidRequest('Project id, page slug, and question are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.askWiki, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
        question: normalizedQuestion,
        ...(selectedText?.trim() ? { selectedText: selectedText.trim() } : {}),
      }).then(parseAnswerResponse);
    },

    rewriteWikiPage(projectId, provider, slug, instruction, sectionHeading, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedSlug = slug.trim();
      const normalizedInstruction = instruction.trim();
      if (!normalizedId || !normalizedSlug || !normalizedInstruction) {
        return invalidRequest('Project id, page slug, and rewrite instruction are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.rewriteWikiPage, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        slug: normalizedSlug,
        instruction: normalizedInstruction,
        ...(sectionHeading?.trim() ? { sectionHeading: sectionHeading.trim() } : {}),
      }).then(parseChangeSet);
    },

    draftWikiPage(projectId, provider, topic, section, wikiId) {
      const normalizedId = projectId.trim();
      const normalizedTopic = topic.trim();
      if (!normalizedId || !normalizedTopic) {
        return invalidRequest('Project id and page topic are required.');
      }
      if (provider !== 'open_zread' && provider !== 'zread') {
        return invalidRequest('Wiki provider is required.');
      }
      return transport.invoke(HUB_COMMANDS.draftWikiPage, {
        projectId: normalizedId,
        provider,
        ...(wikiId !== undefined ? { wikiId } : {}),
        topic: normalizedTopic,
        ...(section?.trim() ? { section: section.trim() } : {}),
      }).then(parsePageDraftResponse);
    },

    cancelTask(taskId) {
      const normalizedTaskId = taskId.trim();
      if (!normalizedTaskId) {
        return Promise.reject({
          code: 'invalid_request',
          message: 'Task id is required.',
          retryable: false,
        });
      }
      return transport.invoke(HUB_COMMANDS.cancelTask, {
        taskId: normalizedTaskId,
      }).then((response) => {
        if (!isRecord(response) || typeof response.taskId !== 'string' || typeof response.accepted !== 'boolean') {
          throw new HubProtocolError('Invalid Hub response: cancellation payload is malformed.');
        }
        if (response.status !== 'cancelling' && response.status !== 'cancelled') {
          throw new HubProtocolError('Invalid Hub response: unknown cancellation status.');
        }
        return {
          taskId: response.taskId,
          accepted: response.accepted,
          status: response.status,
        } as CancelTaskResponse;
      });
    },

    subscribeToTaskEvents(listener) {
      return transport.listen(HUB_EVENTS.task, (event) => {
        try {
          listener(parseTaskEvent(event.payload));
        } catch {
          // Ignore malformed events; an invalid payload must not break the event stream.
        }
      });
    },
  };
}

function openProject(
  projectId: string,
  command: typeof HUB_COMMANDS.openProjectFolder | typeof HUB_COMMANDS.openProjectTerminal,
  transport: HubTransport,
): Promise<HubProject> {
  const normalizedId = projectId.trim();
  if (!normalizedId) {
    return invalidRequest('Project id is required.');
  }
  return transport.invoke(command, { projectId: normalizedId }).then(parseProject);
}
