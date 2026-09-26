import type { KeyboardEvent } from 'react';
import type { HubProject, HubProjectMarkdownTree, HubWikiInstance, HubWikiInstanceList } from '@open-zread/hub-contract';
import { HubIcon } from './HubIcon';
import { MarkdownDirectoryTree } from './MarkdownDirectoryTree';

export type WikiTreeState =
  | { status: 'loading'; previous?: HubWikiInstanceList }
  | { status: 'ready'; listing: HubWikiInstanceList }
  | { status: 'error'; message: string; previous?: HubWikiInstanceList };

export function wikiListingOf(state: WikiTreeState | undefined): HubWikiInstanceList | undefined {
  if (!state) return undefined;
  if (state.status === 'ready') return state.listing;
  return state.previous;
}

export type MarkdownTreeState =
  | { status: 'loading'; previous?: HubProjectMarkdownTree }
  | { status: 'ready'; tree: HubProjectMarkdownTree }
  | { status: 'error'; message: string; previous?: HubProjectMarkdownTree };

export function markdownTreeOf(state: MarkdownTreeState | undefined): HubProjectMarkdownTree | undefined {
  if (!state) return undefined;
  if (state.status === 'ready') return state.tree;
  return state.previous;
}

function focusTreeItem(items: HTMLElement[], target?: HTMLElement) {
  if (!target) return;
  for (const item of items) item.tabIndex = item === target ? 0 : -1;
  target.focus();
}

export function handleProjectLibraryTreeKeyDown(
  event: KeyboardEvent<HTMLElement>,
  root: HTMLElement,
  onEscape: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onEscape();
    return;
  }
  const item = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
  if (!item) return;
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    item.click();
    return;
  }
  const items = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const itemId = item.dataset.treeItemId;
  const parentId = item.dataset.treeParentId;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = items.indexOf(item);
    focusTreeItem(items, items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusTreeItem(items, event.key === 'Home' ? items[0] : items.at(-1));
    return;
  }
  if (event.key === 'ArrowRight') {
    const expandable = item.getAttribute('aria-expanded') !== null;
    const expanded = item.getAttribute('aria-expanded') === 'true';
    if (!expandable) return;
    event.preventDefault();
    const firstChild = () => items.find((candidate) => candidate.dataset.treeParentId === itemId);
    if (!expanded) {
      item.parentElement?.querySelector<HTMLElement>('.project-tree-expand')?.click();
      globalThis.setTimeout(() => {
        const currentItems = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
        focusTreeItem(currentItems, currentItems.find((candidate) => candidate.dataset.treeParentId === itemId));
      }, 0);
    } else {
      focusTreeItem(items, firstChild());
    }
    return;
  }
  if (event.key === 'ArrowLeft') {
    const expanded = item.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      event.preventDefault();
      item.parentElement?.querySelector<HTMLElement>('.project-tree-expand')?.click();
    } else if (parentId) {
      event.preventDefault();
      focusTreeItem(items, items.find((candidate) => candidate.dataset.treeItemId === parentId));
    }
  }
}

