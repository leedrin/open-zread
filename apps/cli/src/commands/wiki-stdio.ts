import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createOpenZreadApplication,
  type OpenZreadApplicationDependencies,
  type ArticleEventPayload,
  type CatalogEvent,
} from '@open-zread/orchestrator';
import { createProvider } from '@open-zread/agent-sdk';
import {
  getWikiDir,
  loadConfig,
  loadWikiBlueprint,
  logger,
} from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';
import {
  fingerprintGenerationPlan,
  hydrateGenerationCheckpoint,
  removeGenerationCheckpoint,
  saveGenerationCheckpoint,
  type GenerationCheckpoint,
} from './wiki-generation-checkpoint';

export type OpenZreadStdioOperation = 'generate' | 'sync' | 'ask' | 'rewrite' | 'draft';

export interface OpenZreadAskInput {
  question: string;
  pageTitle?: string;
  pageSlug?: string;
  pageContent?: string;
  selectedText?: string;
}

export interface OpenZreadRewriteInput {
  instruction: string;
  pageTitle?: string;
  pageSlug?: string;
  pageContent: string;
  sectionHeading?: string;
}

export interface OpenZreadDraftInput {
  topic: string;
  section?: string;
  existingSections?: string[];
}

export interface OpenZreadStdioEvent {
  kind: 'generation';
  status: 'running' | 'succeeded' | 'failed';
  phase: string;
  message?: string;
  details?: string;
  progress?: { current: number; total: number; succeeded: number; failed: number };
  canResume?: boolean;
}

export interface OpenZreadStdioRunOptions {
  projectRoot: string;
  operation: 'generate' | 'sync';
  resume?: boolean;
  applicationDependencies?: OpenZreadApplicationDependencies;
  generationSettings?: { concurrency: number; modelIdentity: string };
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
  progress: { current: number; total: number; succeeded: number; failed: number },
): void {
  const terminal = event.type === 'page_complete' || event.type === 'page_error';
  if (terminal) {
    progress.current += 1;
    if (event.type === 'page_complete') progress.succeeded += 1;
    else progress.failed += 1;
  }
  emitEvent(emit, {
    status: 'running',
    phase: `page-${event.type}`,
    message: event.error ? `${event.slug}: ${event.error}` : event.slug,
    ...(terminal ? { progress: { ...progress } } : {}),
  });
}

async function readConfiguredGenerationSettings(): Promise<{ concurrency: number; modelIdentity: string }> {
  const config = await loadConfig();
  if (!config.llm.provider || !config.llm.model || !config.llm.api_key) {
    throw new Error('OpenZread model configuration is incomplete; configure the Hub shared model first.');
  }
  return {
    concurrency: Number.isInteger(config.concurrency.max_concurrent) && config.concurrency.max_concurrent > 0
      ? config.concurrency.max_concurrent
      : 1,
    modelIdentity: `${config.llm.provider}/${config.llm.model}`,
  };
}

