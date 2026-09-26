import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  HubHealth,
  HubMarkdownDocument,
  HubMarkdownAnswerResponse,
  HubMarkdownSearchResult,
  HubMarkdownNode,
  HubProjectMarkdownSearchResponse,
  HubProject,
  HubProviderHealth,
  HubTask,
  HubTaskEvent,
  HubWikiDocument,
  HubWikiProvider,
} from '@open-zread/hub-contract';
import { HubIcon } from './components/HubIcon';
import { OpenZreadReader, WikiSourcePreview, type WikiReaderSession } from './components/OpenZreadReader';
import { markdownTreeOf, wikiListingOf, ProjectLibraryTree, type MarkdownTreeState, type WikiTreeState } from './components/ProjectLibraryTree';
import { MarkdownDirectoryTree } from './components/MarkdownDirectoryTree';
import { MarkdownDocumentRenderer } from './components/MarkdownDocumentRenderer';
import { resolveMarkdownLinkTarget } from './lib/markdown-links';
import { createHubApplicationService, type HubApplicationService } from './lib/application-service';
import {
  loadHubPreferences,
  markdownSessionKey,
  readerSessionKey,
  saveHubPreferences,
  type HubPreferences,
  type HubProjectSection,
  type HubView,
  type RecentWikiVisit,
} from './lib/hub-preferences';
import './app.css';

type Location = { view: HubView; projectId?: string; projectSection?: HubProjectSection };
type HealthState = { status: 'loading' } | { status: 'ready'; health: HubHealth } | { status: 'error'; message: string };
type ProjectsState = { status: 'loading' } | { status: 'ready'; projects: HubProject[] } | { status: 'error'; message: string };
type ReaderState = { status: 'closed' } | { status: 'loading'; project: HubProject; provider: HubWikiProvider; wikiId: string }
  | { status: 'ready'; project: HubProject; wiki: HubWikiDocument }
  | { status: 'error'; project: HubProject; provider: HubWikiProvider; wikiId: string; message: string };
type SearchState = { status: 'idle' } | { status: 'loading'; query: string }
  | { status: 'ready'; response: Awaited<ReturnType<HubApplicationService['searchWiki']>> }
  | { status: 'error'; message: string };
type MarkdownLocalSearchState = { status: 'idle' } | { status: 'loading'; projectId: string; query: string }
  | { status: 'ready'; response: HubProjectMarkdownSearchResponse }
  | { status: 'error'; projectId: string; query: string; message: string };
type MarkdownAskState = { status: 'idle' } | { status: 'loading'; projectId: string; path: string }
  | { status: 'ready'; response: HubMarkdownAnswerResponse }
  | { status: 'error'; projectId: string; path: string; message: string };
type SourceState = { status: 'closed' } | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; content: string } | { status: 'error'; path: string; message: string };
type MarkdownDocumentState = { status: 'closed' } | { status: 'loading'; projectId: string; path: string }
  | { status: 'ready'; projectId: string; path: string; document: HubMarkdownDocument }
  | { status: 'error'; projectId: string; path: string; message: string };
type MarkdownSourcePreviewState = { status: 'closed' } | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; content: string } | { status: 'error'; path: string; message: string };
type MarkdownOutlineHeading = { id: string; title: string; level: number };
type MarkdownDraft = { projectId: string; relativePath: string; baseRevision: string; baseContent: string; content: string };
type SearchTarget = { projectId: string; provider: HubWikiProvider; wikiId: string; slug: string; query: string };

const serviceDefault = createHubApplicationService();
const emptySession: WikiReaderSession = { scrollTop: 0 };
const navItems: Array<{ view: HubView; label: string; icon: 'home' | 'projects' | 'search' | 'tasks' | 'provider' | 'settings' }> = [
  { view: 'home', label: '首页', icon: 'home' },
  { view: 'projects', label: '项目库', icon: 'projects' },
  { view: 'search', label: '搜索', icon: 'search' },
  { view: 'tasks', label: '任务', icon: 'tasks' },
  { view: 'providers', label: 'Provider', icon: 'provider' },
  { view: 'settings', label: '设置', icon: 'settings' },
];
const projectSections: Array<{ id: HubProjectSection; label: string; icon: 'home' | 'book' | 'file' | 'code' | 'tasks' | 'settings' }> = [
  { id: 'overview', label: '概览', icon: 'home' },
  { id: 'wiki', label: 'Wiki', icon: 'book' },
  { id: 'markdown', label: 'Markdown', icon: 'file' },
  { id: 'source', label: '代码', icon: 'code' },
  { id: 'maintenance', label: '维护', icon: 'tasks' },
  { id: 'settings', label: '项目设置', icon: 'settings' },
];
const providerNames: Record<HubWikiProvider, string> = { open_zread: 'OpenZread', zread: 'Zread' };

function locationKey(location: Location): string {
  return `${location.view}:${location.projectId ?? ''}:${location.projectSection ?? ''}`;
}

function scrollToMarkdownSearchMatch(article: HTMLElement, query: string, matchLine?: number): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle || typeof article.querySelectorAll !== 'function') return false;
  const blocks = [...article.querySelectorAll<HTMLElement>('[data-markdown-source-start-line], p, li, pre, td, th, blockquote, h1, h2, h3, h4, h5, h6')];
  const matchingBlocks = blocks.filter((block) => block.textContent?.toLowerCase().includes(needle));
  const exactLineBlocks = matchLine === undefined ? [] : matchingBlocks.filter((block) => {
    const start = Number(block.dataset?.markdownSourceStartLine);
    const end = Number(block.dataset?.markdownSourceEndLine);
    return Number.isFinite(start) && Number.isFinite(end) && start <= matchLine && matchLine <= end;
  }).sort((left, right) => {
    const leftRange = Number(left.dataset?.markdownSourceEndLine) - Number(left.dataset?.markdownSourceStartLine);
    const rightRange = Number(right.dataset?.markdownSourceEndLine) - Number(right.dataset?.markdownSourceStartLine);
    return leftRange - rightRange;
  });
  const target = exactLineBlocks[0] ?? matchingBlocks[0];
  if (!target) return false;
  article.scrollTo({
    top: Math.max(0, article.scrollTop + target.getBoundingClientRect().top - article.getBoundingClientRect().top - 16),
    behavior: 'smooth',
  });
  return true;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '无法连接到 Hub 服务。';
}

function isWikiReadable(project: HubProject, provider: HubWikiProvider): boolean {
  const status = provider === 'open_zread' ? project.wiki.openZread : project.wiki.zread;
  return status === 'readable' || status === 'partial';
}

function collectMarkdownPaths(nodes: HubMarkdownNode[], directories: Set<string>, files: Set<string>) {
  for (const node of nodes) {
    if (node.kind === 'directory') {
      directories.add(node.relativePath);
      collectMarkdownPaths(node.children ?? [], directories, files);
    } else {
      files.add(node.relativePath);
    }
  }
}

function providerSummary(health: HubProviderHealth): string {
  if (health.generator.status === 'available') return '可用';
  if (health.generator.status === 'not_configured') return '未配置';
  return health.generator.status;
}

function ProjectMoreMenu({
  project,
  busy,
  openZreadReady,
  zreadReady,
  open,
  onOpenChange,
  onWiki,
  onTask,
  onAction,
}: {
  project: HubProject;
  busy: boolean;
  openZreadReady: boolean;
  zreadReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWiki: (provider: HubWikiProvider) => void;
  onTask: (action: 'generate-open' | 'sync-open' | 'generate-zread') => void;
  onAction: (action: 'folder' | 'terminal' | 'copy' | 'relocate' | 'remove') => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 420 });
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 230;
    const height = menuRef.current?.scrollHeight ?? 330;
    const maxHeight = Math.max(120, window.innerHeight - 16);
    const top = rect.bottom + height + 4 <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - Math.min(height, maxHeight) - 4);
    setPosition({
      top,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
      maxHeight,
    });
  }, []);
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof window === 'undefined') return;
    reposition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        triggerRef.current?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown'
          ? (current + 1) % items.length
          : (current <= 0 ? items.length - 1 : current - 1);
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [onOpenChange, open, reposition]);
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const menu = <div ref={menuRef} className="project-menu-content project-menu-portal" role="menu" tabIndex={-1} style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}>
    <button type="button" role="menuitem" data-testid={`open-open-zread-${project.id}`} disabled={!isWikiReadable(project, 'open_zread')} onClick={() => run(() => onWiki('open_zread'))}>打开 OpenZread Wiki</button>
    <button type="button" role="menuitem" data-testid={`open-zread-${project.id}`} disabled={!isWikiReadable(project, 'zread')} onClick={() => run(() => onWiki('zread'))}>打开 Zread Wiki</button>
    <hr />
    <button type="button" role="menuitem" data-testid={`generate-open-zread-${project.id}`} disabled={!openZreadReady || busy} onClick={() => run(() => onTask('generate-open'))}>生成 OpenZread</button>
    <button type="button" role="menuitem" data-testid={`sync-open-zread-${project.id}`} disabled={!openZreadReady || !isWikiReadable(project, 'open_zread') || busy} onClick={() => run(() => onTask('sync-open'))}>同步 OpenZread</button>
    <button type="button" role="menuitem" data-testid={`generate-zread-${project.id}`} disabled={!zreadReady || busy} onClick={() => run(() => onTask('generate-zread'))}>生成 Zread</button>
    <hr />
    <button type="button" role="menuitem" data-testid={`open-folder-${project.id}`} disabled={project.availability !== 'available' || busy} onClick={() => run(() => onAction('folder'))}>打开文件夹</button>
    <button type="button" role="menuitem" data-testid={`open-terminal-${project.id}`} disabled={project.availability !== 'available' || busy} onClick={() => run(() => onAction('terminal'))}>打开终端</button>
    <button type="button" role="menuitem" data-testid={`copy-path-${project.id}`} onClick={() => run(() => onAction('copy'))}>复制路径</button>
    <button type="button" role="menuitem" data-testid={`relocate-${project.id}`} disabled={busy} onClick={() => run(() => onAction('relocate'))}>重新定位</button>
    <button type="button" role="menuitem" className="is-danger" data-testid={`remove-${project.id}`} disabled={busy} onClick={() => run(() => onAction('remove'))}>从项目库移除…</button>
  </div>;
  return <>
    <button ref={triggerRef} type="button" className="project-more-trigger" aria-label={`${project.name} 更多操作`} aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}><HubIcon name="more" /></button>
    {open && (typeof document !== 'undefined' ? createPortal(menu, document.body) : menu)}
  </>;
}

function ProjectCard({
  project,
  busy,
  openZreadReady,
  zreadReady,
  onOpen,
  onFavorite,
  onRename,
  onWiki,
  onTask,
  onAction,
  menuOpen,
  onMenuOpenChange,
}: {
  project: HubProject;
  busy: boolean;
  openZreadReady: boolean;
  zreadReady: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onRename: (name: string) => Promise<void>;
  onWiki: (provider: HubWikiProvider) => void;
  onTask: (action: 'generate-open' | 'sync-open' | 'generate-zread') => void;
  onAction: (action: 'folder' | 'terminal' | 'copy' | 'relocate' | 'remove') => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const providerStatus = (status: string) => status === 'readable' ? '可读' : status === 'partial' ? '部分可读' : status === 'missing' ? '未生成' : '不可用';
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { if (!editingName) setNameDraft(project.name); }, [editingName, project.name]);
  const saveName = async () => {
    setRenaming(true);
    setRenameError('');
    try {
      await onRename(nameDraft);
      setEditingName(false);
    } catch (error) {
      setRenameError(messageOf(error));
    } finally {
      setRenaming(false);
    }
  };
  return (
    <article className="project-card" data-testid={`project-${project.id}`}>
      <div className="project-card-heading">
        <div className="project-card-title">
          <span className="project-symbol"><HubIcon name="code" /></span>
          <div className="project-card-name-block">{editingName ? <><input aria-label="项目显示名称" autoFocus value={nameDraft} maxLength={120} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveName(); if (event.key === 'Escape') setEditingName(false); }} /><div className="project-rename-actions"><button type="button" disabled={renaming} onClick={() => void saveName()}>保存</button><button type="button" disabled={renaming} onClick={() => setEditingName(false)}>取消</button></div>{renameError && <small className="project-rename-error" role="alert">{renameError}</small>}</> : <button type="button" className="project-name-button" title="点击重命名" onClick={() => { setNameDraft(project.name); setEditingName(true); }}><h3>{project.name}</h3></button>}<p className="project-kind">{project.sourceControl === 'git' ? 'Git 项目' : '本地项目'}</p><p className="project-added-at">添加日期：{project.addedAt ? new Date(Number(project.addedAt)).toLocaleDateString() : '未知'}</p></div>
        </div>
        <button type="button" className={`favorite-button${project.favorite ? ' is-favorite' : ''}`} data-testid={`favorite-${project.id}`} aria-label={project.favorite ? `取消收藏 ${project.name}` : `收藏 ${project.name}`} aria-pressed={project.favorite} disabled={busy} onClick={onFavorite}>
          <HubIcon name="star" />
        </button>
      </div>
      <p className="project-path" title={project.path}>{project.path}</p>
      {project.availabilityReason && <p className="project-reason">{project.availabilityReason}</p>}
      <div className="project-provider-status" aria-label="Wiki Provider 状态">
        <span className={`provider-pill${isWikiReadable(project, 'open_zread') ? ' is-available' : ''}`}><i />OpenZread · {providerStatus(project.wiki.openZread)}</span>
        <span className={`provider-pill${isWikiReadable(project, 'zread') ? ' is-available' : ''}`}><i />Zread · {providerStatus(project.wiki.zread)}</span>
      </div>
      <div className="project-card-footer">
        <span className={`availability-badge availability-${project.availability}`}>{project.availability === 'available' ? '可用' : project.availability === 'missing' ? '路径缺失' : '不可访问'}</span>
        <button type="button" className="primary-button" disabled={project.availability !== 'available'} onClick={onOpen}>打开项目</button>
        <ProjectMoreMenu project={project} busy={busy} openZreadReady={openZreadReady} zreadReady={zreadReady} open={menuOpen} onOpenChange={onMenuOpenChange} onWiki={onWiki} onTask={onTask} onAction={onAction} />
      </div>
    </article>
  );
}

