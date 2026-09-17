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
  registerProject(path: string): Promise<RegisterProjectResponse>;
  setProjectFavorite(projectId: string, favorite: boolean): Promise<HubProject>;
  relocateProject(projectId: string, path: string): Promise<HubProject>;
  removeProject(projectId: string): Promise<void>;
  openProjectFolder(projectId: string): Promise<HubProject>;
  openProjectTerminal(projectId: string): Promise<HubProject>;
  copyProjectPath(path: string): Promise<void>;
  readOpenZreadWiki(projectId: string): Promise<HubOpenZreadWiki>;
  readOpenZreadSource(projectId: string, path: string): Promise<HubSourceFile>;
  readOpenZreadAsset(projectId: string, pagePath: string, assetPath: string): Promise<HubWikiAsset>;
  readZreadWiki(projectId: string): Promise<HubZreadWiki>;
  readZreadSource(projectId: string, path: string): Promise<HubSourceFile>;
  readZreadAsset(projectId: string, pagePath: string, assetPath: string): Promise<HubWikiAsset>;
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
    ...(typeof value.lastOpenedAt === 'string' ? { lastOpenedAt: value.lastOpenedAt } : {}),
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
  if (value.progress !== undefined && (!isRecord(value.progress)
    || typeof value.progress.current !== 'number'
    || typeof value.progress.total !== 'number'
    || !Number.isFinite(value.progress.current)
    || !Number.isFinite(value.progress.total))) {
    throw new HubProtocolError('Invalid Hub event: progress must contain finite numbers.');
  }
  return {
    taskId: requiredString(value.taskId, 'taskId'),
    kind: kind as HubTaskEvent['kind'],
    status: status as HubTaskEvent['status'],
    phase: requiredString(value.phase, 'phase'),
    occurredAt: requiredString(value.occurredAt, 'occurredAt'),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(isRecord(value.progress)
      && typeof value.progress.current === 'number'
      && typeof value.progress.total === 'number'
      ? { progress: { current: value.progress.current, total: value.progress.total } }
      : {}),
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

    readOpenZreadWiki(projectId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.readOpenZreadWiki, { projectId: normalizedId })
        .then(parseOpenZreadWiki);
    },

    readOpenZreadSource(projectId, path) {
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
      }).then(parseSourceFile);
    },

    readOpenZreadAsset(projectId, pagePath, assetPath) {
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
      }).then(parseWikiAsset);
    },

    readZreadWiki(projectId) {
      const normalizedId = projectId.trim();
      if (!normalizedId) {
        return invalidRequest('Project id is required.');
      }
      return transport.invoke(HUB_COMMANDS.readZreadWiki, { projectId: normalizedId })
        .then(parseZreadWiki);
    },

    readZreadSource(projectId, path) {
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
      }).then(parseSourceFile);
    },

    readZreadAsset(projectId, pagePath, assetPath) {
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
      }).then(parseWikiAsset);
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
