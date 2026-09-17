import { useEffect, useMemo, useState, type ElementType } from 'react';
import type { HubApplicationService } from '../lib/application-service';
import type { HubOpenZreadWiki, HubProject, HubWikiPage } from '@open-zread/hub-contract';

interface OpenZreadReaderProps {
  project: HubProject;
  wiki: HubOpenZreadWiki;
  service: HubApplicationService;
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
  wiki: HubOpenZreadWiki;
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
  service,
  onNavigate,
}: {
  page: HubWikiPage;
  wiki: HubOpenZreadWiki;
  project: HubProject;
  service: HubApplicationService;
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
          const asset = await service.readOpenZreadAsset(project.id, pagePath(page), reference);
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
  }, [page, project.id, references, service]);

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

export function OpenZreadReader({ project, wiki, service, onClose }: OpenZreadReaderProps) {
  const readablePages = wiki.pages.filter((page) => page.status === 'readable');
  const [selectedSlug, setSelectedSlug] = useState(readablePages[0]?.slug ?? wiki.pages[0]?.slug ?? '');
  const [sourceState, setSourceState] = useState<{ path: string; content: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const selectedPage = wiki.pages.find((page) => page.slug === selectedSlug) ?? wiki.pages[0];

  const navigateToPage = (page: HubWikiPage) => {
    setSelectedSlug(page.slug);
    setSourceState(null);
    setSourceError(null);
  };

  const openSource = async (path: string) => {
    setSourceLoading(path);
    setSourceError(null);
    try {
      setSourceState(await service.readOpenZreadSource(project.id, path));
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'The associated source could not be read.');
    } finally {
      setSourceLoading(null);
    }
  };

  return (
    <section className="wiki-reader" data-testid="open-zread-reader" aria-labelledby="open-zread-reader-title">
      <div className="wiki-reader-header">
        <div>
          <p className="eyebrow">OPENZREAD WIKI</p>
          <h2 id="open-zread-reader-title">{project.name}</h2>
          <p className="wiki-reader-meta">
            {wiki.catalog.language ?? 'unknown language'} · {wiki.pages.length} pages · {wiki.status}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>Close Reader</button>
      </div>
      {wiki.status === 'partial' && (
        <p className="wiki-reader-warning" role="status">
          Some pages could not be read. Available pages remain open; select a page to inspect its local error.
        </p>
      )}
      <div className="wiki-reader-layout">
        <nav className="wiki-reader-pages" aria-label="OpenZread pages">
          {wiki.pages.map((page) => (
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
        </nav>
        <article className="wiki-reader-article">
          {selectedPage ? (
            <>
              <div className="wiki-reader-article-heading">
                <div>
                  <p className="eyebrow">{selectedPage.section}</p>
                  <h3 data-testid={`wiki-page-${selectedPage.slug}`}>{selectedPage.title}</h3>
                </div>
                <span className={`availability-badge availability-${selectedPage.status}`}>{selectedPage.status}</span>
              </div>
              {selectedPage.status === 'readable' && selectedPage.content !== undefined ? (
                <MarkdownContent
                  page={selectedPage}
                  wiki={wiki}
                  project={project}
                  service={service}
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