export function HubApplication({ service = serviceDefault }: { service?: HubApplicationService }) {
  const [preferences, setPreferences] = useState<HubPreferences>(() => loadHubPreferences());
  const [location, setLocation] = useState<Location>(() => ({
    view: preferences.view === 'project' && !preferences.projectId ? 'home' : preferences.view,
    projectId: preferences.projectId,
    projectSection: preferences.projectSection ?? 'overview',
  }));
  const [stack, setStack] = useState<Location[]>([]);
  const [collapsed, setCollapsed] = useState(preferences.sidebarCollapsed);
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [projects, setProjects] = useState<ProjectsState>({ status: 'loading' });
  const [wikiTreeStates, setWikiTreeStates] = useState<Record<string, WikiTreeState>>({});
  const [markdownTreeStates, setMarkdownTreeStates] = useState<Record<string, MarkdownTreeState>>({});
  const [busyAction, setBusyAction] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [markdownLocalSearchQuery, setMarkdownLocalSearchQuery] = useState('');
  const [markdownLocalSearch, setMarkdownLocalSearch] = useState<MarkdownLocalSearchState>({ status: 'idle' });
  const [markdownSearchMessage, setMarkdownSearchMessage] = useState<string | null>(null);
  const [markdownAskQuestion, setMarkdownAskQuestion] = useState('');
  const [markdownAskSelectedText, setMarkdownAskSelectedText] = useState('');
  const [markdownAskState, setMarkdownAskState] = useState<MarkdownAskState>({ status: 'idle' });
  const [reader, setReader] = useState<ReaderState>({ status: 'closed' });
  const [wikiToolbarHost, setWikiToolbarHost] = useState<HTMLDivElement | null>(null);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [readerSessions, setReaderSessions] = useState<Record<string, WikiReaderSession>>(() => preferences.readerSessions);
  const [source, setSource] = useState<SourceState>({ status: 'closed' });
  const [markdownDocument, setMarkdownDocument] = useState<MarkdownDocumentState>({ status: 'closed' });
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, MarkdownDraft>>({});
  const [markdownRemoteDocument, setMarkdownRemoteDocument] = useState<HubMarkdownDocument | null>(null);
  const [markdownEditorOpen, setMarkdownEditorOpen] = useState(false);
  const [markdownPreviewOpen, setMarkdownPreviewOpen] = useState(false);
  const [markdownSaveBusy, setMarkdownSaveBusy] = useState(false);
  const [markdownSaveError, setMarkdownSaveError] = useState<string | null>(null);
  const [markdownSaveMessage, setMarkdownSaveMessage] = useState<string | null>(null);
  const [markdownLeavePromptOpen, setMarkdownLeavePromptOpen] = useState(false);
  const [markdownSourcePreview, setMarkdownSourcePreview] = useState<MarkdownSourcePreviewState>({ status: 'closed' });
  const [markdownLinkMessage, setMarkdownLinkMessage] = useState<string | null>(null);
  const [pendingMarkdownAnchor, setPendingMarkdownAnchor] = useState<{ projectId: string; path: string; fragment: string } | null>(null);
  const [pendingMarkdownSearchHit, setPendingMarkdownSearchHit] = useState<{ projectId: string; path: string; query: string; matchLine?: number } | null>(null);
  const [markdownTreeOpen, setMarkdownTreeOpen] = useState(true);
  const [markdownTreeWidth, setMarkdownTreeWidth] = useState(250);
  const [markdownInspectorOpen, setMarkdownInspectorOpen] = useState(true);
  const [markdownInspectorWidth, setMarkdownInspectorWidth] = useState(280);
  const [markdownInspectorTab, setMarkdownInspectorTab] = useState<'outline' | 'ask'>('outline');
  const [markdownOutline, setMarkdownOutline] = useState<MarkdownOutlineHeading[]>([]);
  const [activeMarkdownHeading, setActiveMarkdownHeading] = useState('');
  const [hoveredMarkdownHeading, setHoveredMarkdownHeading] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<HubTask | null>(null);
  const [queuedTasks, setQueuedTasks] = useState<HubTask[]>([]);
  const [activeEvent, setActiveEvent] = useState<HubTaskEvent | null>(null);
  const [lastEvent, setLastEvent] = useState<HubTaskEvent | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [taskClock, setTaskClock] = useState(Date.now());
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [configuringZread, setConfiguringZread] = useState(false);
  const mounted = useRef(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const projectTreeToggleRef = useRef<HTMLButtonElement>(null);
  const readerLeaveGuard = useRef<((destination: string) => boolean) | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const markdownLayoutRef = useRef<HTMLDivElement | null>(null);
  const markdownTreeResizePointer = useRef<number | null>(null);
  const markdownInspectorResizePointer = useRef<number | null>(null);
  const markdownArticleRef = useRef<HTMLElement | null>(null);
  const markdownPendingLeaveRef = useRef<(() => void) | null>(null);
  const openMarkdownFileRef = useRef<(project: HubProject, relativePath: string, searchQuery?: string, matchLine?: number) => void>(() => undefined);
  const goBackRef = useRef<() => void>(() => undefined);
  const markdownSkipLeaveGuardOnce = useRef(false);
  const markdownScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markdownSourceGeneration = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);

  const registerReaderLeaveGuard = useCallback((guard: (destination: string) => boolean) => {
    readerLeaveGuard.current = guard;
    return () => { if (readerLeaveGuard.current === guard) readerLeaveGuard.current = null; };
  }, []);

  const activeMarkdownPath = location.view === 'project' && location.projectSection === 'markdown' && location.projectId
    ? preferences.markdownRecentFiles[location.projectId]
    : undefined;
  const activeMarkdownDraftKey = location.projectId && activeMarkdownPath
    ? markdownSessionKey(location.projectId, activeMarkdownPath)
    : null;
  const activeMarkdownDraft = activeMarkdownDraftKey ? markdownDrafts[activeMarkdownDraftKey] : undefined;
  const activeMarkdownDraftDirty = Boolean(activeMarkdownDraft && activeMarkdownDraft.content !== activeMarkdownDraft.baseContent);

  const requestMarkdownLeave = useCallback((continuation: () => void) => {
    if (markdownSkipLeaveGuardOnce.current) {
      markdownSkipLeaveGuardOnce.current = false;
      return false;
    }
    if (!activeMarkdownDraftDirty) return false;
    markdownPendingLeaveRef.current = continuation;
    setMarkdownLeavePromptOpen(true);
    return true;
  }, [activeMarkdownDraftDirty]);

  const navigate = useCallback((next: Location, push = true) => {
    const staysInMarkdownWorkspace = next.view === 'project'
      && next.projectId === location.projectId
      && next.projectSection === 'markdown';
    if (!staysInMarkdownWorkspace && activeMarkdownDraftDirty
      && requestMarkdownLeave(() => navigate(next, push))) return false;
    if (location.view === next.view && location.projectId === next.projectId && location.projectSection === next.projectSection) return true;
    if (readerLeaveGuard.current && !readerLeaveGuard.current('changing views')) return false;
    if (push) {
      setStack((items) => [...items, location].slice(-40));
      if (typeof globalThis.window !== 'undefined') scrollPositions.current.set(locationKey(location), globalThis.window.scrollY);
    }
    setLocation(next);
    setPreferences((current) => ({ ...current, view: next.view, projectId: next.projectId, projectSection: next.projectSection }));
    return true;
  }, [activeMarkdownDraftDirty, location, requestMarkdownLeave]);

  const goBack = useCallback(() => {
    if (activeMarkdownDraftDirty && requestMarkdownLeave(() => goBackRef.current())) return;
    if (readerLeaveGuard.current && !readerLeaveGuard.current('going back')) return;
    const previous = stack.at(-1);
    if (!previous) {
      navigate(location.view === 'project'
        ? { view: 'project', projectId: location.projectId, projectSection: 'overview' }
        : { view: 'home' }, false);
      return;
    }
    if (typeof globalThis.window !== 'undefined') scrollPositions.current.set(locationKey(location), globalThis.window.scrollY);
    pendingScrollRestore.current = scrollPositions.current.get(locationKey(previous)) ?? 0;
    setStack((items) => items.slice(0, -1));
    setLocation(previous);
    setPreferences((current) => ({ ...current, view: previous.view, projectId: previous.projectId, projectSection: previous.projectSection }));
  }, [activeMarkdownDraftDirty, location, navigate, requestMarkdownLeave, stack]);
  goBackRef.current = goBack;

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') return;
    const position = pendingScrollRestore.current ?? scrollPositions.current.get(locationKey(location)) ?? 0;
    pendingScrollRestore.current = null;
    const frame = globalThis.requestAnimationFrame(() => globalThis.window.scrollTo(0, position));
    return () => globalThis.cancelAnimationFrame(frame);
  }, [location]);

  const loadProjects = useCallback(async () => {
    setProjects({ status: 'loading' });
    try {
      const result = await service.listProjects();
      if (mounted.current) setProjects({ status: 'ready', projects: result });
    } catch (error) {
      if (mounted.current) setProjects({ status: 'error', message: messageOf(error) });
    }
  }, [service]);

  const loadProjectWikis = useCallback(async (project: HubProject, refresh = false) => {
    const existing = wikiTreeStates[project.id];
    if (!refresh && (existing?.status === 'loading' || existing?.status === 'ready')) return;
    const previous = wikiListingOf(existing);
    setWikiTreeStates((current) => ({ ...current, [project.id]: { status: 'loading', ...(previous ? { previous } : {}) } }));
    try {
      const listing = await service.listProjectWikis(project.id);
      if (mounted.current) setWikiTreeStates((current) => ({ ...current, [project.id]: { status: 'ready', listing } }));
    } catch (error) {
      if (mounted.current) setWikiTreeStates((current) => ({
        ...current,
        [project.id]: { status: 'error', message: messageOf(error), ...(previous ? { previous } : {}) },
      }));
    }
  }, [service, wikiTreeStates]);

  const markdownReadGeneration = useRef(0);
  const loadMarkdownDocument = useCallback(async (project: HubProject, relativePath: string) => {
    const generation = ++markdownReadGeneration.current;
    setMarkdownDocument({ status: 'loading', projectId: project.id, path: relativePath });
    try {
      const document = await service.readProjectMarkdown(project.id, relativePath);
      if (mounted.current && generation === markdownReadGeneration.current) {
        setMarkdownDocument({ status: 'ready', projectId: project.id, path: relativePath, document });
      }
    } catch (error) {
      if (mounted.current && generation === markdownReadGeneration.current) {
        setMarkdownDocument({ status: 'error', projectId: project.id, path: relativePath, message: messageOf(error) });
      }
    }
  }, [service]);

  const readMarkdownAsset = useCallback((projectId: string, documentPath: string, assetPath: string) => (
    service.readProjectMarkdownAsset(projectId, documentPath, assetPath)
  ), [service]);

  const loadProjectMarkdown = useCallback(async (project: HubProject, refresh = false) => {
    const existing = markdownTreeStates[project.id];
    if (!refresh && (existing?.status === 'loading' || existing?.status === 'ready')) return;
    const previous = existing?.status === 'ready' ? existing.tree : existing?.previous;
    setMarkdownTreeStates((current) => ({
      ...current,
      [project.id]: { status: 'loading', ...(previous ? { previous } : {}) },
    }));
    try {
      const tree = await service.listProjectMarkdown(project.id);
      if (!mounted.current) return;
      setMarkdownTreeStates((current) => ({ ...current, [project.id]: { status: 'ready', tree } }));
      const directories = new Set<string>();
      const files = new Set<string>();
      collectMarkdownPaths(tree.roots, directories, files);
      setPreferences((current) => ({
        ...current,
        expandedMarkdownPaths: {
          ...current.expandedMarkdownPaths,
          [project.id]: (current.expandedMarkdownPaths[project.id] ?? []).filter((path) => directories.has(path)),
        },
      }));
      const selectedPath = preferences.markdownRecentFiles[project.id];
      if (selectedPath && refresh) {
        if (files.has(selectedPath)) void loadMarkdownDocument(project, selectedPath);
        else setMarkdownDocument({ status: 'error', projectId: project.id, path: selectedPath, message: '当前 Markdown 文件已移动或删除；请从更新后的目录中重新选择。' });
      }
    } catch (error) {
      if (mounted.current) setMarkdownTreeStates((current) => ({
        ...current,
        [project.id]: { status: 'error', message: messageOf(error), ...(previous ? { previous } : {}) },
      }));
    }
  }, [loadMarkdownDocument, markdownTreeStates, preferences.markdownRecentFiles, service]);

  const toggleProjectTree = useCallback((project: HubProject) => {
    const expanded = preferences.expandedProjectIds.includes(project.id);
    setPreferences((current) => ({
      ...current,
      expandedProjectIds: expanded
        ? current.expandedProjectIds.filter((id) => id !== project.id)
        : [...current.expandedProjectIds, project.id],
    }));
    if (!expanded) {
      void loadProjectWikis(project);
      void loadProjectMarkdown(project);
    }
  }, [loadProjectMarkdown, loadProjectWikis, preferences.expandedProjectIds]);

  const refreshProjectWikis = useCallback((project: HubProject) => {
    void loadProjectWikis(project, true);
  }, [loadProjectWikis]);

  const locateProjectWikiInstances = useCallback(async (project: HubProject) => {
    const previous = wikiListingOf(wikiTreeStates[project.id]);
    setWikiTreeStates((current) => ({
      ...current,
      [project.id]: { status: 'loading', ...(previous ? { previous } : {}) },
    }));
    try {
      const directory = await service.selectProjectDirectory();
      if (!directory) {
        setWikiTreeStates((current) => {
          const next = { ...current };
          if (previous) next[project.id] = { status: 'ready', listing: previous };
          else return Object.fromEntries(Object.entries(next).filter(([projectId]) => projectId !== project.id));
          return next;
        });
        return;
      }
      const located = await service.locateProjectWikis(project.id, directory);
      if (!mounted.current) return;
      const mergedById = new Map((previous?.instances ?? []).map((instance) => [instance.wikiId, instance]));
      for (const instance of located.instances) mergedById.set(instance.wikiId, instance);
      const warnings = [...new Set([previous?.warning, located.warning].filter((warning): warning is string => Boolean(warning)))];
      const listing = {
        ...located,
        instances: [...mergedById.values()].sort((left, right) => left.sourceRoot.localeCompare(right.sourceRoot) || left.provider.localeCompare(right.provider)),
        scanComplete: (previous?.scanComplete ?? true) && located.scanComplete,
        scannedDirectories: (previous?.scannedDirectories ?? 0) + located.scannedDirectories,
        ...(warnings.length ? { warning: warnings.join(' ') } : {}),
      };
      setWikiTreeStates((current) => ({ ...current, [project.id]: { status: 'ready', listing } }));
      setProjectMessage(located.instances.length
        ? `在所选目录中定位到 ${located.instances.length} 个 Wiki 实例。`
        : '所选目录及其子目录中没有发现 Wiki。');
    } catch (error) {
      if (mounted.current) setWikiTreeStates((current) => ({
        ...current,
        [project.id]: { status: 'error', message: messageOf(error), ...(previous ? { previous } : {}) },
      }));
    }
  }, [service, wikiTreeStates]);

  const refreshProjectMarkdown = useCallback((project: HubProject) => {
    void loadProjectMarkdown(project, true);
  }, [loadProjectMarkdown]);

  const toggleMarkdownPath = useCallback((projectId: string, relativePath: string) => {
    setPreferences((current) => {
      const currentPaths = current.expandedMarkdownPaths[projectId] ?? [];
      const nextPaths = currentPaths.includes(relativePath)
        ? currentPaths.filter((path) => path !== relativePath)
        : [...currentPaths, relativePath];
      return { ...current, expandedMarkdownPaths: { ...current.expandedMarkdownPaths, [projectId]: nextPaths } };
    });
  }, []);

  const openMarkdownFile = useCallback((project: HubProject, relativePath: string, searchQuery?: string, matchLine?: number) => {
    const currentPath = location.projectId ? preferences.markdownRecentFiles[location.projectId] : undefined;
    const changingFileInsideMarkdown = location.view === 'project'
      && location.projectSection === 'markdown'
      && location.projectId === project.id
      && currentPath !== relativePath;
    if (changingFileInsideMarkdown && activeMarkdownDraftDirty
      && requestMarkdownLeave(() => openMarkdownFileRef.current(project, relativePath, searchQuery, matchLine))) return;
    if (!navigate({ view: 'project', projectId: project.id, projectSection: 'markdown' })) return;
    setPendingMarkdownSearchHit(searchQuery ? { projectId: project.id, path: relativePath, query: searchQuery, ...(matchLine ? { matchLine } : {}) } : null);
    setPreferences((current) => ({
      ...current,
      markdownRecentFiles: { ...current.markdownRecentFiles, [project.id]: relativePath },
      recentProjectIds: [project.id, ...current.recentProjectIds.filter((id) => id !== project.id)].slice(0, 20),
    }));
  }, [activeMarkdownDraftDirty, location, navigate, preferences.markdownRecentFiles, requestMarkdownLeave]);
  openMarkdownFileRef.current = openMarkdownFile;

  const jumpToMarkdownHeading = useCallback((fragment: string) => {
    const article = markdownArticleRef.current;
    if (!article) return false;
    const heading = [...article.querySelectorAll<HTMLElement>('[data-markdown-heading="true"]')]
      .find((candidate) => candidate.id === fragment);
    if (!heading) return false;
    article.scrollTo({
      top: Math.max(0, article.scrollTop + heading.getBoundingClientRect().top - article.getBoundingClientRect().top - 16),
      behavior: 'smooth',
    });
    return true;
  }, []);

  const openMarkdownRelativeLink = useCallback((project: HubProject, documentPath: string, href: string) => {
    const target = resolveMarkdownLinkTarget(documentPath, href);
    if (!target) {
      setMarkdownLinkMessage('链接路径无效，或目标位于项目目录之外。');
      return;
    }
    setMarkdownLinkMessage(null);
    if (/\.(?:md|markdown)$/i.test(target.path)) {
      if (target.fragment) {
        const alreadyOpen = markdownDocument.status === 'ready'
          && markdownDocument.projectId === project.id && markdownDocument.path === target.path;
        if (alreadyOpen && jumpToMarkdownHeading(target.fragment)) return;
        setPendingMarkdownAnchor({ projectId: project.id, path: target.path, fragment: target.fragment });
      } else {
        setPendingMarkdownAnchor(null);
      }
      setMarkdownSourcePreview({ status: 'closed' });
      openMarkdownFile(project, target.path);
      return;
    }

    const generation = ++markdownSourceGeneration.current;
    setMarkdownSourcePreview({ status: 'loading', path: target.path });
    void service.readProjectMarkdownSource(project.id, documentPath, target.path).then((sourceFile) => {
      if (mounted.current && generation === markdownSourceGeneration.current) {
        setMarkdownSourcePreview({ status: 'ready', path: sourceFile.path, content: sourceFile.content });
      }
    }).catch((error: unknown) => {
      if (mounted.current && generation === markdownSourceGeneration.current) {
        setMarkdownSourcePreview({ status: 'error', path: target.path, message: messageOf(error) });
      }
    });
  }, [jumpToMarkdownHeading, markdownDocument, openMarkdownFile, service]);

  const openExternalMarkdownLink = useCallback(async (href: string) => {
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
      setMarkdownLinkMessage('仅支持在系统浏览器中打开 HTTP(S) 或邮件链接。');
      return;
    }
    try {
      await openUrl(href);
      setMarkdownLinkMessage(null);
    } catch (error) {
      setMarkdownLinkMessage(`无法打开外部链接：${messageOf(error)}`);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealth({ status: 'loading' });
    try {
      const result = await service.getHealth();
      if (mounted.current) setHealth({ status: 'ready', health: result });
    } catch (error) {
      if (mounted.current) setHealth({ status: 'error', message: messageOf(error) });
    }
  }, [service]);

  useEffect(() => {
    mounted.current = true;
    void loadHealth();
    void loadProjects();
    let stop: (() => void) | undefined;
    let disposed = false;
    void service.subscribeToTaskEvents((event) => {
      if (disposed) return;
      setLastEvent(event);
      if (event.taskId !== 'health-check') setActiveEvent(event);
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; }).catch(() => undefined);
    return () => { disposed = true; mounted.current = false; stop?.(); };
  }, [loadHealth, loadProjects, service]);

  useEffect(() => {
    if (projects.status !== 'ready' || !preferences.projectTreeExpanded) return;
    for (const projectId of preferences.expandedProjectIds) {
      const project = projects.projects.find((item) => item.id === projectId);
      if (project) {
        void loadProjectWikis(project);
        void loadProjectMarkdown(project);
      }
    }
  }, [loadProjectMarkdown, loadProjectWikis, preferences.expandedProjectIds, preferences.projectTreeExpanded, projects]);

  useEffect(() => {
    if (location.view !== 'project' || location.projectSection !== 'markdown' || projects.status !== 'ready') return;
    const project = projects.projects.find((item) => item.id === location.projectId);
    const selectedPath = preferences.markdownRecentFiles[location.projectId ?? ''];
    if (!project || !selectedPath) return;
    const matchesCurrent = markdownDocument.status !== 'closed'
      && markdownDocument.projectId === project.id && markdownDocument.path === selectedPath;
    if (!matchesCurrent) void loadMarkdownDocument(project, selectedPath);
  }, [location, markdownDocument, loadMarkdownDocument, preferences.markdownRecentFiles, projects]);

  useEffect(() => {
    if (!pendingMarkdownAnchor || location.view !== 'project' || location.projectSection !== 'markdown'
      || location.projectId !== pendingMarkdownAnchor.projectId || markdownDocument.status !== 'ready'
      || markdownDocument.projectId !== pendingMarkdownAnchor.projectId || markdownDocument.path !== pendingMarkdownAnchor.path) return;
    const timer = globalThis.setTimeout(() => {
      if (!jumpToMarkdownHeading(pendingMarkdownAnchor.fragment)) {
        setMarkdownLinkMessage(`未找到标题锚点：#${pendingMarkdownAnchor.fragment}`);
      }
      setPendingMarkdownAnchor(null);
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [jumpToMarkdownHeading, location, markdownDocument, pendingMarkdownAnchor]);

  useEffect(() => {
    if (location.view !== 'project' || location.projectSection !== 'markdown'
      || markdownDocument.status !== 'ready' || markdownDocument.projectId !== location.projectId
      || markdownDocument.path !== preferences.markdownRecentFiles[location.projectId ?? '']) return;
    const article = markdownArticleRef.current;
    if (!article) return;
    const key = markdownSessionKey(markdownDocument.projectId, markdownDocument.path);
    const scrollTop = preferences.markdownScrollPositions[key] ?? 0;
    const timer = globalThis.setTimeout(() => { article.scrollTop = scrollTop; }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [location, markdownDocument, preferences.markdownRecentFiles, preferences.markdownScrollPositions]);

  useEffect(() => {
    if (!pendingMarkdownSearchHit || location.view !== 'project' || location.projectSection !== 'markdown'
      || location.projectId !== pendingMarkdownSearchHit.projectId || markdownDocument.status !== 'ready'
      || markdownDocument.projectId !== pendingMarkdownSearchHit.projectId
      || markdownDocument.path !== pendingMarkdownSearchHit.path) return;
    const timer = globalThis.setTimeout(() => {
      const article = markdownArticleRef.current;
      if (!article || !scrollToMarkdownSearchMatch(article, pendingMarkdownSearchHit.query, pendingMarkdownSearchHit.matchLine)) {
        setMarkdownSearchMessage(`已打开 ${pendingMarkdownSearchHit.path}，但未能定位搜索词“${pendingMarkdownSearchHit.query}”。`);
      }
      setPendingMarkdownSearchHit(null);
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [location, markdownDocument, pendingMarkdownSearchHit]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => saveHubPreferences({ ...preferences, sidebarCollapsed: collapsed }), 120);
    return () => globalThis.clearTimeout(timer);
  }, [preferences, collapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    globalThis.addEventListener('keydown', handleShortcut);
    return () => globalThis.removeEventListener('keydown', handleShortcut);
  }, []);

  const readyProjects = projects.status === 'ready' ? projects.projects : [];
  const currentProject = readyProjects.find((project) => project.id === location.projectId);
  useEffect(() => {
    if (projects.status !== 'ready' || location.view !== 'project') return;
    if (!projects.projects.some((project) => project.id === location.projectId)) {
      navigate({ view: 'projects' }, false);
      setProjectMessage('该项目已不在项目库中。');
      setReader({ status: 'closed' });
      const stalePrefix = `${location.projectId}:`;
      setReaderSessions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(stalePrefix))));
      setPreferences((current) => ({
        ...current,
        recentProjectIds: current.recentProjectIds.filter((id) => id !== location.projectId),
        recentWikiVisits: current.recentWikiVisits.filter((visit) => visit.projectId !== location.projectId),
        readerSessions: Object.fromEntries(Object.entries(current.readerSessions).filter(([key]) => !key.startsWith(stalePrefix))),
      }));
    }
  }, [location, navigate, projects]);

  const openProject = useCallback((project: HubProject, section: HubProjectSection = 'overview') => {
    setPreferences((current) => ({
      ...current,
      recentProjectIds: [project.id, ...current.recentProjectIds.filter((id) => id !== project.id)].slice(0, 20),
    }));
    void loadProjectWikis(project);
    void loadProjectMarkdown(project);
    navigate({ view: 'project', projectId: project.id, projectSection: section });
  }, [loadProjectMarkdown, loadProjectWikis, navigate]);

  const rememberVisit = useCallback((projectId: string, provider: HubWikiProvider, wikiId: string, sourceRoot: string, slug: string, title: string) => {
    const visit: RecentWikiVisit = { projectId, provider, wikiId, sourceRoot, slug, title, visitedAt: Date.now() };
    setPreferences((current) => ({
      ...current,
      recentWikiVisits: [visit, ...current.recentWikiVisits.filter((item) => !(item.projectId === projectId && item.wikiId === wikiId && item.slug === slug))].slice(0, 20),
    }));
  }, []);

  const openWiki = useCallback(async (project: HubProject, provider: HubWikiProvider, targetSlug?: string, highlightText?: string, wikiId = `${provider}@.`) => {
    void loadProjectWikis(project);
    openProject(project, 'wiki');
    setSource({ status: 'closed' });
    setSearchTarget(targetSlug && highlightText ? { projectId: project.id, provider, wikiId, slug: targetSlug, query: highlightText } : null);
    setReader({ status: 'loading', project, provider, wikiId });
    try {
      const wiki = provider === 'zread'
        ? await service.readZreadWiki(project.id, wikiId)
        : await service.readOpenZreadWiki(project.id, wikiId);
      if (!mounted.current) return;
      setReader({ status: 'ready', project, wiki });
      const slug = targetSlug && wiki.pages.some((page) => page.slug === targetSlug && page.status === 'readable')
        ? targetSlug : undefined;
      if (slug) {
        const key = readerSessionKey(project.id, wiki.wikiId);
        setReaderSessions((current) => ({ ...current, [key]: { ...(current[key] ?? emptySession), selectedSlug: slug, scrollTop: 0 } }));
        rememberVisit(project.id, provider, wiki.wikiId, wiki.sourceRoot, slug, wiki.pages.find((page) => page.slug === slug)?.title ?? slug);
      }
    } catch (error) {
      if (mounted.current) setReader({ status: 'error', project, provider, wikiId, message: messageOf(error) });
    }
  }, [loadProjectWikis, openProject, rememberVisit, service]);

  useEffect(() => {
    if (projects.status !== 'ready' || location.view !== 'project' || location.projectSection !== 'wiki' || reader.status !== 'closed') return;
    const project = projects.projects.find((item) => item.id === location.projectId);
    if (!project) return;
    const previous = preferences.recentWikiVisits.find((visit) => visit.projectId === project.id);
    const provider = previous?.provider ?? 'open_zread';
    const wikiId = previous?.wikiId ?? `${provider}@.`;
    const session = preferences.readerSessions[readerSessionKey(project.id, wikiId)];
    void openWiki(project, provider, session?.selectedSlug, undefined, wikiId);
  }, [location, openWiki, preferences, projects, reader.status]);

  const updateReaderSession = useCallback((projectId: string, provider: HubWikiProvider, wikiId: string, sourceRoot: string, session: WikiReaderSession) => {
    const key = readerSessionKey(projectId, wikiId);
    setReaderSessions((current) => ({ ...current, [key]: session }));
    setPreferences((current) => {
      let recentWikiVisits = current.recentWikiVisits;
      if (session.selectedSlug) {
        const existing = recentWikiVisits.find((visit) => visit.projectId === projectId && visit.wikiId === wikiId && visit.slug === session.selectedSlug);
        const title = reader.status === 'ready'
          ? reader.wiki.pages.find((page) => page.slug === session.selectedSlug)?.title ?? session.selectedSlug
          : existing?.title ?? session.selectedSlug;
        recentWikiVisits = [{ projectId, provider, wikiId, sourceRoot, slug: session.selectedSlug, title, visitedAt: Date.now() },
          ...recentWikiVisits.filter((visit) => !(visit.projectId === projectId && visit.wikiId === wikiId && visit.slug === session.selectedSlug))].slice(0, 20);
      }
      return { ...current, readerSessions: { ...current.readerSessions, [key]: session }, recentWikiVisits };
    });
  }, [reader]);

  const readProjectSource = useCallback(async (project: HubProject, provider: HubWikiProvider, path: string, wikiId = `${provider}@.`) => {
    navigate({ view: 'project', projectId: project.id, projectSection: 'source' });
    setSource({ status: 'loading', path });
    try {
      const result = provider === 'zread'
        ? await service.readZreadSource(project.id, path, wikiId)
        : await service.readOpenZreadSource(project.id, path, wikiId);
      if (mounted.current) setSource({ status: 'ready', path: result.path, content: result.content });
    } catch (error) {
      if (mounted.current) setSource({ status: 'error', path, message: messageOf(error) });
    }
  }, [navigate, service]);

  const search = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!navigate({ view: 'search' })) return;
    setMarkdownSearchMessage(null);
    setSearchState({ status: 'loading', query });
    try {
      const response = await service.searchWiki(query);
      if (mounted.current) setSearchState({ status: 'ready', response });
    } catch (error) {
      if (mounted.current) setSearchState({ status: 'error', message: messageOf(error) });
    }
  }, [navigate, searchQuery, service]);

  const searchMarkdownInProject = useCallback(async (project: HubProject, query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setMarkdownLocalSearch({ status: 'idle' });
      return;
    }
    setMarkdownLocalSearch({ status: 'loading', projectId: project.id, query: normalizedQuery });
    setMarkdownSearchMessage(null);
    try {
      const response = await service.searchProjectMarkdown(project.id, normalizedQuery);
      if (mounted.current) setMarkdownLocalSearch({ status: 'ready', response });
    } catch (error) {
      if (mounted.current) setMarkdownLocalSearch({ status: 'error', projectId: project.id, query: normalizedQuery, message: messageOf(error) });
    }
  }, [service]);

  const openMarkdownSearchResult = useCallback(async (
    project: HubProject,
    result: HubMarkdownSearchResult,
    query: string,
  ) => {
    setMarkdownSearchMessage(null);
    try {
      const document = await service.readProjectMarkdown(project.id, result.path);
      if (!mounted.current) return;
      if (document.projectId !== project.id || document.relativePath !== result.path) {
        setMarkdownSearchMessage(`搜索结果已过期：“${result.path}”解析到的文件身份已改变。已刷新目录，请重新搜索。`);
        refreshProjectMarkdown(project);
        return;
      }
      const searchableText = result.matchKind === 'content'
        ? document.content
        : `${document.relativePath}\n${document.title}`;
      if (!searchableText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) {
        setMarkdownSearchMessage(`搜索结果已过期：“${result.path}”中的命中内容已改变。已刷新目录，请重新搜索。`);
        refreshProjectMarkdown(project);
        return;
      }
      openMarkdownFile(project, result.path, result.matchKind === 'content' ? query : undefined, result.matchLine);
    } catch (error) {
      const message = `搜索命中的文件已移动、删除或不可读：${messageOf(error)} 请刷新 Markdown 目录后重试。`;
      if (mounted.current) {
        setMarkdownSearchMessage(message);
        refreshProjectMarkdown(project);
      }
    }
  }, [openMarkdownFile, refreshProjectMarkdown, service]);


  const updateProject = useCallback((updated: HubProject) => setProjects((current) => current.status === 'ready'
    ? { status: 'ready', projects: current.projects.map((project) => project.id === updated.id ? updated : project) }
    : current), []);

  const renameProject = useCallback(async (project: HubProject, name: string) => {
    const updated = await service.renameProject(project.id, name);
    updateProject(updated);
  }, [service, updateProject]);

  const projectAction = useCallback(async (project: HubProject, action: 'favorite' | 'folder' | 'terminal' | 'copy' | 'relocate' | 'remove') => {
    if (action === 'remove' && !globalThis.confirm(`从项目库移除“${project.name}”？本地源代码和 Wiki 文件不会被删除。`)) return;
    setBusyAction(true);
    setProjectMessage(null);
    try {
      if (action === 'favorite') {
        const updated = await service.setProjectFavorite(project.id, !project.favorite);
        updateProject(updated);
      } else if (action === 'folder') updateProject(await service.openProjectFolder(project.id));
      else if (action === 'terminal') updateProject(await service.openProjectTerminal(project.id));
      else if (action === 'copy') { await service.copyProjectPath(project.path); setProjectMessage('项目路径已复制。'); }
      else if (action === 'relocate') {
        const path = await service.selectProjectDirectory();
        if (path) updateProject(await service.relocateProject(project.id, path));
      } else {
        await service.removeProject(project.id);
        setProjects((current) => current.status === 'ready' ? { status: 'ready', projects: current.projects.filter((item) => item.id !== project.id) } : current);
        const stalePrefix = `${project.id}:`;
        setReaderSessions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(stalePrefix))));
        setPreferences((current) => ({
          ...current,
          recentProjectIds: current.recentProjectIds.filter((id) => id !== project.id),
          recentWikiVisits: current.recentWikiVisits.filter((visit) => visit.projectId !== project.id),
          readerSessions: Object.fromEntries(Object.entries(current.readerSessions).filter(([key]) => !key.startsWith(stalePrefix))),
        }));
        setProjectMessage('已从项目库移除；源文件保持不变。');
      }
    } catch (error) {
      setProjectMessage(messageOf(error));
    } finally {
      setBusyAction(false);
    }
  }, [service, updateProject]);

  const addProject = useCallback(async () => {
    setBusyAction(true);
    setProjectMessage(null);
    try {
      const path = await service.selectProjectDirectory();
      if (!path) return;
      const result = await service.registerProject(path);
      setProjects((current) => {
        const list = current.status === 'ready' ? current.projects : [];
        return { status: 'ready', projects: [...list.filter((project) => project.id !== result.project.id), result.project] };
      });
      void loadProjectWikis(result.project);
      void loadProjectMarkdown(result.project);
      setProjectMessage(result.created ? '项目已添加。' : '该项目已在项目库中。');
    } catch (error) {
      setProjectMessage(messageOf(error));
    } finally {
      setBusyAction(false);
    }
  }, [loadProjectMarkdown, loadProjectWikis, service]);

  const startTask = useCallback(async (project: HubProject, operation: 'generate-open' | 'sync-open' | 'generate-zread', wikiId?: string, resume = false) => {
    setTaskMessage(null);
    try {
      const targetWikiId = wikiId ?? `${operation === 'generate-zread' ? 'zread' : 'open_zread'}@.`;
      const task = operation === 'generate-zread'
        ? await service.startZreadTask(project.id, targetWikiId)
        : await service.startOpenZreadTask(project.id, targetWikiId, operation === 'sync-open' ? 'sync' : 'generate', resume);
      if (!mounted.current) return;
      const running = activeTask && (activeEvent?.taskId !== activeTask.taskId
        ? activeTask.status === 'queued' || activeTask.status === 'running'
        : ['queued', 'running', 'cancelling'].includes(activeEvent.status));
      if (running) setQueuedTasks((current) => [...current, task]);
      else { setActiveTask(task); setActiveEvent(null); }
      setTaskMessage(`${project.name} · ${task.wikiId} 的 ${task.provider === 'zread' ? 'Zread' : 'OpenZread'} 任务已启动。`);
    } catch (error) {
      setTaskMessage(messageOf(error));
    }
  }, [activeEvent, activeTask, service]);

  const activeStatus = activeTask && activeEvent?.taskId === activeTask.taskId ? activeEvent.status : activeTask?.status;
  const taskBusy = activeStatus === 'queued' || activeStatus === 'running' || activeStatus === 'cancelling';
  useEffect(() => {
    const event = activeEvent;
    if (!activeTask || !event || event.taskId !== activeTask.taskId
      || !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(event.status)) return;
    setQueuedTasks((current) => {
      const [next, ...rest] = current;
      if (next) { setActiveTask(next); setActiveEvent(null); }
      return rest;
    });
  }, [activeEvent, activeTask]);
  useEffect(() => {
    if (!activeTask) return;
    const timer = globalThis.setInterval(() => setTaskClock(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [activeTask]);

  const taskOperation = activeTask?.operation === 'generate' ? '生成' : '同步';
  const cancelTask = useCallback(async () => {
    if (!activeTask) return;
    try { await service.cancelTask(activeTask.taskId); setTaskMessage('已请求取消；如果任务未完成，之前可读的 Wiki 会保留。'); }
    catch (error) { setTaskMessage(messageOf(error)); }
  }, [activeTask, service]);
  const retryTask = useCallback((resume = false) => {
    if (!activeTask || taskBusy) return;
    const project = readyProjects.find((item) => item.id === activeTask.projectId);
    if (!project) { setTaskMessage('该任务关联的项目已不在项目库中。'); return; }
    void startTask(project, activeTask.provider === 'zread' ? 'generate-zread' : activeTask.operation === 'sync' ? 'sync-open' : 'generate-open', activeTask.wikiId, resume);
  }, [activeTask, readyProjects, startTask, taskBusy]);

  const configureZread = useCallback(async () => {
    setConfiguringZread(true);
    setProviderMessage(null);
    try {
      const result = await service.configureZreadExecutable();
      if (result) setHealth({ status: 'ready', health: result });
    } catch (error) { setProviderMessage(messageOf(error)); }
    finally { setConfiguringZread(false); }
  }, [service]);

  const filteredProjects = useMemo(() => readyProjects.filter((project) => {
    const query = projectFilter.trim().toLocaleLowerCase();
    return (!query || project.name.toLocaleLowerCase().includes(query) || project.path.toLocaleLowerCase().includes(query))
      && (!favoriteOnly || project.favorite);
  }).sort((a, b) => {
    switch (preferences.projectSort) {
      case 'name-asc': return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path);
      case 'name-desc': return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path);
      case 'added-newest': {
        const aTime = a.addedAt === undefined ? Number.NEGATIVE_INFINITY : Number(a.addedAt);
        const bTime = b.addedAt === undefined ? Number.NEGATIVE_INFINITY : Number(b.addedAt);
        return bTime - aTime;
      }
      case 'added-oldest': {
        const aTime = a.addedAt === undefined ? Number.POSITIVE_INFINITY : Number(a.addedAt);
        const bTime = b.addedAt === undefined ? Number.POSITIVE_INFINITY : Number(b.addedAt);
        return aTime - bTime;
      }
      default: return Number(b.favorite) - Number(a.favorite);
    }
  }), [favoriteOnly, preferences.projectSort, projectFilter, readyProjects]);
  const recentProjects = useMemo(() => {
    const byId = new Map(readyProjects.map((project) => [project.id, project]));
    const fromPreferences = preferences.recentProjectIds.map((id) => byId.get(id)).filter((project): project is HubProject => Boolean(project));
    const byOpenedAt = [...readyProjects].sort((a, b) => Number(b.lastOpenedAt ?? 0) - Number(a.lastOpenedAt ?? 0));
    return [...new Map([...fromPreferences, ...byOpenedAt].map((project) => [project.id, project])).values()].slice(0, 3);
  }, [preferences.recentProjectIds, readyProjects]);
  const recentVisits = useMemo(() => preferences.recentWikiVisits.filter((visit) => readyProjects.some((project) => project.id === visit.projectId)).slice(0, 5), [preferences.recentWikiVisits, readyProjects]);
  const openZreadHealth = health.status === 'ready' ? health.health.providers.find((item) => item.provider === 'open_zread') : undefined;
  const zreadHealth = health.status === 'ready' ? health.health.providers.find((item) => item.provider === 'zread') : undefined;
  const openZreadReady = openZreadHealth?.generator.status === 'available';
  const zreadReady = zreadHealth?.generator.status === 'available';
  const statusLabel = health.status === 'ready' ? health.health.service.status : health.status === 'loading' ? 'checking' : 'unavailable';

  const card = (project: HubProject) => <ProjectCard
    key={project.id}
    project={project}
    busy={busyAction || taskBusy}
    openZreadReady={Boolean(openZreadReady)}
    zreadReady={Boolean(zreadReady)}
    onOpen={() => openProject(project)}
    onFavorite={() => void projectAction(project, 'favorite')}
    onRename={(name) => renameProject(project, name)}
    onWiki={(provider) => void openWiki(project, provider)}
    onTask={(operation) => void startTask(project, operation)}
    onAction={(action) => void projectAction(project, action)}
    menuOpen={openProjectMenuId === project.id}
    onMenuOpenChange={(open) => setOpenProjectMenuId(open ? project.id : null)}
  />;

  const readerContent = reader.status === 'loading'
    ? <div className="empty-state" role="status" aria-live="polite">正在打开 {providerNames[reader.provider]} Wiki…</div>
    : reader.status === 'error'
      ? <div className="project-error" role="alert"><p>{reader.message}</p><button type="button" className="secondary-button" onClick={() => navigate({ view: 'project', projectId: reader.project.id, projectSection: 'overview' })}>返回 Wiki 概览</button></div>
      : reader.status === 'ready'
        ? <OpenZreadReader
          key={`${reader.project.id}-${reader.wiki.wikiId}-${reader.wiki.currentPointer ?? reader.wiki.catalog.id ?? 'catalog'}`}
          project={reader.project}
          wiki={reader.wiki}
          toolbarTarget={wikiToolbarHost}
          focusText={searchTarget?.projectId === reader.project.id && searchTarget.wikiId === reader.wiki.wikiId
            && searchTarget.slug === readerSessions[readerSessionKey(reader.project.id, reader.wiki.wikiId)]?.selectedSlug
            ? searchTarget.query : undefined}
          providerLabel={`${providerNames[reader.wiki.provider]} Wiki`}
          availableProviders={(['open_zread', 'zread'] as const).filter((provider) => isWikiReadable(reader.project, provider))}
          availableWikiInstances={wikiTreeStates[reader.project.id]?.status === 'ready' ? (wikiTreeStates[reader.project.id] as Extract<WikiTreeState, { status: 'ready' }>).listing.instances : []}
          session={readerSessions[readerSessionKey(reader.project.id, reader.wiki.wikiId)] ?? emptySession}
          onSessionChange={(session) => updateReaderSession(reader.project.id, reader.wiki.provider, reader.wiki.wikiId, reader.wiki.sourceRoot, session)}
          onSwitchProvider={(provider) => void openWiki(reader.project, provider)}
          onSwitchWiki={(instance) => void openWiki(reader.project, instance.provider, undefined, undefined, instance.wikiId)}
          switchingProvider={false}
          readSource={(projectId, path) => reader.wiki.provider === 'zread' ? service.readZreadSource(projectId, path, reader.wiki.wikiId) : service.readOpenZreadSource(projectId, path, reader.wiki.wikiId)}
          readAsset={(projectId, pagePath, assetPath) => reader.wiki.provider === 'zread' ? service.readZreadAsset(projectId, pagePath, assetPath, reader.wiki.wikiId) : service.readOpenZreadAsset(projectId, pagePath, assetPath, reader.wiki.wikiId)}
          previewChange={(projectId, provider, slug, content) => service.previewWikiChange(projectId, provider, slug, content, reader.wiki.wikiId)}
          previewStructureChange={(projectId, provider, request) => service.previewWikiStructureChange(projectId, provider, request, reader.wiki.wikiId)}
          applyChange={service.applyWikiChange}
          listHistory={(projectId, provider) => service.listWikiHistory(projectId, provider, reader.wiki.wikiId)}
          restoreHistory={(projectId, provider, historyId) => service.restoreWikiHistory(projectId, provider, historyId, reader.wiki.wikiId)}
          askWiki={(projectId, provider, slug, question, selectedText) => service.askWiki(projectId, provider, slug, question, selectedText, reader.wiki.wikiId)}
          rewritePage={(projectId, provider, slug, instruction, sectionHeading) => service.rewriteWikiPage(projectId, provider, slug, instruction, sectionHeading, reader.wiki.wikiId)}
          draftPage={(projectId, provider, topic, section) => service.draftWikiPage(projectId, provider, topic, section, reader.wiki.wikiId)}
          onHistoryRestored={() => void openWiki(reader.project, reader.wiki.provider, undefined, undefined, reader.wiki.wikiId)}
          onRegisterLeaveGuard={registerReaderLeaveGuard}
          onClose={goBack}
        />
        : currentProject ? <div className="wiki-provider-empty">
          <h3>选择要阅读的 Wiki</h3>
          <p>OpenZread 与 Zread 的章节和阅读位置彼此独立。</p>
          {(['open_zread', 'zread'] as const).map((provider) => (
            <button key={provider} type="button" className="secondary-button" disabled={!isWikiReadable(currentProject, provider)} onClick={() => void openWiki(currentProject, provider)}>{providerNames[provider]} · {isWikiReadable(currentProject, provider) ? '打开' : '尚不可读'}</button>
          ))}
        </div> : <div className="empty-state" aria-busy="true">正在载入项目…</div>;

  const renderProviderCard = (provider: HubProviderHealth) => (
    <article className="provider-health-card" data-testid={`provider-health-${provider.provider}`} key={provider.provider}>
      <div className="provider-health-heading"><h4>{providerNames[provider.provider]}</h4><span className={`availability-badge availability-${provider.generator.status}`}>{providerSummary(provider)}</span></div>
      <dl className="provider-health-details">
        <div><dt>Wiki 内容</dt><dd>按项目独立</dd></div>
        <div><dt>生成器状态</dt><dd data-testid={`provider-${provider.provider}-generator-status`}>{provider.generator.status}</dd></div>
        <div><dt>版本</dt><dd data-testid={`provider-${provider.provider}-version`}>{provider.generator.version}</dd></div>
        <div className="health-detail-path"><dt>可执行文件</dt><dd data-testid={`provider-${provider.provider}-path`}>{provider.generator.executablePath}</dd></div>
        <div><dt>配置来源</dt><dd>{provider.configSource}</dd></div>
      </dl>
      <div className="provider-capabilities" aria-label={`${providerNames[provider.provider]} capabilities`}>
        {(['generate', 'regenerate', 'sync'] as const).map((capability) => <span className={`capability-badge ${provider.capabilities[capability] ? 'is-supported' : 'is-unsupported'}`} key={capability}><span>{capability}</span><strong data-testid={`provider-${provider.provider}-${capability}`}>{provider.capabilities[capability] ? 'Available' : 'Unsupported'}</strong></span>)}
      </div>
      {provider.provider === 'zread' && <button type="button" className="secondary-button provider-configure-button" data-testid="select-zread-executable" disabled={configuringZread} onClick={() => void configureZread()}>{configuringZread ? '正在选择…' : '选择 zread.exe'}</button>}
      {provider.generator.diagnostics.length > 0 && <p className="provider-diagnostics">{provider.generator.diagnostics.join(' ')}</p>}
    </article>
  );

  const renderTaskSummary = () => activeTask ? (
    <section className="active-task-panel" data-testid="active-task" aria-live="polite">
      <div className="active-task-heading"><div><p className="eyebrow">{taskBusy ? '正在运行' : '最近任务'}</p><h3>{taskOperation} {activeTask.provider === 'zread' ? 'Zread' : 'OpenZread'} Wiki</h3><p>{readyProjects.find((project) => project.id === activeTask.projectId)?.name ?? activeTask.projectId} · {activeTask.wikiId} · {activeTask.model}</p></div><span className={`availability-badge availability-${activeStatus ?? activeTask.status}`} data-testid="task-status">{activeStatus ?? activeTask.status}</span></div>
      <div className="task-progress-details"><span>阶段 <strong data-testid="task-phase">{activeEvent?.taskId === activeTask.taskId ? activeEvent.phase : 'starting'}</strong></span><span>已运行 <strong data-testid="task-elapsed">{(() => { const start = Number(activeTask.startedAt); if (!Number.isFinite(start)) return '—'; const seconds = Math.max(0, Math.floor((taskClock - start) / 1000)); return `${Math.floor(seconds / 60)}分 ${String(seconds % 60).padStart(2, '0')}秒`; })()}</strong></span></div>
      {activeEvent?.taskId === activeTask.taskId && activeEvent.message && <p className="task-panel-message">{activeEvent.message}</p>}
      {activeEvent?.taskId === activeTask.taskId && activeEvent.progress && <p className="task-panel-progress" data-testid="task-panel-progress">{activeEvent.progress.succeeded !== undefined || activeEvent.progress.failed !== undefined
        ? `成功 ${activeEvent.progress.succeeded ?? 0} · 失败 ${activeEvent.progress.failed ?? 0} · 共 ${activeEvent.progress.total} 页（已处理 ${activeEvent.progress.current}）`
        : `${activeEvent.progress.current} / ${activeEvent.progress.total} 页`}</p>}
      {activeEvent?.taskId === activeTask.taskId && activeEvent.status === 'failed' && activeEvent.details && <details className="task-error-details"><summary>错误详情</summary><pre data-testid="task-error-details">{activeEvent.details}</pre></details>}
      {queuedTasks.length > 0 && <p className="task-panel-message" data-testid="queued-task-count">队列中还有 {queuedTasks.length} 个任务。</p>}
      {taskMessage && <p className="task-panel-message" role="status">{taskMessage}</p>}
      <div className="task-actions">{taskBusy
        ? <button type="button" className="danger-button" data-testid="cancel-active-task" onClick={() => void cancelTask()}>取消任务</button>
        : activeEvent?.taskId === activeTask.taskId && activeEvent.status === 'failed' && activeEvent.canResume && activeTask.provider === 'open_zread'
          ? <><button type="button" className="primary-button" data-testid="continue-active-task" onClick={() => retryTask(true)}>继续未完成页面</button><button type="button" className="secondary-button" data-testid="restart-active-task" onClick={() => retryTask(false)}>从头重试</button></>
          : <button type="button" className="secondary-button" data-testid="retry-active-task" onClick={() => retryTask(false)}>重试任务</button>}</div>
    </section>
  ) : null;

  const renderSearchResults = () => (
    <section className="page-section" aria-labelledby="search-title">
      <div className="page-heading"><div><p className="eyebrow">跨项目搜索</p><h2 id="search-title">项目知识搜索</h2><p>同时搜索普通 Markdown 文档与 OpenZread、Zread Wiki。</p></div></div>
      {searchState.status === 'loading' && <p className="empty-state" role="status" aria-busy="true">正在搜索 “{searchState.query}”…</p>}
      {searchState.status === 'error' && <div className="project-error" role="alert"><p>{searchState.message}</p><button type="button" className="secondary-button" onClick={() => void search()}>重试</button></div>}
      {searchState.status === 'ready' && <div className="search-results" data-testid="search-results">
        {searchState.response.results.length === 0 && searchState.response.markdownResults.length === 0 && <p className="empty-state">没有找到 “{searchState.response.query}” 的 Markdown 或 Wiki 内容。</p>}
        {searchState.response.results.map((result) => <button type="button" className="search-result" data-testid={`search-result-${result.projectId}-${result.wikiId}-${result.slug}`} key={`${result.projectId}:${result.wikiId}:${result.slug}`} onClick={() => {
          const project = readyProjects.find((candidate) => candidate.id === result.projectId);
          if (project) void openWiki(project, result.provider, result.slug, searchState.response.query, result.wikiId);
        }}>
          <span><strong>{result.title}</strong><small>{result.projectName} · {result.sourceRoot === '.' ? '根目录' : result.sourceRoot} · {providerNames[result.provider]} · {result.path}</small></span><em>{result.snippet}</em><span className="search-result-open">打开页面 <HubIcon name="chevron" /></span>
        </button>)}
        {searchState.response.markdownResults.map((result) => <button type="button" className="search-result" data-testid={`search-result-markdown-${result.projectId}-${result.path}`} key={`${result.projectId}:local_markdown:${result.path}`} onClick={() => {
          const project = readyProjects.find((candidate) => candidate.id === result.projectId);
          if (project) void openMarkdownSearchResult(project, result, searchState.response.query);
        }}>
          <span><strong>{result.title}</strong><small>{result.projectName} · Markdown · {result.path}{result.matchLine ? ` · 第 ${result.matchLine} 行` : ''}</small></span><em>{result.snippet}</em><span className="search-result-open">打开文档 <HubIcon name="chevron" /></span>
        </button>)}
        {markdownSearchMessage && <p className="search-failures" role="alert">{markdownSearchMessage}</p>}
        {searchState.response.failures.length > 0 && <p className="search-failures" role="status">部分 Wiki 来源无法搜索：{searchState.response.failures.map((failure) => `${failure.projectName}（${failure.sourceRoot === '.' ? '根目录' : failure.sourceRoot} · ${providerNames[failure.provider]}：${failure.message}）`).join('、')}</p>}
        {searchState.response.markdownFailures.length > 0 && <p className="search-failures" role="status">部分 Markdown 文件或项目搜索不完整：{searchState.response.markdownFailures.slice(0, 8).map((failure) => `${failure.projectName}${failure.relativePath ? ` · ${failure.relativePath}` : ''}：${failure.message}`).join('；')}{searchState.response.markdownFailures.length > 8 ? `；另有 ${searchState.response.markdownFailures.length - 8} 条` : ''}</p>}
      </div>}
      {searchState.status === 'idle' && <p className="empty-state">输入关键词并搜索。搜索结果会打开对应项目、Provider 和章节。</p>}
    </section>
  );

  const workspaceSection = location.projectSection ?? 'overview';
  const markdownSelectedPath = preferences.markdownRecentFiles[currentProject?.id ?? ''];
  const markdownDocumentForView = markdownDocument.status === 'ready'
    && markdownDocument.projectId === currentProject?.id
    && markdownDocument.path === markdownSelectedPath
    ? markdownDocument.document
    : null;
  const markdownDraftKeyForView = currentProject && markdownSelectedPath
    ? markdownSessionKey(currentProject.id, markdownSelectedPath)
    : null;
  const markdownDraftForView = markdownDraftKeyForView ? markdownDrafts[markdownDraftKeyForView] : undefined;
  const markdownDraftDirtyForView = Boolean(markdownDraftForView && markdownDraftForView.content !== markdownDraftForView.baseContent);

  const askMarkdownQuestion = useCallback(async () => {
    if (!currentProject || !markdownSelectedPath || !markdownDocumentForView || !markdownAskQuestion.trim()) return;
    const projectId = currentProject.id;
    const path = markdownSelectedPath;
    setMarkdownAskState({ status: 'loading', projectId, path });
    try {
      const response = await service.askProjectMarkdown(projectId, path, markdownAskQuestion, markdownAskSelectedText);
      if (mounted.current) setMarkdownAskState({ status: 'ready', response });
    } catch (error) {
      if (mounted.current) setMarkdownAskState({ status: 'error', projectId, path, message: messageOf(error) });
    }
  }, [currentProject, markdownAskQuestion, markdownAskSelectedText, markdownDocumentForView, markdownSelectedPath, service]);

  const captureMarkdownSelection = useCallback(() => {
    const article = markdownArticleRef.current;
    const selection = globalThis.getSelection?.();
    if (!article || !selection || !selection.anchorNode || !article.contains(selection.anchorNode)) return;
    setMarkdownAskSelectedText(selection.toString().trim());
  }, []);

  const appendMarkdownAnswerToDraft = useCallback((response: HubMarkdownAnswerResponse) => {
    if (!currentProject || !markdownDocumentForView || !markdownDraftKeyForView
      || response.projectId !== currentProject.id || response.path !== markdownSelectedPath) return;
    const existingDraft = markdownDrafts[markdownDraftKeyForView];
    const existing = existingDraft?.content ?? markdownDocumentForView.content;
    const separator = existing.trimEnd() ? '\n\n' : '';
    const content = `${existing.trimEnd()}${separator}## AI 建议\n\n${response.answer.trim()}\n`;
    setMarkdownDrafts((current) => ({
      ...current,
      [markdownDraftKeyForView]: {
        projectId: currentProject.id,
        relativePath: markdownSelectedPath,
        baseRevision: existingDraft?.baseRevision ?? markdownDocumentForView.revision,
        baseContent: existingDraft?.baseContent ?? markdownDocumentForView.content,
        content,
      },
    }));
    setMarkdownEditorOpen(true);
    setMarkdownPreviewOpen(false);
  }, [currentProject, markdownDocumentForView, markdownDraftKeyForView, markdownDrafts, markdownSelectedPath]);

  useEffect(() => {
    setMarkdownEditorOpen(false);
    setMarkdownPreviewOpen(false);
    setMarkdownSaveError(null);
    setMarkdownRemoteDocument(null);
    setMarkdownAskState({ status: 'idle' });
    setMarkdownAskQuestion('');
    setMarkdownAskSelectedText('');
  }, [location.view, location.projectId, workspaceSection, markdownSelectedPath]);

  const startMarkdownEdit = () => {
    if (!currentProject || !markdownSelectedPath || !markdownDocumentForView || !markdownDraftKeyForView) return;
    setMarkdownDrafts((current) => current[markdownDraftKeyForView] ? current : {
      ...current,
      [markdownDraftKeyForView]: {
        projectId: currentProject.id,
        relativePath: markdownSelectedPath,
        baseRevision: markdownDocumentForView.revision,
        baseContent: markdownDocumentForView.content,
        content: markdownDocumentForView.content,
      },
    });
    setMarkdownEditorOpen(true);
    setMarkdownPreviewOpen(false);
    setMarkdownSaveError(null);
    setMarkdownSaveMessage(null);
  };

  const updateMarkdownDraft = (content: string) => {
    if (!markdownDraftKeyForView) return;
    setMarkdownDrafts((current) => {
      const draft = current[markdownDraftKeyForView];
      return draft ? { ...current, [markdownDraftKeyForView]: { ...draft, content } } : current;
    });
    setMarkdownSaveError(null);
    setMarkdownSaveMessage(null);
  };

  const discardMarkdownDraft = () => {
    if (markdownDraftKeyForView) {
      setMarkdownDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== markdownDraftKeyForView),
      ));
    }
    setMarkdownEditorOpen(false);
    setMarkdownPreviewOpen(false);
    setMarkdownSaveError(null);
  };

  const resolveMarkdownLeavePrompt = (choice: 'keep' | 'discard' | 'cancel') => {
    setMarkdownLeavePromptOpen(false);
    if (choice === 'cancel') {
      markdownPendingLeaveRef.current = null;
      return;
    }
    if (choice === 'discard' && activeMarkdownDraftKey) {
      setMarkdownDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== activeMarkdownDraftKey),
      ));
    }
    setMarkdownEditorOpen(false);
    setMarkdownPreviewOpen(false);
    const continuation = markdownPendingLeaveRef.current;
    markdownPendingLeaveRef.current = null;
    markdownSkipLeaveGuardOnce.current = true;
    continuation?.();
  };

  const saveMarkdownDraft = async () => {
    if (!currentProject || !markdownSelectedPath || !markdownDraftForView || !markdownDraftDirtyForView) return;
    setMarkdownSaveBusy(true);
    setMarkdownSaveError(null);
    try {
      const saved = await service.saveProjectMarkdown(
        currentProject.id,
        markdownSelectedPath,
        markdownDraftForView.baseRevision,
        markdownDraftForView.content,
      );
      setMarkdownDocument({ status: 'ready', projectId: currentProject.id, path: markdownSelectedPath, document: saved });
      setMarkdownDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== markdownDraftKeyForView),
      ));
      setMarkdownEditorOpen(false);
      setMarkdownPreviewOpen(false);
      setMarkdownRemoteDocument(null);
      setMarkdownSaveMessage(`已写回 ${saved.relativePath}；原文恢复快照已保存。`);
      void loadProjectMarkdown(currentProject, true);
    } catch (error) {
      setMarkdownSaveError(messageOf(error));
    } finally {
      setMarkdownSaveBusy(false);
    }
  };

  const loadMarkdownDiskVersion = async () => {
    if (!currentProject || !markdownSelectedPath) return;
    try {
      const latest = await service.readProjectMarkdown(currentProject.id, markdownSelectedPath);
      setMarkdownRemoteDocument(latest);
      setMarkdownPreviewOpen(true);
      setMarkdownEditorOpen(false);
      setMarkdownSaveError('已读取磁盘当前版本供比较；草稿仍保留，保存前需要处理此冲突。');
    } catch (error) {
      setMarkdownSaveError(messageOf(error));
    }
  };

  useEffect(() => {
    const document = markdownDocument.status === 'ready'
      && markdownDocument.projectId === currentProject?.id
      && markdownDocument.path === markdownSelectedPath
      ? markdownDocument.document
      : null;
    const article = markdownArticleRef.current;
    if (!document || !article || typeof article.querySelectorAll !== 'function') {
      setMarkdownOutline([]);
      setActiveMarkdownHeading('');
      return;
    }
    const headings = [...article.querySelectorAll<HTMLElement>('[data-markdown-heading="true"]')]
      .filter((heading) => heading.id)
      .map((heading) => ({
        id: heading.id,
        title: heading.textContent?.trim() || heading.id,
        level: Number(heading.tagName.match(/^H([1-6])$/i)?.[1] ?? 1),
      }));
    setMarkdownOutline(headings);
    setActiveMarkdownHeading(headings[0]?.id ?? '');
  }, [currentProject?.id, location.view, markdownDocument, markdownSelectedPath, workspaceSection]);
  const associatedSources = reader.status === 'ready' && reader.project.id === currentProject?.id
    ? [...new Set(reader.wiki.pages.flatMap((page) => page.associatedFiles))]
    : [];
  const sourceProvider: HubWikiProvider = reader.status === 'ready' && reader.project.id === currentProject?.id
    ? reader.wiki.provider
    : preferences.recentWikiVisits.find((visit) => visit.projectId === currentProject?.id)?.provider ?? 'open_zread';

  return (
    <div className={`hub-app${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="hub-sidebar" aria-label="主导航">
        <button type="button" className="brand-lockup" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed((value) => !value)}><span className="brand-mark"><HubIcon name="code" /></span><span className="brand-copy"><strong>Open Zread Hub</strong><small>代码知识 · 在本地</small></span><span className="brand-chevron">⌄</span></button>
        <nav className="global-navigation">
          {navItems.map((item) => <div className={`global-nav-row${item.view === 'projects' ? ' has-tree-toggle' : ''}`} key={item.view}>
            <button type="button" data-testid={`nav-${item.view}`} className={`global-nav-item${location.view === item.view || (location.view === 'project' && item.view === 'projects') ? ' is-active' : ''}`} aria-current={location.view === item.view || (location.view === 'project' && item.view === 'projects') ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => navigate({ view: item.view })}><HubIcon name={item.icon} /><span>{item.label}</span>{item.view === 'tasks' && activeTask && <i aria-label="有任务" />}</button>
            {item.view === 'projects' && <button ref={projectTreeToggleRef} type="button" className="global-tree-toggle" aria-label={preferences.projectTreeExpanded ? '收起项目树' : '展开项目树'} aria-controls="project-library-tree" aria-expanded={preferences.projectTreeExpanded} title="展开项目树" onClick={() => setPreferences((current) => ({ ...current, projectTreeExpanded: !current.projectTreeExpanded }))}><HubIcon name="chevron" /></button>}
          </div>)}
        </nav>
        {!collapsed && preferences.projectTreeExpanded && <ProjectLibraryTree
          projects={readyProjects}
          expandedProjectIds={preferences.expandedProjectIds}
          onEscape={() => {
            setPreferences((current) => ({ ...current, projectTreeExpanded: false }));
            globalThis.setTimeout(() => projectTreeToggleRef.current?.focus(), 0);
          }}
          states={wikiTreeStates}
          markdownStates={markdownTreeStates}
          expandedMarkdownPaths={preferences.expandedMarkdownPaths}
          activeProjectId={location.view === 'project' ? location.projectId : undefined}
          activeWikiId={reader.status === 'ready' ? reader.wiki.wikiId : undefined}
          activeMarkdownPath={location.view === 'project' && location.projectSection === 'markdown' ? preferences.markdownRecentFiles[location.projectId ?? ''] : undefined}
          onToggleProject={(projectId) => { const project = readyProjects.find((item) => item.id === projectId); if (project) toggleProjectTree(project); }}
          onToggleMarkdownPath={toggleMarkdownPath}
          onOpenProject={(project) => openProject(project, 'overview')}
          onRefresh={refreshProjectWikis}
          onLocate={locateProjectWikiInstances}
          onRefreshMarkdown={refreshProjectMarkdown}
          onOpenWiki={(project, wiki) => void openWiki(project, wiki.provider, undefined, undefined, wiki.wikiId)}
          onOpenMarkdown={openMarkdownFile}
        />}
        <div className="sidebar-spacer" />
        <div className="sidebar-library-card"><span className="storage-glyph">▤</span><span><strong>本地知识库</strong><small>数据保存在此设备</small></span></div>
        <button type="button" className="sidebar-user" onClick={() => navigate({ view: 'settings' })}><span className="user-avatar">⌂</span><span><strong>本地工作区</strong><small>应用设置</small></span><HubIcon name="chevron" /></button>
        <div className="sidebar-footer"><span className={`status-dot status-${statusLabel}`} /><span>{statusLabel === 'healthy' ? '服务运行正常' : statusLabel === 'checking' ? '正在检查服务' : '服务暂不可用'}</span></div>
      </aside>

      <div className="hub-main-column">
        <header className="hub-topbar">
          <div className="topbar-breadcrumb">
            <button type="button" className="icon-button back-button" data-testid="app-back" aria-label="返回" disabled={stack.length === 0 && location.view !== 'project'} onClick={goBack}>‹</button>
            {location.view === 'project' && currentProject ? <><button type="button" onClick={() => navigate({ view: 'projects' })}>项目库</button><HubIcon name="chevron" /><strong>{currentProject.name}</strong><HubIcon name="chevron" /><span>{projectSections.find((item) => item.id === workspaceSection)?.label}</span></> : <strong>{navItems.find((item) => item.view === location.view)?.label ?? '首页'}</strong>}
          </div>
          <form className="global-search topbar-search" aria-label="搜索 Wiki 内容" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <HubIcon name="search" /><input ref={searchInput} data-testid="global-search-input" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onFocus={() => { if (location.view !== 'search') navigate({ view: 'search' }); }} placeholder="搜索项目、Wiki 或内容…" /><kbd>Ctrl K</kbd><button type="submit" data-testid="global-search-submit" disabled={!searchQuery.trim() || searchState.status === 'loading'}>{searchState.status === 'loading' ? '搜索中…' : '搜索'}</button>
          </form>
          <div className="topbar-tools"><span className="focus-chip"><span>●</span>本地优先</span><button type="button" className="icon-button" aria-label="查看任务" onClick={() => navigate({ view: 'tasks' })}><HubIcon name="tasks" /></button></div>
        </header>

        <main className={`hub-content${location.view === 'project' ? ' hub-content-project' : ''}${location.view === 'project' && workspaceSection === 'wiki' ? ' hub-content-project-wiki' : ''}${location.view === 'project' && workspaceSection === 'markdown' ? ' hub-content-project-markdown' : ''}`} id="main-content">
          {location.view === 'home' && <>
            <section className="welcome-row"><div><p className="eyebrow">工作区 · 本地优先</p><h1>欢迎回来 👋</h1><p>管理你的代码知识库，让文档与代码一起进化</p></div><button type="button" className="secondary-button" onClick={() => navigate({ view: 'providers' })}><span className={`status-dot status-${statusLabel}`} />服务状态 <HubIcon name="chevron" /></button></section>
            {projectMessage && <p className="project-message" role="status">{projectMessage}</p>}
            <div className="home-summary-grid">
              <button type="button" className="summary-card" onClick={() => navigate({ view: 'projects' })}><span className="summary-icon summary-green"><HubIcon name="projects" /></span><span><strong>项目库</strong><small>{projects.status === 'ready' ? `${readyProjects.length} 个本地项目` : '正在读取项目'}</small></span><HubIcon name="chevron" /></button>
              <button type="button" className="summary-card" onClick={() => navigate({ view: 'providers' })}><span className="summary-icon summary-blue"><HubIcon name="provider" /></span><span><strong>Provider</strong><small>{health.status === 'ready' ? health.health.providers.map((provider) => `${providerNames[provider.provider]} ${providerSummary(provider)}`).join(' · ') : '状态检查中'}</small></span><HubIcon name="chevron" /></button>
              <button type="button" className="summary-card" onClick={() => navigate({ view: 'tasks' })}><span className={`summary-icon ${taskBusy ? 'summary-amber' : 'summary-slate'}`}><HubIcon name="tasks" /></span><span><strong>任务</strong><small>{activeTask ? `${taskBusy ? '正在运行' : '最近任务'} · ${activeTask.provider === 'zread' ? 'Zread' : 'OpenZread'}` : '当前没有运行中的任务'}</small></span><HubIcon name="chevron" /></button>
            </div>
            <section className="home-section" aria-labelledby="recent-projects-title"><div className="section-heading-row"><div><p className="eyebrow">继续你的工作</p><h2 id="recent-projects-title">最近项目</h2></div><button type="button" className="text-button" onClick={() => navigate({ view: 'projects' })}>查看全部 <HubIcon name="chevron" /></button></div>
              {projects.status === 'loading' && <p className="empty-state" aria-busy="true">正在读取项目…</p>}
              {projects.status === 'error' && <div className="project-error" role="alert"><p>{projects.message}</p><button type="button" className="secondary-button" onClick={() => void loadProjects()}>重试</button></div>}
              {projects.status === 'ready' && readyProjects.length === 0 && <div className="empty-state empty-project-home"><h3>从添加本地项目开始</h3><p>选择一个代码目录，即可在项目内阅读和维护 Wiki。</p><button type="button" className="primary-button" data-testid="add-project" disabled={busyAction} onClick={() => void addProject()}>{busyAction ? '处理中…' : '＋ 添加本地项目'}</button></div>}
              {recentProjects.length > 0 && <div className="project-grid home-project-grid" data-testid="project-list">{recentProjects.map(card)}</div>}
            </section>
            <div className="home-lower-grid"><section className="home-section recent-reading" aria-labelledby="recent-reading-title"><div className="section-heading-row"><div><p className="eyebrow">阅读进度</p><h2 id="recent-reading-title">最近阅读</h2></div></div>
                {recentVisits.length === 0 ? <p className="quiet-empty">还没有阅读记录。打开项目中的 Wiki 后会显示在这里。</p> : <div className="recent-reading-list">{recentVisits.map((visit) => { const project = readyProjects.find((item) => item.id === visit.projectId); const wikiId = visit.wikiId ?? `${visit.provider}@.`; return project ? <button type="button" className="recent-reading-item" data-testid={`recent-wiki-${visit.projectId}-${wikiId}-${visit.slug}`} key={`${visit.projectId}:${wikiId}:${visit.slug}`} onClick={() => void openWiki(project, visit.provider, visit.slug, undefined, wikiId)}><span className="reading-book"><HubIcon name="book" /></span><span><strong>{visit.title}</strong><small>{project.name} · {visit.sourceRoot === '.' ? '根目录' : visit.sourceRoot ?? '根目录'} · {providerNames[visit.provider]}</small></span><HubIcon name="chevron" /></button> : null; })}</div>}
              </section><section className="home-section home-provider-summary"><div className="section-heading-row"><div><p className="eyebrow">服务概况</p><h2>运行状态</h2></div><span className={`status-dot status-${statusLabel}`} /></div><p className="service-status" data-testid="service-status">{statusLabel}</p>{health.status === 'error' && <p className="error-message">{health.message}</p>}{lastEvent && <p className="task-event" data-testid="last-task-event">{lastEvent.phase}: {lastEvent.status}</p>}<button type="button" className="text-button" onClick={() => navigate({ view: 'providers' })}>查看 Provider 诊断 <HubIcon name="chevron" /></button></section></div>
          </>}

          {location.view === 'projects' && <section className="page-section project-library" aria-labelledby="project-library-title"><div className="page-heading"><div><p className="eyebrow">本地代码知识库</p><h1 id="project-library-title">项目库</h1><p>选择项目进入独立的 Wiki、代码与维护工作区。</p></div><button type="button" className="primary-button" data-testid="add-project" disabled={busyAction} onClick={() => void addProject()}>{busyAction ? '正在添加…' : '＋ 添加本地项目'}</button></div>
            {projectMessage && <p className="project-message" role="status">{projectMessage}</p>}
            {projects.status === 'ready' && readyProjects.length > 0 && <div className="project-library-tools"><label className="project-search"><HubIcon name="search" /><input data-testid="project-filter" type="search" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} placeholder="搜索项目名称或路径…" /></label><label className="favorite-filter"><input data-testid="favorite-filter" type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />仅看收藏</label><label className="project-sort-control">排序<select aria-label="项目排序" data-testid="project-sort" value={preferences.projectSort} onChange={(event) => setPreferences((current) => ({ ...current, projectSort: event.target.value as HubPreferences['projectSort'] }))}><option value="favorite">收藏优先</option><option value="name-asc">名称升序</option><option value="name-desc">名称降序</option><option value="added-newest">添加日期：新到旧</option><option value="added-oldest">添加日期：旧到新</option></select></label></div>}
            {projects.status === 'loading' && <p className="empty-state" aria-busy="true">正在读取项目…</p>}
            {projects.status === 'error' && <div className="project-error" role="alert"><p>{projects.message}</p><button type="button" className="secondary-button" onClick={() => void loadProjects()}>重试</button></div>}
            {projects.status === 'ready' && readyProjects.length === 0 && <div className="empty-state" data-testid="empty-project-library"><h3>项目库还是空的</h3><p>添加本地代码目录，开始建立项目知识空间。</p><button type="button" className="primary-button" onClick={() => void addProject()}>添加本地项目</button></div>}
            {projects.status === 'ready' && readyProjects.length > 0 && filteredProjects.length === 0 && <div className="empty-state" data-testid="no-project-results"><h3>没有匹配的项目</h3><p>更改关键词或关闭收藏筛选。</p><button type="button" className="secondary-button" onClick={() => { setProjectFilter(''); setFavoriteOnly(false); }}>清除筛选</button></div>}
            {filteredProjects.length > 0 && <div className="project-grid" data-testid="project-list">{filteredProjects.map(card)}</div>}
          </section>}

          {location.view === 'search' && renderSearchResults()}

          {location.view === 'project' && currentProject && <section className="project-workspace" data-testid="project-workspace">
            <nav className="project-section-nav" aria-label={`${currentProject.name} 项目导航`}>
              <div className="project-section-nav-tabs">{projectSections.map((item) => <button key={item.id} type="button" data-testid={`project-tab-${item.id}`} className={workspaceSection === item.id ? 'is-active' : ''} aria-current={workspaceSection === item.id ? 'page' : undefined} onClick={() => navigate({ view: 'project', projectId: currentProject.id, projectSection: item.id })}><HubIcon name={item.icon} />{item.label}</button>)}</div>
              {workspaceSection === 'wiki' && reader.status === 'ready' && <div ref={setWikiToolbarHost} className="project-section-nav-tools" data-testid="project-wiki-toolbar" />}
            </nav>
            {workspaceSection === 'overview' && <div className="project-overview"><section className="overview-hero"><div><p className="eyebrow">项目知识工作区</p><h2>项目概览</h2><p>选择一个 Wiki Provider 开始阅读。两个 Provider 的章节与阅读进度分别维护。</p></div><span className="overview-hero-icon"><HubIcon name="book" /></span></section><div className="overview-provider-grid">{(['open_zread', 'zread'] as const).map((provider) => { const readable = isWikiReadable(currentProject, provider); const status = provider === 'zread' ? currentProject.wiki.zread : currentProject.wiki.openZread; return <article className="overview-provider-card" key={provider}><div><span className={`summary-icon ${provider === 'zread' ? 'summary-blue' : 'summary-green'}`}><HubIcon name="book" /></span><span><strong>{providerNames[provider]}</strong><small>{status === 'readable' ? 'Wiki 可读' : status === 'partial' ? '部分页面可读' : status === 'missing' ? '尚未生成' : '当前不可用'}</small></span></div><button type="button" className={readable ? 'primary-button' : 'secondary-button'} disabled={!readable} onClick={() => void openWiki(currentProject, provider)}>{readable ? '打开 Wiki' : '暂不可读'}</button></article>; })}</div><div className="overview-facts"><div><small>本地路径</small><strong>{currentProject.path}</strong></div><div><small>源代码管理</small><strong>{currentProject.sourceControl === 'git' ? 'Git' : '本地目录'}</strong></div><div><small>最近打开</small><strong>{currentProject.lastOpenedAt ? new Date(Number(currentProject.lastOpenedAt)).toLocaleString() : '尚无项目访问时间'}</strong></div></div></div>}
            {workspaceSection === 'wiki' && <div className="project-wiki-workspace">{readerContent}</div>}
            {workspaceSection === 'markdown' && (() => {
              const treeState = markdownTreeStates[currentProject.id];
              const tree = markdownTreeOf(treeState);
              const selectedPath = preferences.markdownRecentFiles[currentProject.id];
              const expandedPaths = preferences.expandedMarkdownPaths[currentProject.id] ?? [];
              return (
                <section className="markdown-workspace" data-testid="project-markdown-workspace">
                  <header className="markdown-workspace-header">
                    <div><p className="eyebrow">本地 Markdown 文档</p><h2>{markdownDocumentForView?.title ?? (selectedPath ? selectedPath.split('/').at(-1) : 'Markdown 文档库')}</h2><p>{tree ? `${tree.scannedFiles} 个文档${tree.scanComplete ? '' : ' · 部分扫描'}` : '按项目原目录发现 Markdown 文件'}</p></div>
                    <div className="markdown-workspace-actions">
                      <button type="button" className="secondary-button" aria-label={markdownTreeOpen ? '隐藏 Markdown 目录' : '显示 Markdown 目录'} aria-expanded={markdownTreeOpen} onClick={() => setMarkdownTreeOpen((open) => !open)}>{markdownTreeOpen ? '隐藏目录' : '显示目录'}</button>
                      <button type="button" className="secondary-button" aria-label={markdownInspectorOpen ? '隐藏阅读侧栏' : '显示阅读侧栏'} aria-expanded={markdownInspectorOpen} onClick={() => setMarkdownInspectorOpen((open) => !open)}>{markdownInspectorOpen ? '隐藏侧栏' : '显示侧栏'}</button>
                      <button type="button" className="secondary-button" data-testid="markdown-edit-button" disabled={!markdownDocumentForView || markdownSaveBusy} onClick={startMarkdownEdit}>{markdownDraftDirtyForView ? '继续编辑草稿' : '编辑原文'}</button>
                      <button type="button" className="secondary-button" data-testid="markdown-close-reading" disabled={markdownSaveBusy} onClick={() => navigate({ view: 'project', projectId: currentProject.id, projectSection: 'overview' })}>关闭阅读</button>
                      <button type="button" className="secondary-button" disabled={treeState?.status === 'loading'} onClick={() => refreshProjectMarkdown(currentProject)}><HubIcon name="refresh" />{treeState?.status === 'loading' ? '正在刷新…' : '刷新目录'}</button>
                    </div>
                  </header>
                  <div
                    ref={markdownLayoutRef}
                    className="markdown-workspace-body"
                    style={{
                      gridTemplateColumns: [
                        ...(markdownTreeOpen ? [`${markdownTreeWidth}px`, '8px'] : []),
                        'minmax(0, 1fr)',
                        ...(markdownInspectorOpen ? ['8px', `${markdownInspectorWidth}px`] : []),
                      ].join(' '),
                    }}
                  >
                    {markdownTreeOpen && <aside className="markdown-workspace-tree" data-testid="markdown-workspace-tree" style={{ width: `${markdownTreeWidth}px` }}>
                      <div className="project-tree-wiki-heading"><span>文档目录</span><button type="button" className="icon-button" aria-label="刷新 Markdown 目录" title="刷新 Markdown 目录" disabled={treeState?.status === 'loading'} onClick={() => refreshProjectMarkdown(currentProject)}><HubIcon name="refresh" /></button></div>
                      <form className="markdown-directory-search" data-testid="markdown-local-search-form" onSubmit={(event) => { event.preventDefault(); void searchMarkdownInProject(currentProject, markdownLocalSearchQuery); }}>
                        <input type="search" aria-label="搜索当前项目 Markdown" data-testid="markdown-local-search-input" value={markdownLocalSearchQuery} onChange={(event) => setMarkdownLocalSearchQuery(event.currentTarget.value)} placeholder="搜索文件名、路径或正文…" />
                        <button type="submit" className="secondary-button" data-testid="markdown-local-search-submit" disabled={!markdownLocalSearchQuery.trim() || (markdownLocalSearch.status === 'loading' && markdownLocalSearch.projectId === currentProject.id)}>{markdownLocalSearch.status === 'loading' && markdownLocalSearch.projectId === currentProject.id ? '搜索中…' : '搜索'}</button>
                      </form>
                      {markdownLocalSearch.status === 'loading' && markdownLocalSearch.projectId === currentProject.id && <p className="project-tree-message" role="status">正在搜索 Markdown “{markdownLocalSearch.query}”…</p>}
                      {markdownLocalSearch.status === 'error' && markdownLocalSearch.projectId === currentProject.id && <p className="project-tree-message is-error" role="alert">Markdown 搜索失败：{markdownLocalSearch.message}</p>}
                      {markdownLocalSearch.status === 'ready' && markdownLocalSearch.response.projectId === currentProject.id && <section className="markdown-local-search-results" data-testid="markdown-local-search-results" aria-label="Markdown 搜索结果">
                        <p className="project-tree-message">找到 {markdownLocalSearch.response.results.length} 项 · {markdownLocalSearch.response.scanComplete ? '扫描完整' : '部分结果'}</p>
                        {markdownLocalSearch.response.results.map((result) => <button type="button" className="markdown-local-search-result" key={result.path} data-testid={`markdown-local-result-${result.path}`} onClick={() => void openMarkdownSearchResult(currentProject, result, markdownLocalSearch.response.query)}>
                          <strong>{result.title}</strong><small>{result.path}{result.matchLine ? ` · 第 ${result.matchLine} 行` : ''}</small><span>{result.snippet}</span>
                        </button>)}
                        {markdownLocalSearch.response.results.length === 0 && <p className="project-tree-message">未找到匹配文档。</p>}
                        {markdownLocalSearch.response.warning && <p className="project-tree-message is-warning" role="status">{markdownLocalSearch.response.warning}</p>}
                        {markdownLocalSearch.response.errors.length > 0 && <p className="project-tree-message is-warning" role="status">有 {markdownLocalSearch.response.errors.length} 个文档未能搜索：{markdownLocalSearch.response.errors.slice(0, 3).map((error) => `${error.relativePath}（${error.message}）`).join('；')}</p>}
                      </section>}
                      {treeState?.status === 'loading' && !tree && <p className="project-tree-message" role="status">正在扫描 Markdown…</p>}
                      {treeState?.status === 'error' && !tree && <button type="button" className="project-tree-message is-error" onClick={() => refreshProjectMarkdown(currentProject)}>{treeState.message} · 重试</button>}
                      {tree?.roots.length === 0 && <p className="project-tree-message">未发现 Markdown 文档</p>}
                      {tree && <MarkdownDirectoryTree project={currentProject} roots={tree.roots} expandedPaths={expandedPaths} activePath={selectedPath} onTogglePath={(path) => toggleMarkdownPath(currentProject.id, path)} onSelect={(path) => openMarkdownFile(currentProject, path)} />}
                      {tree && !tree.scanComplete && <button type="button" className="project-tree-message is-warning" title={tree.warning} disabled={treeState?.status === 'loading'} onClick={() => refreshProjectMarkdown(currentProject)}>{tree.warning ?? '目录扫描不完整'} · 重试</button>}
                      {treeState?.status === 'error' && tree && <p className="project-tree-message is-error" role="alert">刷新失败：{treeState.message}</p>}
                    </aside>}
                    {markdownTreeOpen && <div
                      className="markdown-workspace-resize-handle"
                      role="separator"
                      aria-label="调整 Markdown 目录宽度"
                      aria-orientation="vertical"
                      aria-valuemin={180}
                      aria-valuemax={440}
                      aria-valuenow={markdownTreeWidth}
                      tabIndex={0}
                      data-testid="markdown-tree-resize-handle"
                      onPointerDown={(event) => { event.preventDefault(); markdownTreeResizePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }}
                      onPointerMove={(event) => {
                        if (markdownTreeResizePointer.current !== event.pointerId) return;
                        const layout = markdownLayoutRef.current;
                        if (!layout) return;
                        const maxWidth = Math.max(180, Math.min(440, layout.clientWidth - (markdownInspectorOpen ? markdownInspectorWidth + 8 : 0) - 360));
                        setMarkdownTreeWidth(Math.max(180, Math.min(maxWidth, event.clientX - layout.getBoundingClientRect().left)));
                      }}
                      onPointerUp={(event) => { if (markdownTreeResizePointer.current !== event.pointerId) return; markdownTreeResizePointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
                      onPointerCancel={() => { markdownTreeResizePointer.current = null; }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') setMarkdownTreeWidth((width) => Math.max(180, width - 16));
                        if (event.key === 'ArrowRight') setMarkdownTreeWidth((width) => Math.min(440, width + 16));
                        if (event.key === 'Home') setMarkdownTreeWidth(180);
                        if (event.key === 'End') setMarkdownTreeWidth(440);
                      }}
                    />}
                    <article ref={markdownArticleRef} className="markdown-workspace-article" aria-live="polite" onMouseUp={captureMarkdownSelection} onKeyUp={captureMarkdownSelection} onScroll={(event) => {
                      const article = event.currentTarget;
                      const headings = typeof article.querySelectorAll === 'function'
                        ? [...article.querySelectorAll<HTMLElement>('[data-markdown-heading="true"]')]
                        : [];
                      const articleTop = article.getBoundingClientRect?.().top ?? 0;
                      const activeHeading = headings.filter((heading) => heading.getBoundingClientRect().top <= articleTop + 72).at(-1) ?? headings[0];
                      if (activeHeading?.id) setActiveMarkdownHeading(activeHeading.id);
                      if (!selectedPath) return;
                      const scrollTop = article.scrollTop;
                      if (markdownScrollTimer.current) globalThis.clearTimeout(markdownScrollTimer.current);
                      const sessionKey = markdownSessionKey(currentProject.id, selectedPath);
                      markdownScrollTimer.current = globalThis.setTimeout(() => {
                        setPreferences((current) => ({
                          ...current,
                          markdownScrollPositions: { ...current.markdownScrollPositions, [sessionKey]: scrollTop },
                        }));
                        markdownScrollTimer.current = null;
                      }, 160);
                    }}>
                      {markdownLinkMessage && <p className="project-tree-message is-error" role="alert">{markdownLinkMessage}</p>}
                      {markdownSearchMessage && <p className="project-tree-message is-error" role="alert" data-testid="markdown-search-message">{markdownSearchMessage}</p>}
                      {markdownSaveMessage && <p className="project-message" role="status" data-testid="markdown-save-success">{markdownSaveMessage}</p>}
                      {!selectedPath && <div className="empty-state"><h3>选择一篇 Markdown 文档</h3><p>点击左侧目录中的文件开始阅读。</p></div>}
                      {selectedPath && markdownDocument.status === 'loading' && markdownDocument.path === selectedPath && <p role="status">正在读取 {selectedPath}…</p>}
                      {selectedPath && markdownDocument.status === 'error' && markdownDocument.path === selectedPath && <div className="empty-state"><h3>无法打开此文档</h3><p className="error-message" role="alert">{markdownDocument.message}</p><button type="button" className="secondary-button" onClick={() => refreshProjectMarkdown(currentProject)}>刷新目录</button></div>}
                      {markdownDocumentForView && !markdownEditorOpen && !markdownPreviewOpen && <>
                        {markdownSaveError && <div className="markdown-save-error" role="alert"><p>{markdownSaveError}</p><button type="button" className="secondary-button" onClick={() => void loadMarkdownDiskVersion()}>查看磁盘版本</button></div>}
                        {markdownDraftDirtyForView && markdownDraftForView && <div className="markdown-draft-banner" data-testid="markdown-saved-draft">
                          <span>此文档有未保存草稿。保留草稿不会修改磁盘原文件。</span>
                          <button type="button" className="secondary-button" onClick={startMarkdownEdit}>继续编辑</button>
                          <button type="button" className="secondary-button" onClick={() => void service.copyText(markdownDraftForView.content)}>复制草稿</button>
                          <button type="button" className="danger-button" onClick={discardMarkdownDraft}>放弃草稿</button>
                        </div>}
                        <p className="eyebrow">{markdownDocumentForView.relativePath}</p><h1>{markdownDocumentForView.title}</h1>
                        <MarkdownDocumentRenderer content={markdownDocumentForView.content} projectId={currentProject.id} documentPath={markdownDocumentForView.relativePath} readAsset={readMarkdownAsset} onOpenRelativeLink={(href) => openMarkdownRelativeLink(currentProject, markdownDocumentForView.relativePath, href)} onOpenExternalLink={(href) => void openExternalMarkdownLink(href)} />
                      </>}
                      {markdownDocumentForView && markdownEditorOpen && markdownDraftForView && <section className="markdown-editor-view" data-testid="markdown-editor-view" aria-label="编辑 Markdown 原文件">
                        <div className="markdown-editor-heading"><div><p className="eyebrow">编辑原文件</p><h1>{markdownDraftForView.relativePath}</h1><p>内容只保存在当前编辑草稿中；预览后需明确确认才会写回原文件。</p></div></div>
                        <textarea data-testid="markdown-editor-input" aria-label="Markdown 原文编辑器" value={markdownDraftForView.content} onChange={(event) => updateMarkdownDraft(event.currentTarget.value)} spellCheck={false} />
                        {markdownSaveError && <div className="markdown-save-error" role="alert"><p>{markdownSaveError}</p><div><button type="button" className="secondary-button" onClick={() => void loadMarkdownDiskVersion()}>查看磁盘版本</button><button type="button" className="secondary-button" onClick={() => void service.copyText(markdownDraftForView.content)}>复制草稿</button></div></div>}
                        <div className="markdown-editor-actions"><button type="button" className="secondary-button" disabled={markdownSaveBusy} onClick={discardMarkdownDraft}>放弃编辑</button><button type="button" className="primary-button" data-testid="markdown-preview-button" disabled={!markdownDraftDirtyForView || markdownSaveBusy} onClick={() => { setMarkdownEditorOpen(false); setMarkdownPreviewOpen(true); }}>预览改动</button></div>
                      </section>}
                      {markdownDocumentForView && markdownPreviewOpen && markdownDraftForView && <section className="markdown-edit-preview" data-testid="markdown-edit-preview" aria-label="Markdown 保存预览">
                        <div className="markdown-editor-heading"><div><p className="eyebrow">写回前预览</p><h1>{markdownDraftForView.relativePath}</h1><p>保存前会重新校验文件路径和原文修订；发现外部修改时不会覆盖。</p></div></div>
                        {markdownSaveError && <div className="markdown-save-error" role="alert"><p>{markdownSaveError}</p><div><button type="button" className="secondary-button" onClick={() => void loadMarkdownDiskVersion()}>重新比较磁盘版本</button><button type="button" className="secondary-button" onClick={() => void service.copyText(markdownDraftForView.content)}>复制草稿</button></div></div>}
                        <div className="markdown-preview-rendered"><p className="eyebrow">渲染预览</p><h2>{markdownDocumentForView.title}</h2><MarkdownDocumentRenderer content={markdownDraftForView.content} projectId={currentProject.id} documentPath={markdownDraftForView.relativePath} readAsset={readMarkdownAsset} onOpenRelativeLink={(href) => openMarkdownRelativeLink(currentProject, markdownDraftForView.relativePath, href)} onOpenExternalLink={(href) => void openExternalMarkdownLink(href)} /></div>
                        <details className="markdown-diff-details" open><summary>比较原文与草稿</summary><div className="markdown-diff-columns"><section><h3>{markdownRemoteDocument?.relativePath === markdownDraftForView.relativePath ? '磁盘当前版本' : '磁盘原文'}</h3><pre>{markdownRemoteDocument?.relativePath === markdownDraftForView.relativePath ? markdownRemoteDocument.content : markdownDraftForView.baseContent}</pre></section><section><h3>待写入草稿</h3><pre>{markdownDraftForView.content}</pre></section></div></details>
                        <div className="markdown-editor-actions"><button type="button" className="secondary-button" disabled={markdownSaveBusy} onClick={() => { setMarkdownPreviewOpen(false); setMarkdownEditorOpen(true); }}>返回编辑</button><button type="button" className="secondary-button" disabled={markdownSaveBusy} onClick={discardMarkdownDraft}>放弃草稿</button><button type="button" className="primary-button" data-testid="markdown-save-confirm" disabled={!markdownDraftDirtyForView || markdownSaveBusy} onClick={() => void saveMarkdownDraft()}>{markdownSaveBusy ? '正在保存…' : '确认并写回原文件'}</button></div>
                      </section>}
                    </article>
                    {markdownInspectorOpen && <div
                      className="markdown-workspace-resize-handle markdown-inspector-resize-handle"
                      role="separator"
                      aria-label="调整 Markdown 阅读侧栏宽度"
                      aria-orientation="vertical"
                      aria-valuemin={220}
                      aria-valuemax={480}
                      aria-valuenow={markdownInspectorWidth}
                      tabIndex={0}
                      data-testid="markdown-inspector-resize-handle"
                      onPointerDown={(event) => { event.preventDefault(); markdownInspectorResizePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }}
                      onPointerMove={(event) => {
                        if (markdownInspectorResizePointer.current !== event.pointerId) return;
                        const layout = markdownLayoutRef.current;
                        if (!layout) return;
                        const maxWidth = Math.max(220, Math.min(480, layout.clientWidth - (markdownTreeOpen ? markdownTreeWidth + 8 : 0) - 360 - 8));
                        setMarkdownInspectorWidth(Math.max(220, Math.min(maxWidth, layout.getBoundingClientRect().right - event.clientX - 8)));
                      }}
                      onPointerUp={(event) => { if (markdownInspectorResizePointer.current !== event.pointerId) return; markdownInspectorResizePointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
                      onPointerCancel={() => { markdownInspectorResizePointer.current = null; }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') setMarkdownInspectorWidth((width) => Math.min(480, width + 16));
                        if (event.key === 'ArrowRight') setMarkdownInspectorWidth((width) => Math.max(220, width - 16));
                        if (event.key === 'Home') setMarkdownInspectorWidth(220);
                        if (event.key === 'End') setMarkdownInspectorWidth(480);
                      }}
                    />}
                    {markdownInspectorOpen && <aside className="markdown-workspace-inspector" data-testid="markdown-workspace-inspector" aria-label="Markdown 阅读辅助" style={{ width: `${markdownInspectorWidth}px` }}>
                      <div className="markdown-inspector-tabs" role="tablist" aria-label="Markdown 阅读工具">
                        <button type="button" role="tab" id="markdown-inspector-outline-tab" aria-selected={markdownInspectorTab === 'outline'} aria-controls="markdown-inspector-panel" onClick={() => setMarkdownInspectorTab('outline')}>大纲</button>
                        <button type="button" role="tab" id="markdown-inspector-ask-tab" aria-selected={markdownInspectorTab === 'ask'} aria-controls="markdown-inspector-panel" onClick={() => setMarkdownInspectorTab('ask')}>Ask AI</button>
                      </div>
                      {markdownInspectorTab === 'outline'
                        ? <nav className="markdown-outline-list" id="markdown-inspector-panel" role="tabpanel" aria-labelledby="markdown-inspector-outline-tab" aria-label="文章大纲">
                          {markdownOutline.length === 0 ? <p className="markdown-inspector-empty">{selectedPath ? '本文没有可导航的标题' : '打开文档后显示标题大纲'}</p> : markdownOutline.map((heading) => <button
                            key={heading.id}
                            type="button"
                            data-testid={`markdown-outline-heading-${heading.id}`}
                            className={`markdown-outline-item${activeMarkdownHeading === heading.id ? ' is-active' : ''}${hoveredMarkdownHeading === heading.id ? ' is-hovered' : ''}`}
                            style={{ paddingInlineStart: `${10 + Math.min(heading.level - 1, 5) * 12}px` }}
                            aria-current={activeMarkdownHeading === heading.id ? 'location' : undefined}
                            title={heading.title}
                            onMouseEnter={() => setHoveredMarkdownHeading(heading.id)}
                            onMouseLeave={() => setHoveredMarkdownHeading(null)}
                            onFocus={() => setHoveredMarkdownHeading(heading.id)}
                            onBlur={() => setHoveredMarkdownHeading(null)}
                            onClick={() => { if (jumpToMarkdownHeading(heading.id)) setActiveMarkdownHeading(heading.id); }}
                          >{heading.title}</button>)}</nav>
                        : <section className="markdown-ask-panel" id="markdown-inspector-panel" role="tabpanel" aria-labelledby="markdown-inspector-ask-tab" data-testid="markdown-ask-panel">
                          <p className="eyebrow">当前文档</p>
                          <h3>{markdownDocumentForView?.title ?? '尚未选择文档'}</h3>
                          <p className="markdown-ask-privacy" role="note">发送前提示：提问会将当前文件正文、问题{markdownAskSelectedText ? '及所选文字' : ''}发送给 Hub 已配置的模型；不会读取其他文件，也不会自动修改原文。</p>
                          {markdownAskSelectedText && <div className="markdown-ask-selection" data-testid="markdown-ask-selection"><div><strong>所选文字</strong><button type="button" className="text-button" onClick={() => setMarkdownAskSelectedText('')}>清除</button></div><p>{markdownAskSelectedText}</p></div>}
                          <form className="markdown-ask-form" data-testid="markdown-ask-form" onSubmit={(event) => { event.preventDefault(); void askMarkdownQuestion(); }}>
                            <textarea data-testid="markdown-ask-question" aria-label="询问当前 Markdown 文档" placeholder="Ask about this document…" value={markdownAskQuestion} onChange={(event) => setMarkdownAskQuestion(event.currentTarget.value)} disabled={!markdownDocumentForView || markdownAskState.status === 'loading'} />
                            <button type="submit" className="primary-button" data-testid="markdown-ask-submit" disabled={!markdownDocumentForView || !markdownAskQuestion.trim() || markdownAskState.status === 'loading' || new TextEncoder().encode(markdownAskSelectedText).byteLength > 12 * 1024 || new TextEncoder().encode(markdownAskQuestion).byteLength > 20 * 1024}>{markdownAskState.status === 'loading' ? '正在询问…' : 'Ask'}</button>
                          </form>
                          {markdownAskState.status === 'loading' && markdownAskState.projectId === currentProject.id && markdownAskState.path === selectedPath && <p role="status">正在发送当前文档并等待模型回答…</p>}
                          {markdownAskState.status === 'error' && markdownAskState.projectId === currentProject.id && markdownAskState.path === selectedPath && <p className="markdown-ask-error" role="alert" data-testid="markdown-ask-error">{markdownAskState.message}</p>}
                          {markdownAskState.status === 'ready' && markdownAskState.response.projectId === currentProject.id && markdownAskState.response.path === selectedPath && <section className="markdown-ask-answer" data-testid="markdown-ask-answer">
                            <p className="markdown-ask-source">来源：{markdownAskState.response.path} · 模型：{markdownAskState.response.model}</p>
                            <div>{markdownAskState.response.answer}</div>
                            <div className="markdown-ask-answer-actions"><button type="button" className="secondary-button" onClick={() => void service.copyText(markdownAskState.response.answer)}>复制回答</button><button type="button" className="secondary-button" data-testid="markdown-ask-adopt" onClick={() => appendMarkdownAnswerToDraft(markdownAskState.response)}>加入编辑草稿</button></div>
                            <p className="markdown-ask-readonly-note">回答不会自动写入。加入草稿后仍需编辑、预览并确认，才会写回原文件。</p>
                          </section>}
                      </section>}
                    </aside>}
                    {markdownLeavePromptOpen && <div className="markdown-leave-overlay" role="presentation"><section className="markdown-leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="markdown-leave-title" aria-describedby="markdown-leave-description" data-testid="markdown-leave-dialog">
                      <p className="eyebrow">未保存的 Markdown 草稿</p><h2 id="markdown-leave-title">离开当前文档？</h2><p id="markdown-leave-description">草稿尚未写回原文件。你可以保留草稿稍后继续、明确放弃，或留在当前页面。</p>
                      <div className="markdown-editor-actions"><button type="button" className="secondary-button" data-testid="markdown-leave-cancel" onClick={() => resolveMarkdownLeavePrompt('cancel')}>继续编辑</button><button type="button" className="danger-button" data-testid="markdown-leave-discard" onClick={() => resolveMarkdownLeavePrompt('discard')}>放弃草稿并离开</button><button type="button" className="primary-button" data-testid="markdown-leave-keep" onClick={() => resolveMarkdownLeavePrompt('keep')}>保留草稿并离开</button></div>
                    </section></div>}
                    {markdownSourcePreview.status !== 'closed' && <WikiSourcePreview path={markdownSourcePreview.path} content={markdownSourcePreview.status === 'ready' ? markdownSourcePreview.content : null} loading={markdownSourcePreview.status === 'loading'} error={markdownSourcePreview.status === 'error' ? markdownSourcePreview.message : null} onClose={() => { markdownSourceGeneration.current += 1; setMarkdownSourcePreview({ status: 'closed' }); }} />}
                  </div>
                </section>
              );
            })()}
            {workspaceSection === 'source' && <div className="project-source-workspace"><div className="section-heading-row"><div><p className="eyebrow">关联代码</p><h2>源文件</h2><p>仅查看当前 Wiki 页面声明的关联文件。</p></div></div>{associatedSources.length === 0 ? <div className="empty-state"><h3>暂无关联源文件</h3><p>先打开一个 Wiki；页面关联的文件会显示在这里。</p><button type="button" className="secondary-button" onClick={() => navigate({ view: 'project', projectId: currentProject.id, projectSection: 'wiki' })}>返回 Wiki</button></div> : <div className="source-browser"><nav className="source-file-list" aria-label="Wiki 关联源文件">{associatedSources.map((path) => <button type="button" key={path} className={source.status !== 'closed' && source.path === path ? 'is-active' : ''} onClick={() => void readProjectSource(currentProject, sourceProvider, path)}><HubIcon name="code" />{path}</button>)}</nav><section className="source-preview" aria-live="polite">{source.status === 'closed' && <p>选择左侧文件进行只读查看。</p>}{source.status === 'loading' && <p>正在读取 {source.path}…</p>}{source.status === 'error' && <p className="error-message" role="alert">{source.message}</p>}{source.status === 'ready' && <><h3>{source.path}</h3><pre data-testid="source-content-text"><code>{source.content}</code></pre></>}</section></div>}</div>}
            {workspaceSection === 'maintenance' && <div className="project-maintenance">
              <div className="section-heading-row"><div><p className="eyebrow">Wiki 生命周期</p><h2>维护</h2><p>每个任务明确绑定 Wiki 实例；失败续跑继续作用于原目录。</p></div><button type="button" className="secondary-button" onClick={() => refreshProjectWikis(currentProject)}>重新扫描 Wiki</button></div>
              <div className="maintenance-provider-grid">
                {wikiListingOf(wikiTreeStates[currentProject.id])?.instances.map((instance) => {
                  const provider = instance.provider;
                  const healthItem = health.status === 'ready' ? health.health.providers.find((item) => item.provider === provider) : undefined;
                  const disabled = instance.status === 'invalid' || busyAction || taskBusy;
                  return <article className="overview-provider-card" key={instance.wikiId} data-testid={`maintenance-instance-${instance.wikiId}`}>
                    <div><span className="summary-icon summary-green"><HubIcon name="provider" /></span><span><strong>{instance.label}</strong><small>{healthItem ? providerSummary(healthItem) : `状态：${instance.status}`}</small></span></div>
                    <div className="maintenance-actions">
                      <button type="button" className="primary-button" data-testid={`maintenance-generate-${instance.wikiId}`} disabled={disabled || (provider === 'zread' ? !zreadReady : !openZreadReady)} onClick={() => void startTask(currentProject, provider === 'zread' ? 'generate-zread' : 'generate-open', instance.wikiId)}>生成</button>
                      {provider === 'open_zread' && <button type="button" className="secondary-button" data-testid={`maintenance-sync-${instance.wikiId}`} disabled={disabled || !openZreadReady} onClick={() => void startTask(currentProject, 'sync-open', instance.wikiId)}>同步</button>}
                      <button type="button" className="secondary-button" disabled={instance.status === 'invalid'} onClick={() => void openWiki(currentProject, provider, undefined, undefined, instance.wikiId)}>阅读与历史</button>
                    </div>
                  </article>;
                })}
                {(['open_zread', 'zread'] as const).filter((provider) => !wikiListingOf(wikiTreeStates[currentProject.id])?.instances.some((instance) => instance.sourceRoot === '.' && instance.provider === provider)).map((provider) => {
                  const healthItem = health.status === 'ready' ? health.health.providers.find((item) => item.provider === provider) : undefined;
                  const wikiId = `${provider}@.`;
                  return <article className="overview-provider-card" key={wikiId} data-testid={`maintenance-instance-${wikiId}`}>
                    <div><span className="summary-icon summary-green"><HubIcon name="provider" /></span><span><strong>根目录 · {providerNames[provider]}</strong><small>{healthItem ? providerSummary(healthItem) : '健康状态未知'} · 尚无实例</small></span></div>
                    <div className="maintenance-actions"><button type="button" className="primary-button" disabled={provider === 'zread' ? !zreadReady || busyAction || taskBusy : !openZreadReady || busyAction || taskBusy} onClick={() => void startTask(currentProject, provider === 'zread' ? 'generate-zread' : 'generate-open', wikiId)}>生成</button></div>
                  </article>;
                })}
                {!wikiListingOf(wikiTreeStates[currentProject.id]) && <p className="project-message" role="status">正在加载 Wiki 实例清单；也可使用上方按钮重新扫描。</p>}
              </div>
              {taskMessage && <p className="project-message" role="status">{taskMessage}</p>}
            </div>}
            {workspaceSection === 'settings' && <div className="project-settings"><div className="section-heading-row"><div><p className="eyebrow">项目管理</p><h2>项目设置</h2><p>这些操作只改变 Hub 的项目注册或访问位置，不删除 Wiki/源文件。</p></div></div><dl className="project-settings-details"><div><dt>项目路径</dt><dd>{currentProject.path}</dd></div><div><dt>项目类型</dt><dd>{currentProject.sourceControl === 'git' ? 'Git 项目' : '本地项目'}</dd></div><div><dt>可访问性</dt><dd>{currentProject.availabilityReason ?? currentProject.availability}</dd></div></dl><div className="project-settings-actions"><button type="button" className="secondary-button" onClick={() => void projectAction(currentProject, 'folder')}>打开文件夹</button><button type="button" className="secondary-button" onClick={() => void projectAction(currentProject, 'terminal')}>打开终端</button><button type="button" className="secondary-button" onClick={() => void projectAction(currentProject, 'copy')}>复制路径</button><button type="button" className="secondary-button" onClick={() => void projectAction(currentProject, 'relocate')}>重新定位</button><button type="button" className="danger-button" onClick={() => void projectAction(currentProject, 'remove')}>从项目库移除…</button></div>{projectMessage && <p className="project-message" role="status">{projectMessage}</p>}</div>}
          </section>}

          {location.view === 'tasks' && <section className="page-section task-page"><div className="page-heading"><div><p className="eyebrow">可观测任务</p><h1>任务</h1><p>这里只展示本次工作区会话中服务实际报告的任务，不显示伪造的历史记录。</p></div><span className={`status-dot status-${taskBusy ? 'healthy' : 'checking'}`} /></div>{activeTask ? renderTaskSummary() : <div className="empty-state"><h3>当前没有任务</h3><p>从项目概览或维护页启动 Wiki 生成/同步后，进度会显示在这里。</p><button type="button" className="secondary-button" onClick={() => navigate({ view: 'projects' })}>浏览项目</button></div>}{lastEvent && <p className="task-event" data-testid="last-task-event">最近服务事件：{lastEvent.phase}: {lastEvent.status}</p>}</section>}

          {location.view === 'providers' && <section className="page-section provider-page"><div className="page-heading"><div><p className="eyebrow">运行环境</p><h1>Provider 与服务</h1><p>检查实际检测到的生成器、配置和能力状态。</p></div><button type="button" className="secondary-button" onClick={() => void loadHealth()}>重新检查</button></div>{health.status === 'loading' && <p className="empty-state" aria-busy="true">正在检查 Provider…</p>}{health.status === 'error' && <div className="project-error" role="alert"><p>{health.message}</p><button type="button" className="secondary-button" onClick={() => void loadHealth()}>重试</button></div>}{health.status === 'ready' && <><section className="provider-service-card"><div className="health-heading"><span className={`status-dot status-${statusLabel}`} /><h3>Hub Application Service</h3><strong data-testid="service-status">{statusLabel}</strong></div><dl className="health-details"><div><dt>版本</dt><dd data-testid="app-version">{health.health.appVersion}</dd></div><div><dt>运行环境</dt><dd>{health.health.runtime} · {health.health.os}</dd></div><div><dt>OpenZread Runner</dt><dd data-testid="runner-status">{health.health.runner.status}</dd></div><div><dt>Runner 版本</dt><dd data-testid="runner-version">{health.health.runner.version}</dd></div><div className="health-detail-path"><dt>Runner 路径</dt><dd data-testid="runner-path">{health.health.runner.executablePath}</dd></div></dl></section><div className="provider-health-grid">{health.health.providers.map(renderProviderCard)}</div>{providerMessage && <p className="error-message" role="alert">{providerMessage}</p>}</>}</section>}

          {location.view === 'settings' && <section className="page-section settings-page"><div className="page-heading"><div><p className="eyebrow">应用偏好</p><h1>设置</h1><p>应用信息与本地阅读偏好。</p></div></div><article className="settings-card"><h2>Open Zread Hub</h2><p>Windows 优先的本地项目 Wiki 阅读与维护工作区。</p>{health.status === 'ready' && <dl className="project-settings-details"><div><dt>应用版本</dt><dd>{health.health.appVersion}</dd></div><div><dt>运行环境</dt><dd>{health.health.runtime} · {health.health.os}</dd></div><div><dt>阅读偏好</dt><dd>导航、Provider 与章节位置保存在本机浏览器存储中。</dd></div></dl>}<button type="button" className="secondary-button" onClick={() => navigate({ view: 'providers' })}>Provider 与诊断</button></article></section>}

          {location.view === 'project' && !currentProject && <div className="empty-state" role="status">正在载入项目…</div>}
        </main>
        {location.view !== 'tasks' && renderTaskSummary()}
      </div>
    </div>
  );
}

export default HubApplication;
