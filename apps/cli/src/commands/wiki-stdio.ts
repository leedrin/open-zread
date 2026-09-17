import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createOpenZreadApplication,
  type ArticleEventPayload,
  type CatalogEvent,
} from '@open-zread/orchestrator';
import {
  getWikiDir,
  loadConfig,
  loadWikiBlueprint,
} from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';

export type OpenZreadStdioOperation = 'generate' | 'sync';

export interface OpenZreadStdioEvent {
  kind: 'generation';
  status: 'running' | 'succeeded' | 'failed';
  phase: string;
  message?: string;
  progress?: { current: number; total: number };
}

export interface OpenZreadStdioRunOptions {
  projectRoot: string;
  operation: OpenZreadStdioOperation;
  emit?: (event: OpenZreadStdioEvent) => void;
}

interface WikiBackup {
  root: string;
  wikiPath: string;
  existed: boolean;
}

function emitEvent(
  emit: ((event: OpenZreadStdioEvent) => void) | undefined,
  event: Omit<OpenZreadStdioEvent, 'kind'>,
): void {
  emit?.({ kind: 'generation', ...event });
}

function containedPath(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function backupWiki(projectRoot: string): Promise<WikiBackup> {
  const wikiPath = getWikiDir(projectRoot);
  const existed = await stat(wikiPath).then((value) => value.isDirectory()).catch(() => false);
  const root = await mkdtemp(join(tmpdir(), 'open-zread-hub-wiki-'));
  if (existed) {
    await cp(wikiPath, join(root, 'wiki'), { recursive: true });
  }
  return { root, wikiPath, existed };
}

async function restoreWiki(backup: WikiBackup): Promise<void> {
  await rm(backup.wikiPath, { recursive: true, force: true });
  if (backup.existed) {
    await cp(join(backup.root, 'wiki'), backup.wikiPath, { recursive: true });
  }
}

async function disposeBackup(backup: WikiBackup): Promise<void> {
  await rm(backup.root, { recursive: true, force: true });
}

async function validateWikiOutput(projectRoot: string): Promise<WikiPage[]> {
  const blueprint = await loadWikiBlueprint(undefined, projectRoot);
  const wikiRoot = resolve(getWikiDir(projectRoot));
  for (const page of blueprint.pages) {
    const pagePath = resolve(wikiRoot, page.section, page.file);
    if (!containedPath(wikiRoot, pagePath)) {
      throw new Error(`Wiki page path escapes the Project Wiki: ${page.slug}`);
    }
    const pageStat = await stat(pagePath).catch(() => undefined);
    if (!pageStat?.isFile()) {
      throw new Error(`Wiki page output is missing: ${page.slug}`);
    }
    await readFile(pagePath, 'utf8');
  }
  return blueprint.pages;
}

function forwardCatalogEvent(
  emit: ((event: OpenZreadStdioEvent) => void) | undefined,
  event: CatalogEvent,
): void {
  if (event.type === 'error') {
    emitEvent(emit, {
      status: 'running',
      phase: 'catalog-error',
      message: event.error,
    });
    return;
  }
  emitEvent(emit, {
    status: 'running',
    phase: `catalog-${event.type}`,
    ...(event.toolName ? { message: event.toolName } : {}),
  });
}

function forwardArticleEvent(
  emit: ((event: OpenZreadStdioEvent) => void) | undefined,
  event: ArticleEventPayload,
  progress: { current: number; total: number },
): void {
  const terminal = event.type === 'page_complete' || event.type === 'page_error';
  if (terminal) {
    progress.current += 1;
  }
  emitEvent(emit, {
    status: 'running',
    phase: `page-${event.type}`,
    message: event.slug,
    ...(terminal ? { progress: { ...progress } } : {}),
  });
}

async function readConfiguredConcurrency(): Promise<number> {
  const config = await loadConfig();
  if (!config.llm.provider || !config.llm.model || !config.llm.api_key) {
    throw new Error('OpenZread model configuration is incomplete; configure the Hub shared model first.');
  }
  return Number.isInteger(config.concurrency.max_concurrent) && config.concurrency.max_concurrent > 0
    ? config.concurrency.max_concurrent
    : 1;
}

export async function runOpenZreadStdio(options: OpenZreadStdioRunOptions): Promise<void> {
  const projectRoot = resolve(options.projectRoot);
  const emit = options.emit;
  const backup = await backupWiki(projectRoot);
  const application = createOpenZreadApplication(projectRoot);

  try {
    const concurrency = await readConfiguredConcurrency();
    emitEvent(emit, {
      status: 'running',
      phase: options.operation === 'sync' ? 'detecting-changes' : 'starting',
    });

    let pages: WikiPage[];
    if (options.operation === 'sync') {
      const sync = await application.syncWiki((event) => forwardCatalogEvent(emit, event));
      pages = [...sync.diff.newPages, ...sync.diff.updatedPages];
      emitEvent(emit, {
        status: 'running',
        phase: 'sync-plan-complete',
        message: `${pages.length} page(s) require generation`,
      });
    } else {
      await application.generateWikiCatalog((event) => forwardCatalogEvent(emit, event));
      pages = await application.readWikiBlueprint().then((blueprint) => blueprint.pages);
      emitEvent(emit, {
        status: 'running',
        phase: 'catalog-complete',
        message: `${pages.length} page(s) planned`,
      });
    }

    const progress = { current: 0, total: pages.length };
    if (pages.length > 0) {
      const result = await application.generateWikiContent({
        pages,
        maxConcurrent: concurrency,
        onEvent: (event) => forwardArticleEvent(emit, event, progress),
      });
      if (result.failed > 0 || result.completed !== result.total) {
        throw new Error(`Wiki content generation was incomplete: ${result.completed}/${result.total} pages succeeded.`);
      }
    }

    const validatedPages = await validateWikiOutput(projectRoot);
    emitEvent(emit, {
      status: 'succeeded',
      phase: 'validated',
      message: `${validatedPages.length} page(s) validated`,
      progress: { current: validatedPages.length, total: validatedPages.length },
    });
  } catch (error) {
    await restoreWiki(backup);
    const message = error instanceof Error ? error.message : String(error);
    emitEvent(emit, {
      status: 'failed',
      phase: 'failed',
      message,
    });
    throw error;
  } finally {
    await disposeBackup(backup);
  }
}

export async function runOpenZreadStdioCommand(
  projectRoot: string,
  operation: OpenZreadStdioOperation,
): Promise<void> {
  await runOpenZreadStdio({
    projectRoot,
    operation,
    emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
}
