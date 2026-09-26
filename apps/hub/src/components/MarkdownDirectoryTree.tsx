import type { HubMarkdownNode, HubProject } from '@open-zread/hub-contract';
import { HubIcon } from './HubIcon';

function MarkdownNodeRows({
  nodes,
  projectId,
  parentItemId,
  level,
  expandedPaths,
  activePath,
  onTogglePath,
  onSelect,
}: {
  nodes: HubMarkdownNode[];
  projectId: string;
  parentItemId: string;
  level: number;
  expandedPaths: string[];
  activePath?: string;
  onTogglePath: (relativePath: string) => void;
  onSelect: (relativePath: string) => void;
}) {
  return nodes.map((node) => {
    const directory = node.kind === 'directory';
    const expanded = directory && expandedPaths.includes(node.relativePath);
    const active = !directory && activePath === node.relativePath;
    const itemId = `markdown:${projectId}:${node.relativePath}`;
    return (
      <div className="project-tree-branch" key={node.relativePath}>
        <div className="project-tree-row">
          <button
            type="button"
            role="treeitem"
            tabIndex={-1}
            data-tree-item-id={itemId}
            data-tree-parent-id={parentItemId}
            data-markdown-tree-path={node.relativePath}
            aria-level={level}
            aria-expanded={directory ? expanded : undefined}
            aria-current={active ? 'page' : undefined}
            className={`project-tree-item project-tree-markdown-item${active ? ' is-active' : ''}`}
            title={node.relativePath}
            onClick={() => directory ? onTogglePath(node.relativePath) : onSelect(node.relativePath)}
          >
            <HubIcon name={directory ? 'folder' : 'file'} />
            <span className="project-tree-label">{directory ? node.name : node.title || node.name}</span>
          </button>
          {directory && <button type="button" className={`project-tree-expand${expanded ? ' is-expanded' : ''}`} aria-label={`${expanded ? '收起' : '展开'} ${node.name}`} aria-expanded={expanded} onClick={() => onTogglePath(node.relativePath)}><HubIcon name="chevron" /></button>}
        </div>
        {directory && expanded && node.children && <div className="project-tree-children" role="group"><MarkdownNodeRows nodes={node.children} projectId={projectId} parentItemId={itemId} level={level + 1} expandedPaths={expandedPaths} activePath={activePath} onTogglePath={onTogglePath} onSelect={onSelect} /></div>}
      </div>
    );
  });
}

export function MarkdownDirectoryTree({
  project,
  roots,
  expandedPaths,
  activePath,
  onTogglePath,
  onSelect,
}: {
  project: HubProject;
  roots: HubMarkdownNode[];
  expandedPaths: string[];
  activePath?: string;
  onTogglePath: (relativePath: string) => void;
  onSelect: (relativePath: string) => void;
}) {
  return (
    <div className="markdown-directory-tree" aria-label={`${project.name} Markdown 目录`}>
      <MarkdownNodeRows nodes={roots} projectId={project.id} parentItemId={`project:${project.id}`} level={2} expandedPaths={expandedPaths} activePath={activePath} onTogglePath={onTogglePath} onSelect={onSelect} />
    </div>
  );
}
