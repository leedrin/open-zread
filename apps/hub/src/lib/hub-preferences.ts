import type { HubWikiProvider } from '@open-zread/hub-contract';

export type HubView = 'home' | 'projects' | 'search' | 'tasks' | 'providers' | 'settings' | 'project';
export type HubProjectSection = 'overview' | 'wiki' | 'markdown' | 'source' | 'maintenance' | 'settings';
export type HubProjectSort = 'favorite' | 'name-asc' | 'name-desc' | 'added-newest' | 'added-oldest';

export interface PersistedReaderSession {
  selectedSlug?: string;
  scrollTop: number;
  expandedSections?: string[];
}

export interface RecentWikiVisit {
  projectId: string;
  provider: HubWikiProvider;
  wikiId?: string;
  sourceRoot?: string;
  slug: string;
  title: string;
  visitedAt: number;
}

export interface HubPreferences {
  version: 1;
  view: HubView;
  projectId?: string;
  projectSection?: HubProjectSection;
  sidebarCollapsed: boolean;
  recentProjectIds: string[];
  recentWikiVisits: RecentWikiVisit[];
  readerSessions: Record<string, PersistedReaderSession>;
  projectSort: HubProjectSort;
  projectTreeExpanded: boolean;
  expandedProjectIds: string[];
  expandedMarkdownPaths: Record<string, string[]>;
  markdownRecentFiles: Record<string, string>;
  markdownScrollPositions: Record<string, number>;
}

const STORAGE_KEY = 'open-zread-hub.preferences.v1';
const DEFAULT_PREFERENCES: HubPreferences = {
  version: 1,
  view: 'home',
  sidebarCollapsed: false,
  recentProjectIds: [],
  recentWikiVisits: [],
  readerSessions: {},
  projectSort: 'favorite',
  projectTreeExpanded: false,
  expandedProjectIds: [],
  expandedMarkdownPaths: {},
  markdownRecentFiles: {},
  markdownScrollPositions: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isView(value: unknown): value is HubView {
  return value === 'home' || value === 'projects' || value === 'search'
    || value === 'tasks' || value === 'providers' || value === 'settings'
    || value === 'project';
}

function isProjectSection(value: unknown): value is HubProjectSection {
  return value === 'overview' || value === 'wiki' || value === 'markdown' || value === 'source'
    || value === 'maintenance' || value === 'settings';
}

function isProvider(value: unknown): value is HubWikiProvider {
  return value === 'open_zread' || value === 'zread';
}

function isSession(value: unknown): value is PersistedReaderSession {
  if (!isRecord(value) || typeof value.scrollTop !== 'number' || !Number.isFinite(value.scrollTop)) {
    return false;
  }
  return (value.selectedSlug === undefined || typeof value.selectedSlug === 'string')
    && (value.expandedSections === undefined
      || (Array.isArray(value.expandedSections) && value.expandedSections.every((item) => typeof item === 'string')));
}

function parsePreferences(value: unknown): HubPreferences {
  if (!isRecord(value) || value.version !== 1) {
    return DEFAULT_PREFERENCES;
  }
  const readerSessions: Record<string, PersistedReaderSession> = {};
  if (isRecord(value.readerSessions)) {
    for (const [key, session] of Object.entries(value.readerSessions)) {
      if (key.length > 0 && isSession(session)) {
        const legacyRoot = key.endsWith(':open_zread') || key.endsWith(':zread');
        const normalizedKey = legacyRoot ? `${key}@.` : key;
        readerSessions[normalizedKey] = session;
      }
    }
  }
  const recentWikiVisits = Array.isArray(value.recentWikiVisits)
    ? value.recentWikiVisits.filter((visit): visit is RecentWikiVisit => (
      isRecord(visit)
      && typeof visit.projectId === 'string'
      && isProvider(visit.provider)
      && (visit.wikiId === undefined || typeof visit.wikiId === 'string')
      && (visit.sourceRoot === undefined || typeof visit.sourceRoot === 'string')
      && typeof visit.slug === 'string'
      && typeof visit.title === 'string'
      && typeof visit.visitedAt === 'number'
      && Number.isFinite(visit.visitedAt)
    )).map((visit) => ({
      ...visit,
      wikiId: typeof visit.wikiId === 'string' ? visit.wikiId : `${visit.provider}@.`,
      sourceRoot: typeof visit.sourceRoot === 'string' ? visit.sourceRoot : '.',
    })).slice(0, 20)
    : [];
  const expandedMarkdownPaths: Record<string, string[]> = {};
  if (isRecord(value.expandedMarkdownPaths)) {
    for (const [projectId, paths] of Object.entries(value.expandedMarkdownPaths)) {
      if (projectId && Array.isArray(paths)) {
        expandedMarkdownPaths[projectId] = [...new Set(paths.filter((path): path is string => typeof path === 'string'))].slice(0, 500);
      }
    }
  }
  const markdownRecentFiles: Record<string, string> = {};
  if (isRecord(value.markdownRecentFiles)) {
    for (const [projectId, path] of Object.entries(value.markdownRecentFiles)) {
      if (projectId && typeof path === 'string') markdownRecentFiles[projectId] = path;
    }
  }
  const markdownScrollPositions: Record<string, number> = {};
  if (isRecord(value.markdownScrollPositions)) {
    for (const [key, position] of Object.entries(value.markdownScrollPositions)) {
      if (!key || typeof position !== 'number' || !Number.isFinite(position) || position < 0) continue;
      if (key.includes(':')) {
        markdownScrollPositions[key] = position;
      } else {
        const recentFile = markdownRecentFiles[key];
        if (recentFile) markdownScrollPositions[markdownSessionKey(key, recentFile)] = position;
      }
    }
  }
  return {
    version: 1,
    view: isView(value.view) ? value.view : 'home',
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    projectSection: isProjectSection(value.projectSection) ? value.projectSection : undefined,
    sidebarCollapsed: value.sidebarCollapsed === true,
    recentProjectIds: Array.isArray(value.recentProjectIds)
      ? [...new Set(value.recentProjectIds.filter((item): item is string => typeof item === 'string'))].slice(0, 20)
      : [],
    recentWikiVisits,
    readerSessions,
    projectSort: value.projectSort === 'name-asc' || value.projectSort === 'name-desc'
      || value.projectSort === 'added-newest' || value.projectSort === 'added-oldest'
      ? value.projectSort : 'favorite',
    projectTreeExpanded: value.projectTreeExpanded === true,
    expandedProjectIds: Array.isArray(value.expandedProjectIds)
      ? [...new Set(value.expandedProjectIds.filter((item): item is string => typeof item === 'string'))].slice(0, 100)
      : [],
    expandedMarkdownPaths,
    markdownRecentFiles,
    markdownScrollPositions,
  };
}

export function loadHubPreferences(): HubPreferences {
  try {
    if (typeof globalThis.localStorage === 'undefined') {
      return DEFAULT_PREFERENCES;
    }
    const serialized = globalThis.localStorage.getItem(STORAGE_KEY);
    return serialized ? parsePreferences(JSON.parse(serialized) as unknown) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveHubPreferences(preferences: HubPreferences): boolean {
  try {
    if (typeof globalThis.localStorage === 'undefined') {
      return false;
    }
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function readerSessionKey(projectId: string, providerOrWikiId: HubWikiProvider | string): string {
  const wikiId = providerOrWikiId.includes('@') ? providerOrWikiId : `${providerOrWikiId}@.`;
  return `${projectId}:${wikiId}`;
}

export function markdownSessionKey(projectId: string, relativePath: string): string {
  return `${projectId}:${relativePath.replace(/\\/g, '/')}`;
}