function askSystemPrompt(input: OpenZreadAskInput): string {
  return [
    'You are a documentation reading assistant for the supplied local project document.',
    'Answer primarily from the supplied page context and selected text.',
    'If the context is insufficient, say what is missing instead of guessing.',
    'Do not claim access to files or runtime state beyond the supplied context.',
    input.pageTitle || input.pageSlug
      ? `Current page: ${input.pageTitle ?? 'Untitled'}${input.pageSlug ? ` (${input.pageSlug})` : ''}`
      : undefined,
    input.selectedText ? `Selected text:\n${input.selectedText}` : undefined,
    input.pageContent ? `Page content:\n${input.pageContent}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('\n\n');
}

async function runAskStdio(input: OpenZreadAskInput): Promise<void> {
  if (!input.question?.trim()) {
    throw new Error('A question is required.');
  }
  const config = await loadConfig();
  if (!config.llm.provider || !config.llm.model || !config.llm.api_key) {
    throw new Error('OpenZread model configuration is incomplete; configure the Hub shared model first.');
  }
  const provider = createProvider(config.llm.provider, {
    apiKey: config.llm.api_key,
    baseURL: config.llm.base_url ?? undefined,
  });
  const response = await provider.createMessage({
    model: config.llm.model,
    maxTokens: 1200,
    system: askSystemPrompt(input),
    messages: [{ role: 'user', content: input.question.trim() }],
  });
  const answer = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  process.stdout.write(`${JSON.stringify({
    kind: 'qa',
    status: 'succeeded',
    answer: answer || 'The model returned no displayable text.',
    model: `${config.llm.provider}/${config.llm.model}`,
    references: input.pageSlug ? [{ slug: input.pageSlug, title: input.pageTitle ?? 'Untitled' }] : [],
  })}\n`);
}

async function runRewriteStdio(input: OpenZreadRewriteInput): Promise<void> {
  if (!input.instruction?.trim() || typeof input.pageContent !== 'string') {
    throw new Error('Rewrite instruction and page content are required.');
  }
  const config = await loadConfig();
  if (!config.llm.provider || !config.llm.model || !config.llm.api_key) {
    throw new Error('OpenZread model configuration is incomplete; configure the Hub shared model first.');
  }
  const scope = input.sectionHeading?.trim()
    ? `Only rewrite the Markdown section whose heading is exactly "${input.sectionHeading.trim()}" and its children. Preserve every line outside that section exactly.`
    : 'Rewrite the complete page while preserving valid Markdown and the page topic.';
  const provider = createProvider(config.llm.provider, {
    apiKey: config.llm.api_key,
    baseURL: config.llm.base_url ?? undefined,
  });
  const response = await provider.createMessage({
    model: config.llm.model,
    maxTokens: 4000,
    system: [
      'You are a Wiki Markdown editor.',
      scope,
      'Return only the complete resulting Markdown document. Do not wrap it in a code fence. Do not explain your changes.',
      input.pageTitle || input.pageSlug
        ? `Page: ${input.pageTitle ?? 'Untitled'}${input.pageSlug ? ` (${input.pageSlug})` : ''}`
        : undefined,
    ].filter((value): value is string => Boolean(value)).join('\n\n'),
    messages: [{
      role: 'user',
      content: `Instruction:\n${input.instruction.trim()}\n\nCurrent Markdown:\n${input.pageContent}`,
    }],
  });
  const after = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!after) {
    throw new Error('The model returned no Markdown draft.');
  }
  process.stdout.write(`${JSON.stringify({ kind: 'rewrite', status: 'succeeded', after })}\n`);
}

async function runDraftStdio(input: OpenZreadDraftInput): Promise<void> {
  if (!input.topic?.trim()) {
    throw new Error('A page topic is required.');
  }
  const config = await loadConfig();
  if (!config.llm.provider || !config.llm.model || !config.llm.api_key) {
    throw new Error('OpenZread model configuration is incomplete; configure the Hub shared model first.');
  }
  const provider = createProvider(config.llm.provider, {
    apiKey: config.llm.api_key,
    baseURL: config.llm.base_url ?? undefined,
  });
  const response = await provider.createMessage({
    model: config.llm.model,
    maxTokens: 4000,
    system: [
      'You create a draft Wiki page for a local code knowledge base.',
      'Return only valid JSON with keys slug, title, section, content, associatedFiles.',
      'slug and section must be safe single path components; associatedFiles must be an array of project-relative paths.',
      'The draft is not applied yet and must not claim that files were changed.',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: JSON.stringify({
        topic: input.topic.trim(),
        requestedSection: input.section?.trim() || undefined,
        existingSections: input.existingSections ?? [],
      }),
    }],
  });
  const text = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const draft = JSON.parse(text) as Record<string, unknown>;
  if (typeof draft.slug !== 'string' || typeof draft.title !== 'string'
    || typeof draft.section !== 'string' || typeof draft.content !== 'string'
    || !Array.isArray(draft.associatedFiles)) {
    throw new Error('The model returned an invalid Wiki page draft.');
  }
  process.stdout.write(`${JSON.stringify({
    kind: 'draft',
    status: 'succeeded',
    slug: draft.slug,
    title: draft.title,
    section: draft.section,
    content: draft.content,
    associatedFiles: draft.associatedFiles.filter((path): path is string => typeof path === 'string'),
  })}\n`);
}

export async function runOpenZreadStdio(options: OpenZreadStdioRunOptions): Promise<void> {
  const projectRoot = resolve(options.projectRoot);
  const emit = options.emit;
  const backup = await backupWiki(projectRoot);
  const application = createOpenZreadApplication(projectRoot, options.applicationDependencies);
  let plannedPages: WikiPage[] = [];
  let planFingerprint: string | undefined;
  let completedSlugs: string[] = [];
  let progress: { current: number; total: number; succeeded: number; failed: number } | undefined;
  let failureDetails: string | undefined;

  try {
    if (!options.resume) await removeGenerationCheckpoint(projectRoot);
    const generationSettings = options.generationSettings ?? await readConfiguredGenerationSettings();
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

    plannedPages = pages;
    planFingerprint = await fingerprintGenerationPlan(
      projectRoot,
      options.operation,
      plannedPages,
      generationSettings.modelIdentity,
    );
    const wikiRoot = resolve(getWikiDir(projectRoot));
    if (options.resume) {
      const checkpoint = await hydrateGenerationCheckpoint(
        projectRoot,
        wikiRoot,
        plannedPages,
        options.operation,
        planFingerprint,
      );
      if (!checkpoint) {
        throw new Error('No saved generation progress is available to continue. Choose “Start over” to generate a fresh Wiki.');
      }
      completedSlugs = [...checkpoint.completedSlugs];
    }
    const completed = new Set(completedSlugs);
    const pagesToGenerate = pages.filter((page) => !completed.has(page.slug));
    progress = { current: completed.size, total: pages.length, succeeded: completed.size, failed: 0 };
    const pageProgress = progress;
    if (pagesToGenerate.length > 0) {
      const result = await application.generateWikiContent({
        pages: pagesToGenerate,
        maxConcurrent: generationSettings.concurrency,
        onEvent: (event) => forwardArticleEvent(emit, event, pageProgress),
      });
      completedSlugs = [...new Set([
        ...completedSlugs,
        ...result.results.filter((page) => page.success).map((page) => page.slug),
      ])];
      progress.succeeded = completedSlugs.length;
      progress.failed = result.failed;
      progress.current = Math.min(progress.total, progress.succeeded + progress.failed);
      if (result.failed > 0 || result.completed !== result.total) {
        const failures = result.results
          .filter((page) => !page.success)
          .map((page) => `${page.slug}: ${page.error || 'Unknown page generation error'}`);
        failureDetails = failures.join('\n') || undefined;
        throw new Error(`Wiki content generation was incomplete: ${progress.succeeded}/${progress.total} pages succeeded; ${progress.failed} failed.`);
      }
    }

    const validatedPages = await validateWikiOutput(projectRoot);
    try {
      await removeGenerationCheckpoint(projectRoot);
    } catch (cleanupError) {
      logger.warn(`Unable to remove the completed Wiki generation checkpoint: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    emitEvent(emit, {
      status: 'succeeded',
      phase: 'validated',
      message: `${validatedPages.length} page(s) validated`,
      progress: {
        current: validatedPages.length,
        total: validatedPages.length,
        succeeded: validatedPages.length,
        failed: 0,
      },
      canResume: false,
    });
  } catch (error) {
    let canResume = false;
    if (planFingerprint && plannedPages.length > 0 && completedSlugs.length > 0) {
      try {
        const checkpoint: GenerationCheckpoint = {
          version: 1,
          operation: options.operation,
          planFingerprint,
          completedSlugs,
          savedAt: new Date().toISOString(),
        };
        await saveGenerationCheckpoint(projectRoot, resolve(getWikiDir(projectRoot)), plannedPages, checkpoint);
        canResume = true;
      } catch (checkpointError) {
        logger.error(`Unable to save Wiki generation progress: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
      }
    }
    await restoreWiki(backup);
    const message = error instanceof Error ? error.message : String(error);
    emitEvent(emit, {
      status: 'failed',
      phase: 'failed',
      message,
      ...(failureDetails || (error instanceof Error && error.stack !== error.message)
        ? { details: failureDetails ?? (error as Error).stack }
        : {}),
      ...(progress ? { progress: { ...progress } } : {}),
      canResume,
    });
    throw error;
  } finally {
    await disposeBackup(backup);
  }
}

export async function runOpenZreadStdioCommand(
  projectRoot: string,
  operation: OpenZreadStdioOperation,
  resume = false,
): Promise<void> {
  if (operation === 'ask' || operation === 'rewrite' || operation === 'draft') {
    const input = await new Promise<string>((resolveInput, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      process.stdin.on('end', () => resolveInput(Buffer.concat(chunks).toString('utf8')));
      process.stdin.on('error', reject);
    });
    if (operation === 'ask') {
      await runAskStdio(JSON.parse(input) as OpenZreadAskInput);
    } else if (operation === 'rewrite') {
      await runRewriteStdio(JSON.parse(input) as OpenZreadRewriteInput);
    } else {
      await runDraftStdio(JSON.parse(input) as OpenZreadDraftInput);
    }
    return;
  }
  await runOpenZreadStdio({
    projectRoot,
    operation,
    resume,
    emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
}
