import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ElementType, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { HubIcon } from './HubIcon';
import type {
  HubProject,
  HubSourceFile,
  HubWikiAsset,
  HubWikiChangeSet,
  HubWikiHistoryEntry,
  HubWikiDocument,
  HubWikiAnswerResponse,
  HubWikiPageDraftResponse,
  HubWikiPage,
  HubWikiProvider,
  HubWikiInstance,
  HubWikiStructureChangeRequest,
} from '@open-zread/hub-contract';

export interface WikiReaderSession {
  selectedSlug?: string;
  scrollTop: number;
  expandedSections?: string[];
}

interface OpenZreadReaderProps {
  project: HubProject;
  wiki: HubWikiDocument;
  toolbarTarget?: HTMLElement | null;
  focusText?: string;
  providerLabel: string;
  availableProviders: HubWikiProvider[];
  availableWikiInstances?: HubWikiInstance[];
  session: WikiReaderSession;
  onSessionChange: (session: WikiReaderSession) => void;
  onSwitchProvider: (provider: HubWikiProvider) => void;
  onSwitchWiki?: (instance: HubWikiInstance) => void;
  switchingProvider: boolean;
  readSource: (projectId: string, path: string) => Promise<HubSourceFile>;
  readAsset: (projectId: string, pagePath: string, assetPath: string) => Promise<HubWikiAsset>;
  previewChange: (projectId: string, provider: HubWikiProvider, slug: string, content: string) => Promise<HubWikiChangeSet>;
  previewStructureChange: (projectId: string, provider: HubWikiProvider, request: HubWikiStructureChangeRequest) => Promise<HubWikiChangeSet>;
  applyChange: (changeSetId: string) => Promise<HubWikiChangeSet>;
  listHistory: (projectId: string, provider: HubWikiProvider) => Promise<HubWikiHistoryEntry[]>;
  restoreHistory: (projectId: string, provider: HubWikiProvider, historyId: string) => Promise<HubWikiHistoryEntry>;
  askWiki: (
    projectId: string,
    provider: HubWikiProvider,
    slug: string,
    question: string,
    selectedText?: string,
  ) => Promise<HubWikiAnswerResponse>;
  rewritePage: (
    projectId: string,
    provider: HubWikiProvider,
    slug: string,
    instruction: string,
    sectionHeading?: string,
  ) => Promise<HubWikiChangeSet>;
  draftPage: (
    projectId: string,
    provider: HubWikiProvider,
    topic: string,
    section?: string,
  ) => Promise<HubWikiPageDraftResponse>;
  onHistoryRestored: () => void;
  onRegisterLeaveGuard: (guard: (destination: string) => boolean) => () => void;
  onClose: () => void;
}

type NewWikiPageInput = {
  slug: string;
  title: string;
  section: string;
  group?: string;
  content: string;
  associatedFiles: string[];
};

type MarkdownAlignment = 'left' | 'center' | 'right';

export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; headers: string[]; rows: string[][]; alignments: Array<MarkdownAlignment | undefined> }
  | { type: 'list'; ordered: boolean; start?: number; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'rule' }
  | { type: 'paragraph'; text: string };

function wikiHeadingId(index: number, text: string): string {
  const slug = text.toLocaleLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `wiki-heading-${index}-${slug || 'section'}`;
}

type SourceTreeNode = { name: string; path?: string; children: SourceTreeNode[] };

export function articleHeadingScrollTop(currentScrollTop: number, articleTop: number, headingTop: number, topInset = 16): number {
  return Math.max(0, currentScrollTop + headingTop - articleTop - topInset);
}

function scrollArticleToHeading(article: HTMLElement, heading: HTMLElement) {
  article.scrollTo({
    top: articleHeadingScrollTop(article.scrollTop, article.getBoundingClientRect().top, heading.getBoundingClientRect().top),
    behavior: 'smooth',
  });
}

function buildSourceTree(paths: string[]): SourceTreeNode[] {
  const root: SourceTreeNode = { name: '', children: [] };
  for (const path of paths) {
    let current = root;
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    segments.forEach((segment, index) => {
      let node = current.children.find((child) => child.name === segment);
      if (!node) {
        node = { name: segment, children: [] };
        current.children.push(node);
      }
      if (index === segments.length - 1) node.path = path;
      current = node;
    });
  }
  const sort = (nodes: SourceTreeNode[]) => {
    nodes.sort((a, b) => Number(Boolean(a.path)) - Number(Boolean(b.path)) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

function SourceTreeRows({ nodes, depth, onOpen, loadingPath }: { nodes: SourceTreeNode[]; depth: number; onOpen: (path: string) => void; loadingPath: string | null }) {
  return <>{nodes.map((node) => node.path ? (
    <button key={node.path} type="button" className="wiki-inspector-file" style={{ paddingInlineStart: `${10 + depth * 14}px` }} title={node.path} onClick={() => { if (node.path) onOpen(node.path); }} disabled={loadingPath !== null}>
      <span className="wiki-inspector-file-icon">▣</span><span>{node.name}</span>
    </button>
  ) : (
    <details className="wiki-inspector-folder" key={`${depth}-${node.name}`} open={depth === 0}>
      <summary style={{ paddingInlineStart: `${8 + depth * 14}px` }}><span>⌄</span>{node.name}</summary>
      <SourceTreeRows nodes={node.children} depth={depth + 1} onOpen={onOpen} loadingPath={loadingPath} />
    </details>
  ))}</>;
}

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  csharp: 'csharp', 'c#': 'csharp', cs: 'csharp', 'c++': 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  js: 'javascript', node: 'javascript', jsx: 'jsx', luau: 'lua', ts: 'typescript', tsx: 'tsx',
  sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', md: 'markdown', html: 'markup', xml: 'markup',
  plaintext: 'text', txt: 'text', plain: 'text', jsonc: 'json', py: 'python', rb: 'ruby', rs: 'rust',
};

export function WikiCodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = language.trim().toLowerCase();
  const highlightLanguage = (CODE_LANGUAGE_ALIASES[normalizedLanguage] ?? normalizedLanguage) || 'text';
  const label = normalizedLanguage ? normalizedLanguage.toUpperCase() : 'TEXT';
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="wiki-code-frame" data-testid="wiki-code-block" data-language={highlightLanguage}>
      <header className="wiki-code-toolbar">
        <span>{label}</span>
        <button type="button" aria-label="Copy code" onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy code'}</button>
      </header>
      <SyntaxHighlighter
        language={highlightLanguage}
        style={oneDark}
        showLineNumbers
        lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#636d83', userSelect: 'none' }}
        customStyle={{ margin: 0, border: 0, borderRadius: 0, padding: '14px 16px', background: '#282c34', color: '#abb2bf', fontSize: '13px', lineHeight: '1.65', overflow: 'auto' }}
        codeTagProps={{ style: { fontFamily: 'inherit' } }}
      >
        {content}
      </SyntaxHighlighter>
    </section>
  );
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  const content = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const row = content.endsWith('|') ? content.slice(0, -1) : content;
  const cells: string[] = [];
  let cell = '';
  let codeDelimiterLength = 0;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '\\' && row[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (character === '`') {
      let delimiterLength = 1;
      while (row[index + delimiterLength] === '`') delimiterLength += 1;
      codeDelimiterLength = codeDelimiterLength === 0 ? delimiterLength : 0;
      cell += '`'.repeat(delimiterLength);
      index += delimiterLength - 1;
    } else if (character === '|' && codeDelimiterLength === 0) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function tableAlignments(separator: string): Array<MarkdownAlignment | undefined> | null {
  const cells = splitMarkdownTableRow(separator);
  if (cells.length < 2 || cells.some((cell) => !/^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return undefined;
  });
}

function parseTableAt(lines: string[], index: number): Extract<MarkdownBlock, { type: 'table' }> | null {
  if (index + 1 >= lines.length) return null;
  const headers = splitMarkdownTableRow(lines[index]);
  const alignments = tableAlignments(lines[index + 1]);
  if (!alignments || headers.length !== alignments.length) return null;

  const rows: string[][] = [];
  let rowIndex = index + 2;
  while (rowIndex < lines.length && lines[rowIndex].trim() && lines[rowIndex].includes('|')) {
    const cells = splitMarkdownTableRow(lines[rowIndex]);
    rows.push(Array.from({ length: headers.length }, (_, cellIndex) => cells[cellIndex] ?? ''));
    rowIndex += 1;
  }
  return { type: 'table', headers, rows, alignments };
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const language = fence[1] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language, content: code.join('\n') });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    const table = parseTableAt(lines, index);
    if (table) {
      blocks.push(table);
      index += table.rows.length + 2;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quote.join('\n') });
      continue;
    }

    const listItem = line.match(/^\s*(?:(\d+)[.)]|([-+*]))\s+(.+)$/);
    if (listItem) {
      const ordered = listItem[1] !== undefined;
      const items: string[] = [];
      const start = ordered ? Number(listItem[1]) : undefined;
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)[.)]|([-+*]))\s+(.+)$/);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (/^\s*```\s*[\w-]*\s*$/.test(lines[index]) || /^\s*#{1,6}\s+/.test(lines[index])
        || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index]) || /^\s*>\s?/.test(lines[index])
        || /^\s*(?:(?:\d+)[.)]|[-+*])\s+/.test(lines[index]) || parseTableAt(lines, index)) {
        break;
      }
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}

function imageReferences(markdown: string): string[] {
  const references: string[] = [];
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const source = match[1];
    if (!/^(?:https?:|data:|mailto:)/i.test(source)) {
      references.push(source);
    }
  }
  return [...new Set(references)];
}

function pagePath(page: HubWikiPage): string {
  return page.section ? `${page.section}/${page.file}` : page.file;
}

function sourceTestId(path: string): string {
  return `source-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function isInternalWikiLink(href: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) && !href.startsWith('#');
}

