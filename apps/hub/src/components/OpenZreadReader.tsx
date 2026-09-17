import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import type {
  HubProject,
  HubSourceFile,
  HubWikiAsset,
  HubWikiChangeSet,
  HubWikiDocument,
  HubWikiPage,
  HubWikiProvider,
} from '@open-zread/hub-contract';

export interface WikiReaderSession {
  selectedSlug?: string;
  scrollTop: number;
  expandedSections?: string[];
}

interface OpenZreadReaderProps {
  project: HubProject;
  wiki: HubWikiDocument;
  providerLabel: string;
  availableProviders: HubWikiProvider[];
  session: WikiReaderSession;
  onSessionChange: (session: WikiReaderSession) => void;
  onSwitchProvider: (provider: HubWikiProvider) => void;
  switchingProvider: boolean;
  readSource: (projectId: string, path: string) => Promise<HubSourceFile>;
  readAsset: (projectId: string, pagePath: string, assetPath: string) => Promise<HubWikiAsset>;
  previewChange: (projectId: string, provider: HubWikiProvider, slug: string, content: string) => Promise<HubWikiChangeSet>;
  applyChange: (changeSetId: string) => Promise<HubWikiChangeSet>;
  onClose: () => void;
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
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

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (/^\s*```\s*[\w-]*\s*$/.test(lines[index]) || /^\s*#{1,6}\s+/.test(lines[index])) {
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

function InlineMarkdown({
  text,
  wiki,
  loadedImages,
  onNavigate,
}: {
  text: string;
  wiki: HubWikiDocument;
  loadedImages: Record<string, string>;
  onNavigate: (page: HubWikiPage) => void;
}) {
  const tokens = text.split(/(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g);
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
          return (
            <a key={`${token}-${index}`} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return <code key={`${token}-${index}`}>{token.slice(1, -1)}</code>;
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
}: {
  page: HubWikiPage;
  wiki: HubWikiDocument;
  project: HubProject;
  readAsset: (projectId: string, pagePath: string, assetPath: string) => Promise<HubWikiAsset>;
  onNavigate: (page: HubWikiPage) => void;
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
          return <Heading key={`heading-${index}`}><InlineMarkdown text={block.text} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} /></Heading>;
        }
        if (block.type === 'code') {
          return (
            <pre
              key={`code-${index}`}
              className={`wiki-reader-code${block.language.toLowerCase() === 'mermaid' ? ' wiki-reader-mermaid' : ''}`}
              data-testid={block.language.toLowerCase() === 'mermaid' ? 'mermaid-block' : 'code-block'}
              data-language={block.language || undefined}
            >
              <code>{block.content}</code>
            </pre>
          );
        }
        return (
          <p key={`paragraph-${index}`}>
            <InlineMarkdown text={block.text} wiki={wiki} loadedImages={loadedImages} onNavigate={onNavigate} />
          </p>
        );
      })}
    </div>
  );
}

export function OpenZreadReader({
  project,
  wiki,
  providerLabel,
  availableProviders,
  session,
  onSessionChange,
  onSwitchProvider,
  switchingProvider,
  readSource,
  readAsset,
  previewChange,
  applyChange,
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
  const [sourceLoading, setSourceLoading] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [changeSet, setChangeSet] = useState<HubWikiChangeSet | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const articleRef = useRef<HTMLElement | null>(null);
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
  const expandedSections = new Set(
    session.expandedSections !== undefined
      ? session.expandedSections
      : sections.map(([section]) => section),
  );

  useEffect(() => {
    setManualSelectedSlug(null);
    setSourceState(null);
    setSourceLoading(null);
    setSourceError(null);
    setEditing(false);
    setChangeSet(null);
    setEditError(null);
    setEditedContent({});
  }, [wiki.provider, wiki.currentPointer, wiki.versionId]);

  useEffect(() => {
    if (articleRef.current) {
      articleRef.current.scrollTop = session.scrollTop;
    }
  }, [session.scrollTop, wiki.provider, wiki.currentPointer, wiki.versionId]);

  const navigateToPage = (page: HubWikiPage) => {
    setManualSelectedSlug(page.slug);
    onSessionChange({
      ...session,
      selectedSlug: page.slug,
      expandedSections: [...new Set([...expandedSections, page.section])],
    });
    setSourceState(null);
    setSourceError(null);
  };

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
    }
  };

  const openSource = async (path: string) => {
    setSourceLoading(path);
    setSourceError(null);
    try {
      setSourceState(await readSource(project.id, path));
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'The associated source could not be read.');
    } finally {
      setSourceLoading(null);
    }
  };

  const startEditing = () => {
    if (!selectedPage || selectedPage.status !== 'readable') {
      return;
    }
    setDraftContent(editedContent[selectedPage.slug] ?? selectedPage.content ?? '');
    setChangeSet(null);
    setEditError(null);
    setEditing(true);
  };

  const previewPageChange = async () => {
    if (!selectedPage) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      setChangeSet(await previewChange(project.id, wiki.provider, selectedPage.slug, draftContent));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to preview the Wiki change.');
    } finally {
      setEditBusy(false);
    }
  };

  const applyPageChange = async () => {
    if (!changeSet || !selectedPage) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const applied = await applyChange(changeSet.changeSetId);
      setEditedContent((current) => ({ ...current, [selectedPage.slug]: applied.after }));
      setDraftContent(applied.after);
      setChangeSet(null);
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to apply the Wiki change.');
    } finally {
      setEditBusy(false);
    }
  };

  const displayPage = selectedPage && editedContent[selectedPage.slug] !== undefined
    ? { ...selectedPage, content: editedContent[selectedPage.slug] }
    : selectedPage;

  return (
    <section
      className="wiki-reader"
      data-testid={wiki.provider === 'zread' ? 'zread-reader' : 'open-zread-reader'}
      aria-labelledby="wiki-reader-title"
    >
      <div className="wiki-reader-header">
        <div>
          <p className="eyebrow">{providerLabel}</p>
          <h2 id="wiki-reader-title">{project.name}</h2>
          <p className="wiki-reader-meta">
            {wiki.catalog.language ?? 'unknown language'} · {wiki.pages.length} pages · {wiki.status}
            {wiki.currentPointer ? ` · ${wiki.currentPointer}` : ''}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>Close Reader</button>
      </div>
      {availableProviders.length > 0 && (
        <div className="wiki-reader-provider-switcher" role="group" aria-label="Wiki Provider">
          <span className="wiki-reader-switcher-label">Wiki Provider</span>
          <div className="wiki-reader-provider-list">
            {availableProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`wiki-reader-provider${provider === wiki.provider ? ' is-selected' : ''}`}
                data-testid={`provider-switch-${provider}`}
                aria-pressed={provider === wiki.provider}
                disabled={provider === wiki.provider || switchingProvider}
                onClick={() => onSwitchProvider(provider)}
              >
                {provider === 'zread' ? 'Zread' : 'OpenZread'}
              </button>
            ))}
          </div>
        </div>
      )}
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
      <div className="wiki-reader-layout">
        <nav className="wiki-reader-pages" aria-label={`${providerLabel} pages`}>
          {sections.map(([section, pages], sectionIndex) => (
            <div className="wiki-reader-section" key={section}>
              <button
                type="button"
                className="wiki-reader-section-toggle"
                data-testid={`wiki-section-toggle-${sectionIndex}`}
                aria-expanded={expandedSections.has(section)}
                onClick={() => toggleSection(section)}
              >
                <span>{section}</span>
                <small>{expandedSections.has(section) ? '−' : '+'}</small>
              </button>
              {expandedSections.has(section) && pages.map((page) => (
                <button
                  key={page.slug}
                  type="button"
                  className={`wiki-reader-page${page.slug === selectedPage?.slug ? ' is-selected' : ''}`}
                  data-testid={`wiki-page-nav-${page.slug}`}
                  onClick={() => navigateToPage(page)}
                >
                  <span>{page.title}</span>
                  <small>{page.status}</small>
                </button>
              ))}
            </div>
          ))}
        </nav>
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
                </div>
              </div>
              {editing && displayPage ? (
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
                    <button type="button" className="secondary-button" disabled={editBusy} onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="primary-button" data-testid="preview-wiki-change" disabled={editBusy} onClick={() => void previewPageChange()}>
                      {editBusy ? 'Working…' : 'Preview ChangeSet'}
                    </button>
                  </div>
                  {changeSet && (
                    <div className="changeset-preview" data-testid="changeset-preview">
                      <p><strong>ChangeSet preview</strong> · {changeSet.relativePath}</p>
                      <div className="changeset-columns">
                        <pre><code>{changeSet.before}</code></pre>
                        <pre><code>{changeSet.after}</code></pre>
                      </div>
                      <button type="button" className="primary-button" data-testid="apply-wiki-change" disabled={editBusy} onClick={() => void applyPageChange()}>
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
              {sourceError && <p className="wiki-reader-page-error" role="alert">{sourceError}</p>}
              {sourceState && (
                <pre className="wiki-reader-source-content" data-testid="source-content"><code data-testid="source-content-text">{sourceState.content}</code></pre>
              )}
            </>
          ) : (
            <p className="empty-state">This OpenZread Wiki has no readable pages.</p>
          )}
        </article>
      </div>
    </section>
  );
}
