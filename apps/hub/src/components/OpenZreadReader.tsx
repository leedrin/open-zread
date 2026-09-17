import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import type {
  HubProject,
  HubSourceFile,
  HubWikiAsset,
  HubWikiChangeSet,
  HubWikiHistoryEntry,
  HubWikiDocument,
  HubWikiAnswerResponse,
  HubWikiBatchMutationResponse,
  HubWikiPageDraftResponse,
  HubWikiPage,
  HubWikiPageMutationResponse,
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
  listHistory: (projectId: string, provider: HubWikiProvider) => Promise<HubWikiHistoryEntry[]>;
  restoreHistory: (projectId: string, provider: HubWikiProvider, historyId: string) => Promise<HubWikiHistoryEntry>;
  createPage: (projectId: string, provider: HubWikiProvider, input: NewWikiPageInput) => Promise<HubWikiPageMutationResponse>;
  createPages: (projectId: string, provider: HubWikiProvider, inputs: NewWikiPageInput[]) => Promise<HubWikiBatchMutationResponse>;
  deletePage: (projectId: string, provider: HubWikiProvider, slug: string) => Promise<HubWikiPageMutationResponse>;
  updatePageMetadata: (projectId: string, provider: HubWikiProvider, slug: string, input: {
    newSlug?: string;
    title?: string;
    section?: string;
    group?: string;
    associatedFiles?: string[];
    order?: number;
    clearGroup?: boolean;
  }) => Promise<HubWikiPageMutationResponse>;
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
  listHistory,
  restoreHistory,
  createPage,
  createPages,
  deletePage,
  updatePageMetadata,
  askWiki,
  rewritePage,
  draftPage,
  onHistoryRestored,
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

  const openHistory = async () => {
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
    if (!globalThis.confirm(`Restore ${entry.label}? The current page state will be replaced.`)) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      await restoreHistory(project.id, wiki.provider, entry.id);
      onHistoryRestored();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to restore Wiki history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const startNewPage = () => {
    setNewPageSlug('');
    setNewPageTitle('');
    setNewPageSection(sections[0]?.[0] ?? 'General');
    setNewPageGroup('');
    setNewPageContent('');
    setNewPageAssociatedFiles('');
    setNewPageTopic('');
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
    try {
      if (pages.length === 1) {
        await createPage(project.id, wiki.provider, pages[0]);
      } else {
        await createPages(project.id, wiki.provider, pages);
      }
      setNewPageOpen(false);
      setQueuedNewPages([]);
      onHistoryRestored();
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
    setMetadataSlug(selectedPage.slug);
    setMetadataTitle(selectedPage.title);
    setMetadataSection(selectedPage.section);
    setMetadataGroup(selectedPage.group ?? '');
    setMetadataAssociatedFiles(selectedPage.associatedFiles.join(', '));
    setMetadataOrder(String(Math.max(0, wiki.pages.findIndex((page) => page.slug === selectedPage.slug))));
    setPageMutationError(null);
    setMetadataOpen(true);
  };

  const saveMetadata = async () => {
    if (!selectedPage) {
      return;
    }
    setPageMutationBusy(true);
    setPageMutationError(null);
    try {
      await updatePageMetadata(project.id, wiki.provider, selectedPage.slug, {
        newSlug: metadataSlug,
        title: metadataTitle,
        section: metadataSection,
        group: metadataGroup,
        clearGroup: !metadataGroup.trim(),
        associatedFiles: metadataAssociatedFiles.split(/[,\n]/).map((path) => path.trim()).filter(Boolean),
        ...(metadataOrder.trim() ? { order: Number(metadataOrder) } : {}),
      });
      setMetadataOpen(false);
      onHistoryRestored();
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to update the Wiki page metadata.');
    } finally {
      setPageMutationBusy(false);
    }
  };

  const removeSelectedPage = async () => {
    if (!selectedPage || !globalThis.confirm(`Delete ${selectedPage.title}? The original Markdown file will be removed.`)) {
      return;
    }
    setPageMutationBusy(true);
    setPageMutationError(null);
    try {
      await deletePage(project.id, wiki.provider, selectedPage.slug);
      onHistoryRestored();
    } catch (error) {
      setPageMutationError(error instanceof Error ? error.message : 'Unable to delete the Wiki page.');
    } finally {
      setPageMutationBusy(false);
    }
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
  const hasCurrentNewPage = Boolean(newPageSlug.trim() || newPageTitle.trim() || newPageContent.trim() || newPageAssociatedFiles.trim());

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
      <div className="wiki-reader-history-bar">
        <button type="button" className="primary-button" data-testid="new-wiki-page" onClick={startNewPage}>
          New page
        </button>
        <button type="button" className="secondary-button" data-testid="open-wiki-history" onClick={() => void openHistory()}>
          {historyOpen ? 'Hide history' : 'History & restore'}
        </button>
        <button type="button" className="secondary-button" data-testid="open-wiki-qa" onClick={() => setQaOpen((current) => !current)}>
          {qaOpen ? 'Hide Q&A' : 'Ask this Wiki'}
        </button>
      </div>
      {qaOpen && selectedPage && (
        <section className="wiki-qa-panel" data-testid="wiki-qa-panel" aria-label="Wiki Q&A">
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
            <button type="button" className="secondary-button" onClick={() => setNewPageOpen(false)}>Cancel</button>
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
              {pageMutationBusy ? 'Applying…' : queuedNewPages.length > 0 ? `Create ${queuedNewPages.length + (hasCurrentNewPage ? 1 : 0)} pages and write files` : 'Create and write file'}
            </button>
          </div>
          {pageMutationError && <p className="wiki-reader-page-error" role="alert">{pageMutationError}</p>}
        </form>
      )}
      {historyOpen && (
        <section className="wiki-history" data-testid="wiki-history" aria-label="Wiki history">
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
                    <button type="button" className="secondary-button" disabled={pageMutationBusy} onClick={() => setMetadataOpen(false)}>Cancel</button>
                    <button type="submit" className="primary-button" data-testid="save-wiki-metadata" disabled={pageMutationBusy}>
                      {pageMutationBusy ? 'Saving…' : 'Save metadata'}
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