function findLinkedPage(pages: HubWikiPage[], href: string): HubWikiPage | undefined {
  const target = decodeURIComponent(href.split('#', 1)[0]).replace(/^\.\//, '');
  const targetName = target.split('/').pop() ?? target;
  return pages.find((page) => (
    page.slug === target
      || page.file === target
      || page.file === targetName
      || pagePath(page) === target
  ));
}

const SOURCE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'lua', 'luau',
  'json', 'kt', 'md', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'toml',
  'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
]);

export function sourceLinkTarget(href: string): { path: string; lineStart?: number; lineEnd?: number } | null {
  if (!isInternalWikiLink(href)) return null;
  const [rawPath, fragment = ''] = href.split('#', 2);
  let path: string;
  try { path = decodeURIComponent(rawPath).replace(/\\/g, '/').replace(/^\/+|^\.\//, ''); }
  catch { return null; }
  const extension = path.split('/').pop()?.split('.').pop()?.toLowerCase();
  if (!extension || !SOURCE_EXTENSIONS.has(extension)) return null;
  const line = fragment.match(/^L(\d+)(?:-L(\d+))?$/i);
  return line
    ? { path, lineStart: Number(line[1]), lineEnd: Number(line[2] ?? line[1]) }
    : { path };
}

export function sourceLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  const languages: Record<string, string> = {
    c: 'c', cc: 'cpp', cpp: 'cpp', cs: 'csharp', css: 'css', go: 'go', h: 'c',
    hpp: 'cpp', html: 'markup', java: 'java', js: 'javascript', jsx: 'jsx',
    json: 'json', kt: 'kotlin', lua: 'lua', luau: 'lua', md: 'markdown', php: 'php', py: 'python',
    rb: 'ruby', rs: 'rust', scss: 'scss', sh: 'bash', sql: 'sql', toml: 'toml',
    ts: 'typescript', tsx: 'tsx', vue: 'markup', xml: 'markup', yaml: 'yaml', yml: 'yaml',
  };
  return (extension && languages[extension]) || 'text';
}

export function WikiSourcePreview({
  path,
  content,
  loading,
  error,
  lineStart,
  lineEnd,
  onClose,
}: {
  path: string;
  content: string | null;
  loading: boolean;
  error: string | null;
  lineStart?: number;
  lineEnd?: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (!content || !lineStart) return;
    const timer = globalThis.setTimeout(() => {
      contentRef.current?.querySelector('[data-highlight-start="true"]')?.scrollIntoView({ block: 'center' });
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [content, lineStart]);

  return (
    <dialog ref={dialogRef} className="wiki-source-preview" data-testid="wiki-source-preview" aria-label={`源码预览：${path}`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="wiki-source-preview-header">
        <div><strong>{path}</strong>{lineStart && <small>第 {lineStart}{lineEnd && lineEnd !== lineStart ? `–${lineEnd}` : ''} 行</small>}</div>
        <button type="button" className="icon-button" aria-label="关闭源码预览" onClick={onClose}><HubIcon name="close" /></button>
      </header>
      <div ref={contentRef} className="wiki-source-preview-content" data-testid="source-content">
        {loading && <p className="wiki-source-preview-message">正在读取源码…</p>}
        {error && <p className="wiki-source-preview-error" role="alert">{error}</p>}
        {content !== null && !loading && !error && (
          <div>
            <span className="sr-only" data-testid="source-content-text" aria-hidden="true">{content}</span>
            <SyntaxHighlighter
              language={sourceLanguage(path)}
              style={vscDarkPlus}
              showLineNumbers
              wrapLines
              lineProps={(lineNumber) => {
                const highlighted = lineStart !== undefined && lineEnd !== undefined && lineNumber >= lineStart && lineNumber <= lineEnd;
                return {
                  'data-highlight': highlighted ? 'true' : undefined,
                  'data-highlight-start': lineNumber === lineStart ? 'true' : undefined,
                  style: highlighted ? { display: 'block', width: '100%', background: 'rgba(16, 185, 129, .18)' } : {},
                };
              }}
              customStyle={{ margin: 0, padding: 0, minWidth: 'max-content', background: 'transparent', fontSize: '13px', lineHeight: '1.6' }}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </dialog>
  );
}

function InlineMarkdown({
  text,
  wiki,
  loadedImages,
  onNavigate,
  onOpenSource,
}: {
  text: string;
  wiki: HubWikiDocument;
  loadedImages: Record<string, string>;
  onNavigate: (page: HubWikiPage) => void;
  onOpenSource: (path: string, lineStart?: number, lineEnd?: number) => void;
}) {
  const tokens = text.split(/(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  return (
    <>
      {tokens.map((token, index) => {
        const image = token.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)$/);
        if (image) {
          const source = loadedImages[image[2]];
          return source
            ? <img key={`${token}-${index}`} className="wiki-reader-image" src={source} alt={image[1]} />
            : <span key={`${token}-${index}`} className="wiki-reader-image-placeholder">Image: {image[1] || image[2]}</span>;
        }
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const linkedPage = isInternalWikiLink(link[2]) ? findLinkedPage(wiki.pages, link[2]) : undefined;
          if (linkedPage) {
            return (
              <button
                key={`${token}-${index}`}
                type="button"
                className="wiki-reader-inline-link"
                onClick={() => onNavigate(linkedPage)}
              >
                {link[1]}
              </button>
            );
          }
          const sourceTarget = sourceLinkTarget(link[2]);
          if (sourceTarget) {
            return (
              <button key={`${token}-${index}`} type="button" className="wiki-reader-inline-link" onClick={() => onOpenSource(sourceTarget.path, sourceTarget.lineStart, sourceTarget.lineEnd)}>
                {link[1]}
              </button>
            );
          }
          return (
            <a key={`${token}-${index}`} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return <code key={`${token}-${index}`}>{token.slice(1, -1)}</code>;
        }
        if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
          return <strong key={`${token}-${index}`}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('~~') && token.endsWith('~~')) {
          return <del key={`${token}-${index}`}>{token.slice(2, -2)}</del>;
        }
        if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
          return <em key={`${token}-${index}`}>{token.slice(1, -1)}</em>;
        }
        return <span key={`${token}-${index}`}>{token}</span>;
      })}
    </>
  );
}

function MarkdownContent({
  page,
  wiki,
  project,
  readAsset,
  onNavigate,
  onOpenSource,
}: {
  page: HubWikiPage;
  wiki: HubWikiDocument;
  project: HubProject;
  readAsset: (projectId: string, pagePath: string, assetPath: string) => Promise<HubWikiAsset>;
  onNavigate: (page: HubWikiPage) => void;
  onOpenSource: (path: string, lineStart?: number, lineEnd?: number) => void;
}) {
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({});
  const references = useMemo(() => imageReferences(page.content ?? ''), [page.content]);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    setLoadedImages({});

    const loadImages = async () => {
      const entries: Array<[string, string]> = [];
      for (const reference of references) {
        try {
          const asset = await readAsset(project.id, pagePath(page), reference);
          const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }));
          objectUrls.push(objectUrl);
          entries.push([reference, objectUrl]);
        } catch {
          // Keep the image placeholder visible when an optional local image is unavailable.
        }
      }
      if (active) {
        setLoadedImages(Object.fromEntries(entries));
      }
    };

    void loadImages();
    return () => {
      active = false;
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [page, project.id, readAsset, references]);

  const blocks = useMemo(() => parseMarkdownBlocks(page.content ?? ''), [page.content]);
  return (
    <div className="wiki-reader-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Heading = `h${Math.min(block.level, 6)}` as ElementType;
          return <Heading id={wikiHeadingId(index, block.text)} data-wiki-heading="true" key={`heading-${index}`}><InlineMarkdown text={block.text} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} /></Heading>;
        }
        if (block.type === 'code') {
          if (block.language.toLowerCase() === 'mermaid') {
            return <MermaidDiagram key={`diagram-${index}`} source={block.content} />;
          }
          return <WikiCodeBlock key={`code-${index}`} language={block.language} content={block.content} />;
        }
        if (block.type === 'table') {
          return (
            <div className="wiki-reader-table-scroll" key={`table-${index}`} role="region" aria-label="Markdown table" tabIndex={0} data-testid="markdown-table-scroll">
              <table className="wiki-reader-table" data-testid="markdown-table">
                <thead><tr>{block.headers.map((header, cellIndex) => <th key={`header-${cellIndex}`} scope="col" style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}><InlineMarkdown text={header} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} /></th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${cellIndex}`} style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}><InlineMarkdown text={cell} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return <List key={`list-${index}`} start={block.ordered ? block.start : undefined}>{block.items.map((item, itemIndex) => <li key={`item-${itemIndex}`}><InlineMarkdown text={item} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} /></li>)}</List>;
        }
        if (block.type === 'blockquote') {
          return <blockquote key={`quote-${index}`}><p><InlineMarkdown text={block.text} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} /></p></blockquote>;
        }
        if (block.type === 'rule') return <hr key={`rule-${index}`} />;
        return (
          <p key={`paragraph-${index}`}>
            <InlineMarkdown text={block.text} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} onOpenSource={onOpenSource} />
          </p>
        );
      })}
    </div>
  );
}

export type MermaidSvgRenderer = (source: string, diagramId: string) => Promise<string>;

let mermaidInitialized = false;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function renderMermaidSvg(source: string, diagramId: string): Promise<string> {
  const rendering = mermaidRenderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true });
      mermaidInitialized = true;
    }
    return (await mermaid.render(diagramId, source)).svg;
  });
  mermaidRenderQueue = rendering.then(() => undefined, () => undefined);
  return rendering;
}

function imageReadyMermaidSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg;
  const parsedHtml = new DOMParser().parseFromString(svg, 'text/html');
  const svgElement = parsedHtml.querySelector('svg');
  if (!svgElement) throw new Error('Mermaid 未生成有效的 SVG');
  const normalized = new XMLSerializer().serializeToString(svgElement);
  const parsedXml = new DOMParser().parseFromString(normalized, 'image/svg+xml');
  if (parsedXml.querySelector('parsererror')) throw new Error('Mermaid SVG 无法作为图片加载');
  return normalized;
}

function mermaidSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 && viewBox.every(Number.isFinite)) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  return { width: 960, height: 640 };
}

function MermaidPreview({ svg, source, onClose }: { svg: string; source: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [mode, setMode] = useState<'diagram' | 'source'>('diagram');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const size = useMemo(() => mermaidSvgSize(svg), [svg]);
  const imageSource = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || mode !== 'diagram') return;
    const fit = () => {
      const nextScale = Math.min(1, (viewport.clientWidth - 48) / size.width, (viewport.clientHeight - 48) / size.height);
      const fittedScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
      setScale(fittedScale);
      setPan({ x: (viewport.clientWidth - size.width * fittedScale) / 2, y: (viewport.clientHeight - size.height * fittedScale) / 2 });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [mode, size.height, size.width]);

  const zoomAt = (nextScale: number, x: number, y: number) => {
    const clamped = Math.max(0.2, Math.min(5, nextScale));
    setPan({ x: x - ((x - pan.x) / scale) * clamped, y: y - ((y - pan.y) / scale) * clamped });
    setScale(clamped);
  };
  const zoomFromCenter = (factor: number) => {
    const viewport = viewportRef.current;
    if (viewport) zoomAt(scale * factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAt(scale * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <dialog ref={dialogRef} className="wiki-mermaid-preview" aria-label="Mermaid 图表预览" onCancel={(event) => { event.preventDefault(); onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="wiki-mermaid-preview-shell">
        <header className="wiki-mermaid-preview-toolbar">
          <strong>Mermaid 图表</strong>
          <div className="wiki-mermaid-view-switch" role="group" aria-label="预览模式">
            <button type="button" aria-pressed={mode === 'diagram'} onClick={() => setMode('diagram')}>图表</button>
            <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Mermaid 源码</button>
          </div>
          {mode === 'diagram' && <div className="wiki-mermaid-zoom-controls" role="group" aria-label="图表缩放">
            <button type="button" aria-label="缩小图表" onClick={() => zoomFromCenter(1 / 1.25)}>−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="放大图表" onClick={() => zoomFromCenter(1.25)}>＋</button>
            <button type="button" onClick={() => {
              const viewport = viewportRef.current;
              if (!viewport) return;
              const fitted = Math.min(1, (viewport.clientWidth - 48) / size.width, (viewport.clientHeight - 48) / size.height);
              setScale(fitted);
              setPan({ x: (viewport.clientWidth - size.width * fitted) / 2, y: (viewport.clientHeight - size.height * fitted) / 2 });
            }}>适应窗口</button>
          </div>}
          <button type="button" className="wiki-mermaid-preview-close" aria-label="关闭图表预览" onClick={onClose} autoFocus><HubIcon name="close" /></button>
        </header>
        {mode === 'diagram'
          ? <div ref={viewportRef} className={`wiki-mermaid-preview-viewport${dragging ? ' is-dragging' : ''}`} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
            <img src={imageSource} alt="放大的 Mermaid 图表" draggable={false} style={{ width: size.width, height: size.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }} />
          </div>
          : <pre className="wiki-reader-code wiki-mermaid-preview-source"><code>{source}</code></pre>}
      </div>
    </dialog>
  );
}

export function MermaidDiagram({ source, renderSvg = renderMermaidSvg }: { source: string; renderSvg?: MermaidSvgRenderer }) {
  const reactId = useId();
  const diagramId = `wiki-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [result, setResult] = useState<{ svg?: string; error?: string }>({});
  const [showSource, setShowSource] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const renderedSize = useMemo(() => result.svg ? mermaidSvgSize(result.svg) : undefined, [result.svg]);

  useEffect(() => {
    let active = true;
    setResult({});
    setShowSource(false);
    setPreviewOpen(false);
    if (typeof document === 'undefined' && renderSvg === renderMermaidSvg) return () => { active = false; };
    void renderSvg(source, diagramId).then((svg) => {
      if (active) setResult({ svg: imageReadyMermaidSvg(svg) });
    }).catch((error: unknown) => {
      if (active) setResult({ error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [diagramId, renderSvg, source]);

  return (
    <figure className="wiki-reader-diagram" data-testid="mermaid-block" data-status={result.svg ? 'rendered' : result.error ? 'error' : 'rendering'} data-language="mermaid">
      <figcaption className="wiki-reader-diagram-toolbar">
        <span>Mermaid</span>
        <div className="wiki-mermaid-view-switch" role="group" aria-label="Mermaid 图表视图">
          {result.svg && <button type="button" aria-pressed={!showSource} onClick={() => setShowSource(false)}>图表</button>}
          <button type="button" aria-pressed={showSource || !!result.error} onClick={() => setShowSource(true)}>Mermaid 源码</button>
          {result.svg && <button type="button" aria-label="放大查看 Mermaid 图表" onClick={() => setPreviewOpen(true)}>放大</button>}
        </div>
      </figcaption>
      {result.error && <p className="wiki-reader-diagram-error" role="alert">Mermaid 图表无法渲染：{result.error}</p>}
      {!result.svg && !result.error && <p className="wiki-reader-diagram-loading">正在渲染图表…</p>}
      {result.svg && !showSource
        ? <button type="button" className="wiki-reader-diagram-viewport" aria-label="放大查看 Mermaid 图表" onClick={() => setPreviewOpen(true)}><img className="wiki-reader-diagram-svg" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt="Mermaid diagram" style={{ width: renderedSize?.width, height: renderedSize?.height }} onError={() => setResult({ error: 'SVG 图片无法加载，可查看 Mermaid 源码' })} /></button>
        : <pre className="wiki-reader-code wiki-reader-mermaid-source"><code>{source}</code></pre>}
      {previewOpen && result.svg && typeof document !== 'undefined' && createPortal(<MermaidPreview svg={result.svg} source={source} onClose={() => setPreviewOpen(false)} />, document.body)}
    </figure>
  );
}

export function OpenZreadReader({
  project,
  wiki,
  toolbarTarget,
  focusText,
  providerLabel,
  availableProviders,
  availableWikiInstances,
  session,
  onSessionChange,
  onSwitchProvider,
  onSwitchWiki,
  switchingProvider,
  readSource,
  readAsset,
  previewChange,
  previewStructureChange,
  applyChange,
  listHistory,
  restoreHistory,
  askWiki,
  rewritePage,
  draftPage,
  onHistoryRestored,
  onRegisterLeaveGuard,
  onClose,
}: OpenZreadReaderProps) {
  const readablePages = wiki.pages.filter((page) => page.status === 'readable');
  const firstPageSlug = readablePages[0]?.slug ?? wiki.pages[0]?.slug ?? '';
  const [manualSelectedSlug, setManualSelectedSlug] = useState<string | null>(null);
  const rememberedPage = wiki.pages.find((page) => page.slug === session.selectedSlug);
  const selectedPageWasUnavailable = manualSelectedSlug === null
    && session.selectedSlug !== undefined
    && (rememberedPage === undefined || rememberedPage.status !== 'readable');
  const selectedSlug = manualSelectedSlug
    ?? (rememberedPage?.status === 'readable' ? rememberedPage.slug : firstPageSlug);
  const [sourceState, setSourceState] = useState<{ path: string; content: string } | null>(null);
  const [sourcePreviewTarget, setSourcePreviewTarget] = useState<{ path: string; lineStart?: number; lineEnd?: number } | null>(null);
  const [sourceLoading, setSourceLoading] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sourceRequestIdRef = useRef(0);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [changeSet, setChangeSet] = useState<HubWikiChangeSet | null>(null);
  const [changeSuccess, setChangeSuccess] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HubWikiHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageSlug, setNewPageSlug] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageSection, setNewPageSection] = useState('General');
  const [newPageGroup, setNewPageGroup] = useState('');
  const [newPageContent, setNewPageContent] = useState('');
  const [newPageAssociatedFiles, setNewPageAssociatedFiles] = useState('');
  const [newPageTopic, setNewPageTopic] = useState('');
  const [queuedNewPages, setQueuedNewPages] = useState<NewWikiPageInput[]>([]);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataSlug, setMetadataSlug] = useState('');
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataSection, setMetadataSection] = useState('');
  const [metadataGroup, setMetadataGroup] = useState('');
  const [metadataAssociatedFiles, setMetadataAssociatedFiles] = useState('');
  const [metadataOrder, setMetadataOrder] = useState('');
  const [pageMutationBusy, setPageMutationBusy] = useState(false);
  const [pageMutationError, setPageMutationError] = useState<string | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState<HubWikiAnswerResponse | null>(null);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriteSection, setRewriteSection] = useState('');
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [inspectorTab, setInspectorTab] = useState<'sources' | 'outline'>('sources');
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [hoveredHeadingId, setHoveredHeadingId] = useState<string | null>(null);
  const [pagesWidth, setPagesWidth] = useState(280);
  const [wikiQuery, setWikiQuery] = useState('');
  const readerLayoutRef = useRef<HTMLDivElement | null>(null);
  const pagesResizePointerRef = useRef<number | null>(null);
  const inspectorResizePointerRef = useRef<number | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const pagesToggleRef = useRef<HTMLButtonElement | null>(null);
  const qaToggleRef = useRef<HTMLButtonElement | null>(null);
  const historyToggleRef = useRef<HTMLButtonElement | null>(null);
  const sourceTriggerRef = useRef<HTMLElement | null>(null);
  const leaveGuardRef = useRef<(destination: string) => boolean>(() => true);
  const selectedPage = wiki.pages.find((page) => page.slug === selectedSlug) ?? wiki.pages[0];
  const sections = useMemo(() => {
    const grouped = new Map<string, HubWikiPage[]>();
    wiki.pages.forEach((page) => {
      const pages = grouped.get(page.section) ?? [];
      pages.push(page);
      grouped.set(page.section, pages);
    });
    return [...grouped.entries()];
  }, [wiki.pages]);
  const normalizedWikiQuery = wikiQuery.trim().toLocaleLowerCase();
  const visibleSections = useMemo(() => sections.map(([section, pages]) => [
    section,
    normalizedWikiQuery
      ? pages.filter((page) => `${page.title} ${page.slug} ${page.section} ${page.content ?? ''}`.toLocaleLowerCase().includes(normalizedWikiQuery))
      : pages,
  ] as [string, HubWikiPage[]]).filter(([, pages]) => pages.length > 0), [normalizedWikiQuery, sections]);
  const wikiSearchMatchCount = visibleSections.reduce((count, [, pages]) => count + pages.length, 0);
  const expandedSections = new Set(
    session.expandedSections !== undefined
      ? session.expandedSections
      : sections.map(([section]) => section),
  );

  useEffect(() => {
    setManualSelectedSlug(null);
    sourceRequestIdRef.current += 1;
    setSourcePreviewTarget(null);
    setSourceState(null);
    setSourceLoading(null);
    setSourceError(null);
    setEditing(false);
    setChangeSet(null);
    setChangeSuccess(null);
    setEditError(null);
    setEditedContent({});
    setHistoryOpen(false);
    setHistoryEntries([]);
    setHistoryError(null);
    setNewPageOpen(false);
    setMetadataOpen(false);
    setPageMutationError(null);
    setQaOpen(false);
    setQaQuestion('');
    setQaAnswer(null);
    setQaError(null);
    setRewriteOpen(false);
    setRewriteInstruction('');
    setRewriteSection('');
  }, [wiki.provider, wiki.currentPointer, wiki.versionId]);

  useEffect(() => {
    if (articleRef.current) {
      articleRef.current.scrollTop = session.scrollTop;
    }
  }, [selectedSlug, wiki.provider, wiki.currentPointer, wiki.versionId]);

  useEffect(() => {
    const query = (focusText ?? wikiQuery).trim().toLocaleLowerCase();
    const article = articleRef.current;
    if (!query || !article) return undefined;
    const candidates = [...article.querySelectorAll<HTMLElement>(
      '.wiki-reader-article-heading h3, .wiki-reader-markdown h1, .wiki-reader-markdown h2, .wiki-reader-markdown h3, .wiki-reader-markdown p, .wiki-reader-markdown li',
    )];
    const match = candidates.find((element) => element.textContent?.toLocaleLowerCase().includes(query));
    if (!match) return undefined;
    match.classList.add('wiki-reader-search-hit');
    article.scrollTop += match.getBoundingClientRect().top - article.getBoundingClientRect().top - 28;
    return () => match.classList.remove('wiki-reader-search-hit');
  }, [focusText, selectedSlug, wiki.currentPointer, wiki.provider, wikiQuery]);

  const hasUnappliedChanges = () => {
    if (changeSet?.status === 'preview') return true;
    if (editing && selectedPage && draftContent !== (editedContent[selectedPage.slug] ?? selectedPage.content ?? '')) return true;
    if (newPageOpen && (Boolean(newPageSlug.trim() || newPageTitle.trim() || newPageContent.trim() || newPageAssociatedFiles.trim() || newPageTopic.trim()) || queuedNewPages.length > 0)) return true;
    if (metadataOpen && selectedPage && (
      metadataSlug !== selectedPage.slug || metadataTitle !== selectedPage.title || metadataSection !== selectedPage.section
      || metadataGroup !== (selectedPage.group ?? '') || metadataAssociatedFiles !== selectedPage.associatedFiles.join(', ')
      || metadataOrder !== String(Math.max(0, wiki.pages.findIndex((page) => page.slug === selectedPage.slug)))
    )) return true;
    return false;
  };

  const discardUnappliedChanges = (destination: string) => {
    if (hasUnappliedChanges() && !globalThis.confirm(`Discard your unconfirmed Wiki changes before ${destination}? Nothing has been written to the original files.`)) {
      return false;
    }
      setEditing(false);
      setChangeSet(null);
      setChangeSuccess(null);
      setEditError(null);
    setNewPageOpen(false);
    setQueuedNewPages([]);
    setMetadataOpen(false);
    setPageMutationError(null);
    return true;
  };
  leaveGuardRef.current = discardUnappliedChanges;

  useEffect(() => onRegisterLeaveGuard((destination) => leaveGuardRef.current(destination)), [onRegisterLeaveGuard]);

  const navigateToPage = (page: HubWikiPage) => {
    if (!discardUnappliedChanges('opening another page')) return;
    setManualSelectedSlug(page.slug);
    onSessionChange({
      ...session,
      selectedSlug: page.slug,
      scrollTop: 0,
      expandedSections: [...new Set([...expandedSections, page.section])],
    });
    closeSourcePreview(false);
    setSourceState(null);
    setSourceError(null);
    setPagesDrawerOpen(false);
  };

  const closeSourcePreview = (restoreFocus = true) => {
    sourceRequestIdRef.current += 1;
    setSourcePreviewTarget(null);
    setSourceState(null);
    setSourceLoading(null);
    if (restoreFocus) sourceTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!pagesDrawerOpen && !qaOpen && !historyOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pagesDrawerOpen) {
        setPagesDrawerOpen(false);
        pagesToggleRef.current?.focus();
      } else if (qaOpen) {
        setQaOpen(false);
        qaToggleRef.current?.focus();
      } else if (historyOpen) {
        setHistoryOpen(false);
        historyToggleRef.current?.focus();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [historyOpen, pagesDrawerOpen, qaOpen]);

  const toggleSection = (section: string) => {
    const next = new Set(expandedSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    onSessionChange({ ...session, expandedSections: [...next] });
  };

  const handleArticleScroll = () => {
    if (articleRef.current) {
      onSessionChange({ ...session, scrollTop: articleRef.current.scrollTop });
      const articleBounds = articleRef.current.getBoundingClientRect();
      const headings = [...articleRef.current.querySelectorAll<HTMLElement>('[data-wiki-heading="true"]')];
      const active = headings.filter((heading) => heading.getBoundingClientRect().top <= articleBounds.top + 72).at(-1) ?? headings[0];
      if (active?.id) setActiveHeadingId(active.id);
    }
  };

  const openSource = async (path: string, lineStart?: number, lineEnd?: number) => {
    if (!discardUnappliedChanges('opening an associated source file')) return;
    const requestId = ++sourceRequestIdRef.current;
    sourceTriggerRef.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHistoryOpen(false);
    setQaOpen(false);
    setSourcePreviewTarget({ path, lineStart, lineEnd });
    setSourceState(null);
    setSourceLoading(path);
    setSourceError(null);
    try {
      const source = await readSource(project.id, path);
      if (sourceRequestIdRef.current === requestId) setSourceState(source);
    } catch (error) {
      if (sourceRequestIdRef.current === requestId) setSourceError(error instanceof Error ? error.message : 'The associated source could not be read.');
    } finally {
      if (sourceRequestIdRef.current === requestId) setSourceLoading(null);
    }
  };

  const startEditing = () => {
    if (!selectedPage || selectedPage.status !== 'readable') {
      return;
    }
    setDraftContent(editedContent[selectedPage.slug] ?? selectedPage.content ?? '');
    setChangeSet(null);
    setChangeSuccess(null);
    setEditError(null);
    setHistoryOpen(false);
    setQaOpen(false);
    closeSourcePreview(false);
    setEditing(true);
  };

  const previewPageChange = async () => {
    if (!selectedPage) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    setChangeSuccess(null);
    try {
      setChangeSet(await previewChange(project.id, wiki.provider, selectedPage.slug, draftContent));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to preview the Wiki change.');
    } finally {
      setEditBusy(false);
    }
  };

  const applyPageChange = async () => {
    if (!changeSet) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const applied = await applyChange(changeSet.changeSetId);
      setChangeSuccess('变更已写回原始 Wiki 文件，并已创建可恢复历史快照。');
      if (!applied.operation || applied.operation === 'edit') {
        if (selectedPage) setEditedContent((current) => ({ ...current, [selectedPage.slug]: applied.after }));
        setDraftContent(applied.after);
        setEditing(false);
      } else {
        setNewPageOpen(false);
        setMetadataOpen(false);
        setQueuedNewPages([]);
        onHistoryRestored();
      }
      setChangeSet(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to apply the Wiki change.');
    } finally {
      setEditBusy(false);
    }
  };

  const openHistory = async () => {
    if (!historyOpen && !discardUnappliedChanges('opening Wiki history')) return;
    setQaOpen(false);
    closeSourcePreview(false);
    setHistoryOpen((current) => !current);
    if (historyOpen) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistoryEntries(await listHistory(project.id, wiki.provider));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to read Wiki history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreHistoryEntry = async (entry: HubWikiHistoryEntry) => {
    if (!globalThis.confirm(`Restore ${entry.label} (${entry.createdAt}, ${entry.pageCount} pages)? Current Wiki files may contain edits made after this snapshot; those changes can be overwritten. Verify the target before continuing.`)) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      await restoreHistory(project.id, wiki.provider, entry.id);
      setHistoryOpen(false);
      setHistoryEntries([]);
      setChangeSet(null);
      onHistoryRestored();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to restore Wiki history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const startNewPage = () => {
    if (!discardUnappliedChanges('starting a new Wiki page')) return;
    setHistoryOpen(false);
    setQaOpen(false);
    closeSourcePreview(false);
    setNewPageSlug('');
    setNewPageTitle('');
    setNewPageSection(sections[0]?.[0] ?? 'General');
    setNewPageGroup('');
    setNewPageContent('');
    setNewPageAssociatedFiles('');
    setNewPageTopic('');
    setChangeSuccess(null);
    setQueuedNewPages([]);
    setPageMutationError(null);
    setNewPageOpen(true);
  };

  const currentNewPageInput = (): NewWikiPageInput => ({
    slug: newPageSlug,
    title: newPageTitle,
    section: newPageSection,
    ...(newPageGroup.trim() ? { group: newPageGroup } : {}),
    content: newPageContent,
    associatedFiles: newPageAssociatedFiles.split(/[,\n]/).map((path) => path.trim()).filter(Boolean),
  });

  const resetNewPageFields = () => {
    setNewPageSlug('');
    setNewPageTitle('');
    setNewPageGroup('');
    setNewPageContent('');
    setNewPageAssociatedFiles('');
    setNewPageTopic('');
  };

  const queueNewPage = () => {
    const input = currentNewPageInput();
    if (!input.slug.trim() || !input.title.trim() || !input.section.trim()) {
      setPageMutationError('Slug, title, and section are required before adding a page to the batch.');
      return;
    }
    setQueuedNewPages((current) => [...current, input]);
    resetNewPageFields();
    setPageMutationError(null);
  };

  const createNewPage = async () => {
    const hasCurrentPage = Boolean(newPageSlug.trim() || newPageTitle.trim() || newPageContent.trim() || newPageAssociatedFiles.trim());
    const currentPage = hasCurrentPage ? currentNewPageInput() : null;
    if (currentPage && (!currentPage.slug.trim() || !currentPage.title.trim() || !currentPage.section.trim())) {
      setPageMutationError('Slug, title, and section are required for the current page.');
      return;
    }
    if (!currentPage && queuedNewPages.length === 0) {
      setPageMutationError('Add at least one Wiki page before applying the change.');
      return;
    }
    const pages = currentPage ? [...queuedNewPages, currentPage] : queuedNewPages;
    setPageMutationBusy(true);
    setPageMutationError(null);
    setChangeSuccess(null);
    try {
      setChangeSet(await previewStructureChange(project.id, wiki.provider, { operation: 'create', pages }));
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to create the Wiki page.');
    } finally {
      setPageMutationBusy(false);
    }
  };

  const draftNewPageWithAi = async () => {
    if (!newPageTopic.trim()) {
      return;
    }
    setPageMutationBusy(true);
    setPageMutationError(null);
    try {
      const draft = await draftPage(project.id, wiki.provider, newPageTopic, newPageSection);
      setNewPageSlug(draft.slug);
      setNewPageTitle(draft.title);
      setNewPageSection(draft.section);
      setNewPageContent(draft.content);
      setNewPageAssociatedFiles(draft.associatedFiles.join(', '));
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to create an AI page draft.');
    } finally {
      setPageMutationBusy(false);
    }
  };

  const startMetadataEdit = () => {
    if (!selectedPage) {
      return;
    }
    if (!discardUnappliedChanges('editing page metadata')) return;
    setMetadataSlug(selectedPage.slug);
    setMetadataTitle(selectedPage.title);
    setMetadataSection(selectedPage.section);
    setMetadataGroup(selectedPage.group ?? '');
    setMetadataAssociatedFiles(selectedPage.associatedFiles.join(', '));
    setMetadataOrder(String(Math.max(0, wiki.pages.findIndex((page) => page.slug === selectedPage.slug))));
    setHistoryOpen(false);
    setQaOpen(false);
    closeSourcePreview(false);
    setPageMutationError(null);
    setMetadataOpen(true);
  };

  const saveMetadata = async () => {
    if (!selectedPage) {
      return;
    }
    setPageMutationBusy(true);
    setPageMutationError(null);
    setChangeSuccess(null);
    try {
      setChangeSet(await previewStructureChange(project.id, wiki.provider, {
        operation: 'metadata',
        slug: selectedPage.slug,
        newSlug: metadataSlug,
        title: metadataTitle,
        section: metadataSection,
        group: metadataGroup,
        clearGroup: !metadataGroup.trim(),
        associatedFiles: metadataAssociatedFiles.split(/[,\n]/).map((path) => path.trim()).filter(Boolean),
        ...(metadataOrder.trim() ? { order: Number(metadataOrder) } : {}),
      }));
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to update the Wiki page metadata.');
    } finally {
      setPageMutationBusy(false);
    }
  };

  const removeSelectedPage = async () => {
    if (!selectedPage || !globalThis.confirm(`Prepare a deletion preview for ${selectedPage.title}? No files will change until you confirm the preview.`)) {
      return;
    }
    setPageMutationBusy(true);
    setPageMutationError(null);
    setChangeSuccess(null);
    try {
      setChangeSet(await previewStructureChange(project.id, wiki.provider, { operation: 'delete', slug: selectedPage.slug }));
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to delete the Wiki page.');
    } finally {
      setPageMutationBusy(false);
    }
  };

  const closeReader = () => {
    if (discardUnappliedChanges('leaving the Reader')) onClose();
  };

  const toggleQaPanel = () => {
    if (!qaOpen && !discardUnappliedChanges('opening Wiki Q&A')) return;
    setHistoryOpen(false);
    closeSourcePreview(false);
    setPagesDrawerOpen(false);
    setQaOpen((current) => !current);
  };

  const switchProvider = (provider: HubWikiProvider) => {
    if (discardUnappliedChanges('switching Providers')) onSwitchProvider(provider);
  };
  const switchWiki = (instance: HubWikiInstance) => {
    if (discardUnappliedChanges('switching Wiki instances')) onSwitchWiki?.(instance);
  };

  const askCurrentPage = async () => {
    if (!selectedPage || !qaQuestion.trim()) {
      return;
    }
    setQaBusy(true);
    setQaError(null);
    try {
      setQaAnswer(await askWiki(
        project.id,
        wiki.provider,
        selectedPage.slug,
        qaQuestion,
      ));
    } catch (error) {
      setQaError(error instanceof Error ? error.message : 'Unable to answer from the current Wiki page.');
    } finally {
      setQaBusy(false);
    }
  };

  const startAiRewrite = () => {
    if (!selectedPage || selectedPage.status !== 'readable') {
      return;
    }
    if (!discardUnappliedChanges('starting an AI rewrite')) return;
    setHistoryOpen(false);
    setQaOpen(false);
    closeSourcePreview(false);
    setRewriteInstruction('');
    setRewriteSection('');
    setEditError(null);
    setRewriteOpen(true);
  };

  const createAiRewrite = async () => {
    if (!selectedPage || !rewriteInstruction.trim()) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const draft = await rewritePage(
        project.id,
        wiki.provider,
        selectedPage.slug,
        rewriteInstruction,
        rewriteSection.trim() || undefined,
      );
      setChangeSet(draft);
      setDraftContent(draft.after);
      setRewriteOpen(false);
      setEditing(true);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to create the AI rewrite draft.');
    } finally {
      setEditBusy(false);
    }
  };

  const displayPage = selectedPage && editedContent[selectedPage.slug] !== undefined
    ? { ...selectedPage, content: editedContent[selectedPage.slug] }
    : selectedPage;
  const articleBlocks = useMemo(() => parseMarkdownBlocks(displayPage?.content ?? ''), [displayPage?.content]);
  const articleOutline = articleBlocks.flatMap((block, index) => block.type === 'heading'
    ? [{ id: wikiHeadingId(index, block.text), title: block.text, level: block.level }]
    : []);
  const sourcePaths = useMemo(() => {
    const paths = new Set<string>();
    wiki.pages.forEach((page) => {
      page.associatedFiles.forEach((path) => paths.add(path));
      for (const match of (page.content ?? '').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = sourceLinkTarget(match[1].trim().replace(/^<|>$/g, ''));
        if (target) paths.add(target.path);
      }
    });
    return [...paths];
  }, [wiki.pages]);
  const sourceTree = useMemo(() => buildSourceTree(sourcePaths), [sourcePaths]);

  useEffect(() => {
    setActiveHeadingId(articleOutline[0]?.id ?? '');
  }, [displayPage?.slug, displayPage?.content]);

  const navigateToHeading = (id: string) => {
    const article = articleRef.current;
    const heading = article?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (article && heading) scrollArticleToHeading(article, heading);
  };
  const hasCurrentNewPage = Boolean(newPageSlug.trim() || newPageTitle.trim() || newPageContent.trim() || newPageAssociatedFiles.trim());
  const canApplyTextChange = Boolean(changeSet && (!changeSet.operation || changeSet.operation === 'edit')
    && changeSet.validation?.status === 'passed'
    && changeSet.baseRevision?.trim()
    && changeSet.files?.some((file) => file.relativePath === changeSet.relativePath && file.baseRevision.trim())
    && (wiki.provider !== 'zread' || Boolean(changeSet.versionPointer)));
  const canApplyStructureChange = Boolean(changeSet?.operation && changeSet.operation !== 'edit'
    && changeSet.validation?.status === 'passed'
    && changeSet.files?.length
    && changeSet.files.every((file) => file.relativePath.trim() && file.baseRevision.trim())
    && (wiki.provider !== 'zread' || Boolean(changeSet.versionPointer)));

  const readerToolbar = (
    <div className="wiki-reader-toolbar" role="group" aria-label={`${project.name} Wiki actions`}>
      <span className="wiki-reader-toolbar-meta" title={wiki.currentPointer ?? undefined}>
        {wiki.catalog.language ?? 'unknown language'} · {wiki.pages.length} pages · {wiki.status}
      </span>
      {((availableWikiInstances?.length ?? 0) > 0 || availableProviders.length > 0) && (
        <div className="wiki-reader-provider-switcher" role="group" aria-label="Wiki Provider">
          <span className="wiki-reader-switcher-label">Wiki</span>
          <div className="wiki-reader-provider-list">
            {availableWikiInstances && availableWikiInstances.length > 0 ? availableWikiInstances.map((instance) => (
              <button
                key={instance.wikiId}
                type="button"
                className={`wiki-reader-provider${instance.wikiId === wiki.wikiId ? ' is-selected' : ''}`}
                data-testid={`wiki-instance-switch-${instance.wikiId}`}
                aria-pressed={instance.wikiId === wiki.wikiId}
                disabled={instance.wikiId === wiki.wikiId || switchingProvider || instance.status === 'invalid'}
                title={`${instance.sourceRoot} · ${instance.status}`}
                onClick={() => switchWiki(instance)}
              >
                {instance.label}
              </button>
            )) : availableProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`wiki-reader-provider${provider === wiki.provider ? ' is-selected' : ''}`}
                data-testid={`provider-switch-${provider}`}
                aria-pressed={provider === wiki.provider}
                disabled={provider === wiki.provider || switchingProvider}
                onClick={() => switchProvider(provider)}
              >
                {provider === 'zread' ? 'Zread' : 'OpenZread'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="wiki-reader-toolbar-actions">
        <button
          ref={pagesToggleRef}
          type="button"
          className="secondary-button wiki-reader-pages-toggle"
          aria-controls="wiki-reader-pages"
          aria-expanded={pagesDrawerOpen}
          onClick={() => setPagesDrawerOpen((open) => {
            if (!open) setQaOpen(false);
            return !open;
          })}
        >
          {pagesDrawerOpen ? '关闭目录' : '章节目录'}
        </button>
        <button type="button" className="primary-button" data-testid="new-wiki-page" onClick={startNewPage}>
          New page
        </button>
        <button ref={historyToggleRef} type="button" className="secondary-button" data-testid="open-wiki-history" aria-controls="wiki-history" aria-expanded={historyOpen} onClick={() => void openHistory()}>
          {historyOpen ? 'Hide history' : 'History & restore'}
        </button>
        <button ref={qaToggleRef} type="button" className="secondary-button" data-testid="open-wiki-qa" aria-controls="wiki-qa-panel" aria-expanded={qaOpen} onClick={toggleQaPanel}>
          {qaOpen ? 'Hide Q&A' : 'Ask this Wiki'}
        </button>
        <button type="button" className="secondary-button wiki-inspector-toggle" data-testid="toggle-wiki-inspector" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>
          {inspectorOpen ? 'Hide reading sidebar' : 'Show reading sidebar'}
        </button>
        <button type="button" className="icon-button wiki-reader-close" data-testid="close-wiki-reader" aria-label="Close Reader" title="Close Reader" onClick={closeReader}>
          <HubIcon name="close" />
        </button>
      </div>
    </div>
  );
  const useTestFallback = toolbarTarget === null && typeof document === 'undefined';
  const toolbarPlacement = toolbarTarget === undefined || useTestFallback
    ? <div className="wiki-reader-toolbar-fallback">{readerToolbar}</div>
    : (toolbarTarget ? createPortal(readerToolbar, toolbarTarget) : null);

  return (
    <section
      className={`wiki-reader${qaOpen ? ' has-qa-panel' : ''}${inspectorOpen && !qaOpen ? ' has-wiki-inspector' : ''}`}
      data-testid={wiki.provider === 'zread' ? 'zread-reader' : 'open-zread-reader'}
      aria-label={`${project.name} ${providerLabel}`}
    >
      {toolbarPlacement}
      {newPageOpen && (
        <form
          className="wiki-structure-form"
          data-testid="new-wiki-page-form"
          onSubmit={(event) => { event.preventDefault(); void createNewPage(); }}
        >
          <div className="wiki-structure-form-heading">
            <div>
              <p className="eyebrow">STRUCTURE CHANGE</p>
              <h3>Create Wiki page</h3>
            </div>
            <button type="button" className="secondary-button" onClick={() => discardUnappliedChanges('closing the new page form')}>Cancel</button>
          </div>
          <div className="wiki-structure-form-grid">
            <label>AI topic<input data-testid="new-wiki-page-topic" value={newPageTopic} onChange={(event) => setNewPageTopic(event.target.value)} /></label>
            <div className="wiki-structure-form-inline-action"><button type="button" className="secondary-button" data-testid="draft-new-wiki-page" disabled={pageMutationBusy || !newPageTopic.trim()} onClick={() => void draftNewPageWithAi()}>{pageMutationBusy ? 'Drafting…' : 'Draft with AI'}</button></div>
            <label>Slug<input data-testid="new-wiki-page-slug" value={newPageSlug} onChange={(event) => setNewPageSlug(event.target.value)} /></label>
            <label>Title<input data-testid="new-wiki-page-title" value={newPageTitle} onChange={(event) => setNewPageTitle(event.target.value)} /></label>
            <label>Section<input data-testid="new-wiki-page-section" value={newPageSection} onChange={(event) => setNewPageSection(event.target.value)} /></label>
            <label>Group (optional)<input data-testid="new-wiki-page-group" value={newPageGroup} onChange={(event) => setNewPageGroup(event.target.value)} /></label>
            <label>Associated source paths<input value={newPageAssociatedFiles} placeholder="src/main.ts, src/app.tsx" onChange={(event) => setNewPageAssociatedFiles(event.target.value)} /></label>
          </div>
          {queuedNewPages.length > 0 && (
            <div className="wiki-batch-pages" data-testid="queued-wiki-pages">
              <p className="eyebrow">PENDING BATCH · {queuedNewPages.length} PAGE(S)</p>
              {queuedNewPages.map((page, index) => (
                <div className="wiki-batch-page" key={`${page.slug}-${index}`}>
                  <span><strong>{page.title}</strong><small>{page.section} · {page.slug}</small></span>
                  <button type="button" className="secondary-button" disabled={pageMutationBusy} onClick={() => setQueuedNewPages((current) => current.filter((_, pageIndex) => pageIndex !== index))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <label>Markdown content<textarea data-testid="new-wiki-page-content" value={newPageContent} onChange={(event) => setNewPageContent(event.target.value)} /></label>
          <div className="wiki-editor-actions">
            <button type="button" className="secondary-button" data-testid="queue-wiki-page" disabled={pageMutationBusy} onClick={queueNewPage}>
              Add page to batch
            </button>
            <button type="submit" className="primary-button" data-testid="create-wiki-page" disabled={pageMutationBusy}>
              {pageMutationBusy ? 'Preparing…' : queuedNewPages.length > 0 ? `Preview ${queuedNewPages.length + (hasCurrentNewPage ? 1 : 0)} page(s)` : 'Preview page creation'}
            </button>
          </div>
          {pageMutationError && <p className="wiki-reader-page-error" role="alert">{pageMutationError}</p>}
        </form>
      )}
      {changeSet?.operation && changeSet.operation !== 'edit' && (
        <section className="changeset-preview wiki-structure-review" data-testid="wiki-structure-review" aria-label="Wiki structure change review">
          <div className="wiki-structure-review-heading">
            <div>
              <p className="eyebrow">REVIEW BEFORE WRITING</p>
              <h3>{changeSet.operation.replace('_', ' ')} · {changeSet.slug}</h3>
              <p>目标：{project.name} · {providerLabel}。预览阶段未修改磁盘；确认后将写回原始 Wiki 文件。</p>
            </div>
            <span className={`availability-badge availability-${changeSet.validation?.status ?? 'unknown'}`}>{changeSet.validation?.status ?? 'unknown'}</span>
          </div>
          {changeSet.validation?.checks.map((check) => <p className="wiki-structure-check" key={check}>✓ {check}</p>)}
          {changeSet.validation?.warnings.map((warning) => <p className="wiki-reader-warning" role="status" key={warning}>{warning}</p>)}
          <div className="wiki-structure-file-list" data-testid="wiki-structure-file-list">
            {(changeSet.files ?? []).map((file) => (
              <details className="wiki-structure-file" key={`${file.action}:${file.relativePath}`}>
                <summary><span className={`wiki-file-action wiki-file-action-${file.action}`}>{file.action}</span><code>{file.relativePath}</code></summary>
                <div className="changeset-columns"><pre><code>{file.before ?? '(文件不存在)'}</code></pre><pre><code>{file.after ?? '(确认后删除)'}</code></pre></div>
              </details>
            ))}
          </div>
          {!canApplyStructureChange && <p className="wiki-reader-page-error" role="alert">审核依据不完整或校验未通过，不能写回。请返回修改并重新预览。</p>}
          {(pageMutationError || editError) && <p className="wiki-reader-page-error" role="alert">{pageMutationError ?? editError}</p>}
          <div className="wiki-editor-actions">
            <button type="button" className="secondary-button" disabled={pageMutationBusy || editBusy} onClick={() => { setChangeSet(null); setPageMutationError(null); setEditError(null); }}>取消预览</button>
            <button type="button" className="primary-button" data-testid="apply-wiki-change" disabled={pageMutationBusy || editBusy || !canApplyStructureChange} onClick={() => void applyPageChange()}>
              {pageMutationBusy || editBusy ? 'Writing…' : '确认并写回原文件'}
            </button>
          </div>
        </section>
      )}
      {historyOpen && (
        <section id="wiki-history" className="wiki-history" data-testid="wiki-history" aria-label="Wiki history">
          {historyLoading && <p>Loading history…</p>}
          {!historyLoading && historyEntries.length === 0 && <p>No restorable history is available.</p>}
          {historyEntries.map((entry) => (
            <div className="wiki-history-entry" key={entry.id}>
              <div>
                <strong>{entry.label}</strong>
                <small>{entry.createdAt} · {entry.pageCount} page(s){entry.current ? ' · current' : ''}</small>
              </div>
              <button type="button" className="secondary-button" disabled={historyLoading || entry.current} onClick={() => void restoreHistoryEntry(entry)}>
                Restore
              </button>
            </div>
          ))}
          {historyError && <p className="wiki-reader-page-error" role="alert">{historyError}</p>}
        </section>
      )}
      {changeSuccess && <div className="wiki-mutation-success" data-testid="wiki-change-success" role="status"><span>{changeSuccess}</span><button type="button" className="text-button" onClick={() => void openHistory()}>查看历史与恢复</button></div>}
      {wiki.status === 'partial' && (
        <p className="wiki-reader-warning" role="status">
          Some pages could not be read. Available pages remain open; select a page to inspect its local error.
        </p>
      )}
      {selectedPageWasUnavailable && (
        <p className="wiki-reader-warning" role="status">
          The previously selected page is no longer readable in this Wiki. Showing the Wiki overview instead.
        </p>
      )}
      <div ref={readerLayoutRef} className="wiki-reader-layout" style={{ '--wiki-reader-pages-width': `${pagesWidth}px`, '--wiki-reader-inspector-width': `${inspectorWidth}px` } as CSSProperties}>
        {qaOpen && selectedPage && (
          <section id="wiki-qa-panel" className="wiki-qa-panel" data-testid="wiki-qa-panel" aria-label="Wiki Q&A">
            <div>
              <p className="eyebrow">READ-ONLY CONTEXT</p>
              <h3>Ask about {selectedPage.title}</h3>
              <small className="wiki-privacy-note">The question and current page context are sent to your configured model provider. Nothing is written to the Wiki.</small>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void askCurrentPage(); }}>
              <textarea
                data-testid="wiki-qa-question"
                value={qaQuestion}
                onChange={(event) => setQaQuestion(event.target.value)}
                placeholder="What does this page explain?"
              />
              <button type="submit" className="primary-button" data-testid="ask-wiki-question" disabled={qaBusy || !qaQuestion.trim()}>
                {qaBusy ? 'Asking…' : 'Ask'}
              </button>
            </form>
            {qaAnswer && (
              <div className="wiki-qa-answer" data-testid="wiki-qa-answer">
                <p>{qaAnswer.answer}</p>
                {qaAnswer.references.length > 0 && (
                  <small>Reference: {qaAnswer.references.map((reference) => reference.title).join(', ')}</small>
                )}
              </div>
            )}
            {qaError && <p className="wiki-reader-page-error" role="alert">{qaError}</p>}
          </section>
        )}
        <nav id="wiki-reader-pages" className={`wiki-reader-pages${pagesDrawerOpen ? ' is-open' : ''}`} aria-label={`${providerLabel} pages`}>
          <label className="wiki-local-search"><span className="sr-only">仅在当前 {providerLabel} 搜索页面</span><HubIcon name="search" /><input data-testid="project-wiki-search" type="search" value={wikiQuery} onChange={(event) => setWikiQuery(event.target.value)} placeholder={`搜索当前 ${providerLabel}…`} /><small>{wikiSearchMatchCount}</small></label>
          {normalizedWikiQuery && visibleSections.length === 0 && <p className="wiki-local-search-empty">当前 Provider 中没有匹配章节。</p>}
          {visibleSections.map(([section, pages], sectionIndex) => (
            <div className="wiki-reader-section" key={section}>
              <button
                type="button"
                className="wiki-reader-section-toggle"
                data-testid={`wiki-section-toggle-${sectionIndex}`}
                aria-expanded={normalizedWikiQuery.length > 0 || expandedSections.has(section)}
                onClick={() => toggleSection(section)}
              >
                <HubIcon
                  name="chevron"
                  className={`wiki-reader-section-chevron${normalizedWikiQuery.length > 0 || expandedSections.has(section) ? ' is-expanded' : ''}`}
                />
                <span>{section}</span>
              </button>
              {(normalizedWikiQuery.length > 0 || expandedSections.has(section)) && pages.map((page) => (
                <button
                  key={page.slug}
                  type="button"
                  className={`wiki-reader-page${page.slug === selectedPage?.slug ? ' is-selected' : ''}`}
                  data-testid={`wiki-page-nav-${page.slug}`}
                  aria-label={`${page.title}, ${page.status}`}
                  onClick={() => navigateToPage(page)}
                >
                  <span className="wiki-reader-page-title"><HubIcon name="book" /><span>{page.title}</span></span>
                  {page.status !== 'readable' && <small>{page.status}</small>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div
          className="wiki-reader-resize-handle"
          role="separator"
          aria-label="调整 Wiki 章节栏宽度"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={460}
          aria-valuenow={pagesWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            pagesResizePointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (pagesResizePointerRef.current !== event.pointerId) return;
            const layout = readerLayoutRef.current;
            if (!layout) return;
            const maxWidth = Math.max(180, Math.min(460, layout.clientWidth - 360));
            setPagesWidth(Math.max(180, Math.min(maxWidth, event.clientX - layout.getBoundingClientRect().left)));
          }}
          onPointerUp={(event) => {
            if (pagesResizePointerRef.current !== event.pointerId) return;
            pagesResizePointerRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { pagesResizePointerRef.current = null; }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setPagesWidth((width) => Math.max(180, width - 16));
            if (event.key === 'ArrowRight') setPagesWidth((width) => Math.min(460, width + 16));
            if (event.key === 'Home') setPagesWidth(180);
            if (event.key === 'End') setPagesWidth(460);
          }}
        />
        <article
          className="wiki-reader-article"
          ref={articleRef}
          onScroll={handleArticleScroll}
          data-testid="wiki-reader-article"
        >
          {selectedPage ? (
            <>
              <div className="wiki-reader-article-heading">
                <div>
                  <p className="eyebrow">{selectedPage.section}</p>
                  <h3 data-testid={`wiki-page-${selectedPage.slug}`}>{selectedPage.title}</h3>
                </div>
                <div className="wiki-reader-page-actions">
                  <span className={`availability-badge availability-${selectedPage.status}`}>{selectedPage.status}</span>
                  {selectedPage.status === 'readable' && !editing && (
                    <button type="button" className="secondary-button" data-testid={`edit-wiki-page-${selectedPage.slug}`} onClick={startEditing}>
                      Edit page
                    </button>
                  )}
                  {!editing && (
                    <button type="button" className="secondary-button" data-testid={`edit-wiki-metadata-${selectedPage.slug}`} onClick={startMetadataEdit}>
                      Metadata
                    </button>
                  )}
                  {selectedPage.status === 'readable' && !editing && (
                    <button type="button" className="secondary-button" data-testid={`ai-rewrite-wiki-page-${selectedPage.slug}`} onClick={startAiRewrite}>
                      AI rewrite
                    </button>
                  )}
                  {!editing && (
                    <button type="button" className="danger-button" data-testid={`delete-wiki-page-${selectedPage.slug}`} disabled={pageMutationBusy} onClick={() => void removeSelectedPage()}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {rewriteOpen ? (
                <form
                  className="wiki-structure-form wiki-metadata-form"
                  data-testid="wiki-ai-rewrite-form"
                  onSubmit={(event) => { event.preventDefault(); void createAiRewrite(); }}
                >
                  <label>Instruction<textarea data-testid="wiki-ai-rewrite-instruction" value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value)} placeholder="Clarify the failure recovery behavior." /></label>
                  <label>Optional section heading<input data-testid="wiki-ai-rewrite-section" value={rewriteSection} onChange={(event) => setRewriteSection(event.target.value)} placeholder="Leave blank to rewrite the full page" /></label>
                  <div className="wiki-editor-actions">
                    <button type="button" className="secondary-button" disabled={editBusy} onClick={() => setRewriteOpen(false)}>Cancel</button>
                    <button type="submit" className="primary-button" data-testid="create-ai-rewrite" disabled={editBusy || !rewriteInstruction.trim()}>
                      {editBusy ? 'Generating…' : 'Preview AI ChangeSet'}
                    </button>
                  </div>
                  {editError && <p className="wiki-reader-page-error" role="alert">{editError}</p>}
                </form>
              ) : metadataOpen ? (
                <form
                  className="wiki-structure-form wiki-metadata-form"
                  data-testid="wiki-metadata-form"
                  onSubmit={(event) => { event.preventDefault(); void saveMetadata(); }}
                >
                  <div className="wiki-structure-form-grid">
                    <label>Slug<input data-testid="wiki-metadata-slug" value={metadataSlug} onChange={(event) => setMetadataSlug(event.target.value)} /></label>
                    <label>Title<input data-testid="wiki-metadata-title" value={metadataTitle} onChange={(event) => setMetadataTitle(event.target.value)} /></label>
                    <label>Section<input data-testid="wiki-metadata-section" value={metadataSection} onChange={(event) => setMetadataSection(event.target.value)} /></label>
                    <label>Group (empty clears)<input data-testid="wiki-metadata-group" value={metadataGroup} onChange={(event) => setMetadataGroup(event.target.value)} /></label>
                    <label>Order<input data-testid="wiki-metadata-order" type="number" min="0" value={metadataOrder} onChange={(event) => setMetadataOrder(event.target.value)} /></label>
                    <label>Associated source paths<input data-testid="wiki-metadata-associated-files" value={metadataAssociatedFiles} placeholder="src/main.ts, src/app.tsx" onChange={(event) => setMetadataAssociatedFiles(event.target.value)} /></label>
                  </div>
                  <div className="wiki-editor-actions">
                    <button type="button" className="secondary-button" disabled={pageMutationBusy} onClick={() => discardUnappliedChanges('closing the metadata form')}>Cancel</button>
                    <button type="submit" className="primary-button" data-testid="save-wiki-metadata" disabled={pageMutationBusy}>
                      {pageMutationBusy ? 'Preparing…' : 'Preview metadata change'}
                    </button>
                  </div>
                  {pageMutationError && <p className="wiki-reader-page-error" role="alert">{pageMutationError}</p>}
                </form>
              ) : editing && displayPage ? (
                <div className="wiki-editor" data-testid="wiki-editor">
                  <label htmlFor="wiki-editor-content">Markdown content</label>
                  <textarea
                    id="wiki-editor-content"
                    data-testid="wiki-editor-content"
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    spellCheck={false}
                  />
                  <div className="wiki-editor-actions">
                    <button type="button" className="secondary-button" disabled={editBusy} onClick={() => discardUnappliedChanges('closing the editor')}>Cancel</button>
                    <button type="button" className="primary-button" data-testid="preview-wiki-change" disabled={editBusy} onClick={() => void previewPageChange()}>
                      {editBusy ? 'Working…' : 'Preview ChangeSet'}
                    </button>
                  </div>
                  {changeSet && (
                    <div className="changeset-preview" data-testid="changeset-preview">
                      <p><strong>ChangeSet preview</strong> · {project.name} · {providerLabel} · {changeSet.relativePath}</p>
                      <p className={`changeset-validation changeset-validation-${changeSet.validation?.status ?? 'unknown'}`}>{changeSet.validation?.status ?? '审核依据缺失'}{changeSet.validation?.checks.map((check) => ` · ${check}`).join('') ?? ''}</p>
                      {changeSet.validation?.warnings.map((warning) => <p className="wiki-reader-warning" role="status" key={warning}>{warning}</p>)}
                      <div className="changeset-columns">
                        <pre><code>{changeSet.before}</code></pre>
                        <pre><code>{changeSet.after}</code></pre>
                      </div>
                      {!canApplyTextChange && <p className="wiki-reader-page-error" role="alert">审核依据不完整或校验未通过，不能写回。请重新预览或返回编辑。</p>}
                      <button type="button" className="primary-button" data-testid="apply-wiki-change" disabled={editBusy || !canApplyTextChange} onClick={() => void applyPageChange()}>
                        {editBusy ? 'Applying…' : 'Apply to original file'}
                      </button>
                    </div>
                  )}
                  {editError && <p className="wiki-reader-page-error" role="alert">{editError}</p>}
                </div>
              ) : selectedPage.status === 'readable' && displayPage?.content !== undefined ? (
                <MarkdownContent
                  page={displayPage}
                  wiki={wiki}
                  project={project}
                  readAsset={readAsset}
                  onNavigate={navigateToPage}
                  onOpenSource={(path, lineStart, lineEnd) => void openSource(path, lineStart, lineEnd)}
                />
              ) : (
                <p className="wiki-reader-page-error" data-testid={`wiki-page-error-${selectedPage.slug}`} role="alert">
                  {selectedPage.error ?? 'This page could not be read.'}
                </p>
              )}
              {selectedPage.associatedFiles.length > 0 && (
                <section className="wiki-reader-sources" aria-labelledby="wiki-reader-sources-title">
                  <h4 id="wiki-reader-sources-title">Associated source</h4>
                  <div className="wiki-reader-source-list">
                    {selectedPage.associatedFiles.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="wiki-reader-source-button"
                        data-testid={sourceTestId(path)}
                        onClick={() => void openSource(path)}
                        disabled={sourceLoading !== null}
                      >
                        {sourceLoading === path ? 'Reading…' : path}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <p className="empty-state">This OpenZread Wiki has no readable pages.</p>
          )}
        </article>
        <nav className="wiki-outline-rail" aria-label="Article section navigation" data-testid="wiki-outline-rail">
          {articleOutline.map((item) => {
            const isHovered = hoveredHeadingId === item.id;
            const isHighlighted = item.id === activeHeadingId || isHovered;
            return <button
              key={item.id}
              type="button"
              className={`${item.id === activeHeadingId ? 'is-active ' : ''}${isHovered ? 'is-hovered' : ''}`.trim()}
              style={{ marginInlineStart: `${Math.min(item.level - 1, 4) * 2}px` }}
              aria-label={`Jump to ${item.title}`}
              aria-current={item.id === activeHeadingId ? 'location' : undefined}
              aria-describedby={isHovered ? `wiki-outline-tooltip-${item.id}` : undefined}
              onMouseEnter={() => setHoveredHeadingId(item.id)}
              onMouseLeave={() => setHoveredHeadingId(null)}
              onFocus={() => setHoveredHeadingId(item.id)}
              onBlur={() => setHoveredHeadingId(null)}
              onClick={() => navigateToHeading(item.id)}
            >
              <span className="wiki-outline-tooltip" id={`wiki-outline-tooltip-${item.id}`} role="tooltip">{item.title}</span>
              <span className="wiki-outline-rail-marker" aria-hidden="true" data-highlighted={isHighlighted || undefined} />
            </button>;
          })}
        </nav>
        {inspectorOpen && !qaOpen && <div
          className="wiki-inspector-resize-handle"
          role="separator"
          aria-label="调整阅读侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={200}
          aria-valuemax={520}
          aria-valuenow={inspectorWidth}
          tabIndex={0}
          data-testid="wiki-inspector-resize-handle"
          onPointerDown={(event) => {
            event.preventDefault();
            inspectorResizePointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (inspectorResizePointerRef.current !== event.pointerId) return;
            const layout = readerLayoutRef.current;
            if (!layout) return;
            const maxWidth = Math.max(200, Math.min(520, layout.clientWidth - pagesWidth - 8 - 360 - 24 - 8));
            setInspectorWidth(Math.max(200, Math.min(maxWidth, layout.getBoundingClientRect().right - event.clientX - 8)));
          }}
          onPointerUp={(event) => {
            if (inspectorResizePointerRef.current !== event.pointerId) return;
            inspectorResizePointerRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { inspectorResizePointerRef.current = null; }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setInspectorWidth((width) => Math.min(520, width + 16));
            if (event.key === 'ArrowRight') setInspectorWidth((width) => Math.max(200, width - 16));
            if (event.key === 'Home') setInspectorWidth(200);
            if (event.key === 'End') setInspectorWidth(520);
          }}
        />}
        {inspectorOpen && !qaOpen && <aside className="wiki-reader-inspector" data-testid="wiki-reader-inspector" aria-label="Wiki reading tools">
          <div className="wiki-inspector-tabs" role="tablist" aria-label="阅读辅助">
            <button type="button" role="tab" id="wiki-inspector-tab-sources" aria-selected={inspectorTab === 'sources'} aria-controls="wiki-inspector-panel" onClick={() => setInspectorTab('sources')}>来源</button>
            <button type="button" role="tab" id="wiki-inspector-tab-outline" aria-selected={inspectorTab === 'outline'} aria-controls="wiki-inspector-panel" onClick={() => setInspectorTab('outline')}>架构概览</button>
          </div>
          <div className="wiki-inspector-content" id="wiki-inspector-panel" role="tabpanel" aria-labelledby={inspectorTab === 'sources' ? 'wiki-inspector-tab-sources' : 'wiki-inspector-tab-outline'}>
            {inspectorTab === 'sources' ? sourceTree.length ? <SourceTreeRows nodes={sourceTree} depth={0} onOpen={(path) => void openSource(path)} loadingPath={sourceLoading} /> : <p className="wiki-inspector-empty">没有关联的源码文件</p> : articleOutline.length ? articleOutline.map((item) => <button key={item.id} type="button" className={`wiki-inspector-outline-item${item.id === activeHeadingId ? ' is-active' : ''}${item.id === hoveredHeadingId ? ' is-hovered' : ''}`} style={{ paddingInlineStart: `${10 + Math.min(item.level - 1, 5) * 12}px` }} onMouseEnter={() => setHoveredHeadingId(item.id)} onMouseLeave={() => setHoveredHeadingId(null)} onFocus={() => setHoveredHeadingId(item.id)} onBlur={() => setHoveredHeadingId(null)} onClick={() => navigateToHeading(item.id)} title={item.title}>{item.title}</button>) : <p className="wiki-inspector-empty">本文没有可导航的标题</p>}
          </div>
        </aside>}
      </div>
      {sourcePreviewTarget && (
        <WikiSourcePreview
          key={sourcePreviewTarget.path}
          path={sourcePreviewTarget.path}
          content={sourceState?.path === sourcePreviewTarget.path ? sourceState.content : null}
          loading={sourceLoading === sourcePreviewTarget.path}
          error={sourceError}
          lineStart={sourcePreviewTarget.lineStart}
          lineEnd={sourcePreviewTarget.lineEnd}
          onClose={closeSourcePreview}
        />
      )}
    </section>
  );
}
