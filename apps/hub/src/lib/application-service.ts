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
  type HubSourceFile,
  type HubWikiAsset,
  type HubWikiCatalog,
  type HubWikiPage,
  type HubWikiPageStatus,
  type HubSourceControl,
  type HubWikiStatus,
  type HubRunnerInfo,
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
  copyText(text: string): Promise<void>;
}

export interface HubApplicationService {
  getHealth(): Promise<HubHealth>;
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

function parseWikiCatalog(value: unknown): HubWikiCatalog {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: OpenZread catalog is malformed.');
  }
  if (value.id !== undefined && typeof value.id !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread catalog id is malformed.');
  }
  if (value.generatedAt !== undefined && typeof value.generatedAt !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread catalog timestamp is malformed.');
  }
  if (value.language !== undefined && typeof value.language !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread catalog language is malformed.');
  }
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    native: parseNativeObject(value.native, 'catalog'),
  };
}

function parseWikiPage(value: unknown): HubWikiPage {
  if (!isRecord(value)) {
    throw new HubProtocolError('Invalid Hub response: OpenZread page is malformed.');
  }
  const status = requiredString(value.status, 'page.status');
  if (!WIKI_PAGE_STATUSES.includes(status as HubWikiPageStatus)) {
    throw new HubProtocolError('Invalid Hub response: unknown OpenZread page status.');
  }
  if (!Array.isArray(value.associatedFiles) || value.associatedFiles.some((path) => typeof path !== 'string')) {
    throw new HubProtocolError('Invalid Hub response: OpenZread source references are malformed.');
  }
  if (value.content !== undefined && typeof value.content !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread page content is malformed.');
  }
  if (value.error !== undefined && typeof value.error !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread page error is malformed.');
  }
  if (value.group !== undefined && typeof value.group !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread page group is malformed.');
  }
  if (value.level !== undefined && typeof value.level !== 'string') {
    throw new HubProtocolError('Invalid Hub response: OpenZread page level is malformed.');
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

function parseOpenZreadWiki(value: unknown): HubOpenZreadWiki {
  if (!isRecord(value) || value.provider !== 'open_zread') {
    throw new HubProtocolError('Invalid Hub response: OpenZread Wiki payload is malformed.');
  }
  if (value.status !== 'readable' && value.status !== 'partial') {
    throw new HubProtocolError('Invalid Hub response: unknown OpenZread Wiki status.');
  }
  if (!Array.isArray(value.pages)) {
    throw new HubProtocolError('Invalid Hub response: OpenZread page list is malformed.');
  }
  return {
    provider: 'open_zread',
    status: value.status,
    catalog: parseWikiCatalog(value.catalog),
    pages: value.pages.map(parseWikiPage),
  };
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