export function ProjectLibraryTree({
  projects,
  expandedProjectIds,
  states,
  markdownStates,
  activeProjectId,
  activeWikiId,
  activeMarkdownPath,
  expandedMarkdownPaths,
  onToggleProject,
  onToggleMarkdownPath,
  onOpenProject,
  onRefresh,
  onLocate,
  onRefreshMarkdown,
  onEscape,
  onOpenWiki,
  onOpenMarkdown,
}: {
  projects: HubProject[];
  expandedProjectIds: string[];
  states: Record<string, WikiTreeState>;
  markdownStates: Record<string, MarkdownTreeState>;
  activeProjectId?: string;
  activeWikiId?: string;
  activeMarkdownPath?: string;
  expandedMarkdownPaths: Record<string, string[]>;
  onToggleProject: (projectId: string) => void;
  onToggleMarkdownPath: (projectId: string, relativePath: string) => void;
  onOpenProject: (project: HubProject) => void;
  onRefresh: (project: HubProject) => void;
  onLocate: (project: HubProject) => void;
  onRefreshMarkdown: (project: HubProject) => void;
  onEscape: () => void;
  onOpenWiki: (project: HubProject, wiki: HubWikiInstance) => void;
  onOpenMarkdown: (project: HubProject, relativePath: string) => void;
}) {
  return (
    <nav id="project-library-tree" className="project-library-tree" aria-label="项目与 Wiki 树">
      <div
        role="tree"
        aria-label="项目库"
        onKeyDown={(event) => handleProjectLibraryTreeKeyDown(event, event.currentTarget, onEscape)}
        onFocusCapture={(event) => {
          const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
          if (target) focusTreeItem([...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')], target);
        }}
      >
        {projects.map((project, projectIndex) => {
          const expanded = expandedProjectIds.includes(project.id);
          const state = states[project.id];
          const wikiListing = wikiListingOf(state);
          const markdownState = markdownStates[project.id];
          const markdownTree = markdownTreeOf(markdownState);
          return (
            <div className="project-tree-branch" key={project.id}>
              <div className="project-tree-row">
              <button
                type="button"
                role="treeitem"
                tabIndex={projectIndex === 0 ? 0 : -1}
                data-tree-item-id={`project:${project.id}`}
                data-project-tree-id={project.id}
                aria-level={1}
                aria-expanded={expanded}
                aria-posinset={projectIndex + 1}
                aria-setsize={projects.length}
                aria-current={activeProjectId === project.id ? 'page' : undefined}
                className={`project-tree-item${activeProjectId === project.id ? ' is-active' : ''}`}
                title={project.path}
                onClick={() => onOpenProject(project)}
              >
                <HubIcon name="folder" />
                <span className="project-tree-label">{project.name}</span>
              </button>
              <button type="button" className={`project-tree-expand${expanded ? ' is-expanded' : ''}`} aria-label={`${expanded ? '收起' : '展开'} ${project.name}`} aria-expanded={expanded} onClick={() => onToggleProject(project.id)}><HubIcon name="chevron" /></button>
              </div>
              {expanded && (
                <div className="project-tree-children" role="group">
                  <div className="project-tree-wiki-heading">
                    <span>Wiki</span>
                    <span className="project-tree-heading-actions">
                      <button type="button" className="icon-button" aria-label={`定位 ${project.name} 的 Wiki 子目录`} title="定位未扫描到的 Wiki 子目录" disabled={state?.status === 'loading'} onClick={() => onLocate(project)}><HubIcon name="folder" /></button>
                      <button type="button" className="icon-button" aria-label={`重新扫描 ${project.name} 的 Wiki`} title="重新扫描 Wiki" disabled={state?.status === 'loading'} onClick={() => onRefresh(project)}><HubIcon name="refresh" /></button>
                    </span>
                  </div>
                  {state?.status === 'loading' && <span className="project-tree-message" role="status">{wikiListing ? '正在扫描，暂时保留现有 Wiki…' : '正在扫描…'}</span>}
                  {state?.status === 'error' && wikiListing && <span className="project-tree-message is-error" role="alert">扫描失败：{state.message}</span>}
                  {state?.status === 'error' && !wikiListing && <button type="button" className="project-tree-message is-error" onClick={() => onRefresh(project)}>{state.message} · 重试</button>}
                  {wikiListing?.instances.length === 0 && <span className="project-tree-message">未发现 Wiki</span>}
                  {wikiListing?.instances.map((wiki) => (
                    <button
                      type="button"
                      role="treeitem"
                      tabIndex={-1}
                      key={wiki.wikiId}
                      data-tree-item-id={`wiki:${project.id}:${wiki.wikiId}`}
                      data-tree-parent-id={`project:${project.id}`}
                      data-parent-project={project.id}
                      aria-level={2}
                      aria-current={activeProjectId === project.id && activeWikiId === wiki.wikiId ? 'page' : undefined}
                      className={`project-tree-item project-tree-wiki${activeProjectId === project.id && activeWikiId === wiki.wikiId ? ' is-active' : ''}`}
                      title={`${wiki.sourceRoot} · ${wiki.status}`}
                      onClick={() => onOpenWiki(project, wiki)}
                    >
                      <HubIcon name="book" />
                      <span className="project-tree-label">{wiki.label}</span>
                      {wiki.status !== 'readable' && <small>{wiki.status === 'partial' ? '部分' : '无效'}</small>}
                    </button>
                  ))}
                  {wikiListing && !wikiListing.scanComplete && <span className="project-tree-message is-warning" title={wikiListing.warning}>{wikiListing.warning ?? '扫描不完整'}</span>}
                  <div className="project-tree-wiki-heading project-tree-markdown-heading">
                    <span>Markdown</span>
                    <button type="button" className="project-tree-markdown-refresh" aria-label={`刷新 ${project.name} 的 Markdown 目录树`} title="重新检索项目中的 Markdown 文件并更新目录树" disabled={markdownStates[project.id]?.status === 'loading'} onClick={() => onRefreshMarkdown(project)}>
                      <HubIcon name="refresh" />刷新
                    </button>
                  </div>
                  {markdownState?.status === 'loading' && !markdownTree && <span className="project-tree-message" role="status">正在扫描 Markdown…</span>}
                  {markdownState?.status === 'error' && !markdownTree && <span className="project-tree-message is-error" role="alert">{markdownState.message}</span>}
                  {markdownState?.status === 'error' && markdownTree && <span className="project-tree-message is-error" role="alert">刷新失败：{markdownState.message}</span>}
                  {markdownTree && (() => {
                    const tree = markdownTree;
                    const expandedPaths = expandedMarkdownPaths[project.id] ?? [];
                    return <>
                      {markdownState?.status === 'loading' && <span className="project-tree-message" role="status">正在刷新，暂时保留现有目录…</span>}
                      {tree.roots.length === 0 && <span className="project-tree-message">未发现 Markdown 文档</span>}
                      {tree.roots.length > 0 && <MarkdownDirectoryTree
                        project={project}
                        roots={tree.roots}
                        expandedPaths={expandedPaths}
                        activePath={activeProjectId === project.id ? activeMarkdownPath : undefined}
                        onTogglePath={(path) => onToggleMarkdownPath(project.id, path)}
                        onSelect={(path) => onOpenMarkdown(project, path)}
                      />}
                      {!tree.scanComplete && <button type="button" className="project-tree-message is-warning" role="status" title={tree.warning} disabled={markdownState?.status === 'loading'} onClick={() => onRefreshMarkdown(project)}>{tree.warning ?? 'Markdown 目录扫描不完整'} · 重试</button>}
                      {tree.errors.length > 0 && <span className="project-tree-message is-warning" title={tree.errors.map((error) => `${error.relativePath}: ${error.message}`).join('\n')}>{tree.errors.length} 个 Markdown 文件读取失败</span>}
                    </>;
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
