import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppConfig, WikiPage } from '@open-zread/types';
import type { GenerateWikiOptions, WikiResult } from '@open-zread/orchestrator';
import { generateWikiJson } from '@open-zread/utils';
import { runOpenZreadStdio, type OpenZreadStdioEvent } from '../wiki-stdio';
import {
  fingerprintGenerationPlan,
  hydrateGenerationCheckpoint,
  saveGenerationCheckpoint,
  type GenerationCheckpoint,
} from '../wiki-generation-checkpoint';

const tempRoots: string[] = [];

async function createProject() {
  const root = await mkdtemp(join(tmpdir(), 'open-zread-checkpoint-test-'));
  tempRoots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'main.lua'), 'print("before")', 'utf8');
  return root;
}

const pages: WikiPage[] = [
  { slug: 'intro', title: 'Intro', section: 'guide', file: 'intro.md', level: 'Beginner', associatedFiles: ['src/main.lua'] },
  { slug: 'api', title: 'API', section: 'guide', file: 'api.md', level: 'Intermediate', associatedFiles: ['src/main.lua'] },
];

describe('OpenZread generation checkpoints', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test('preserves successful pages outside the live Wiki and restores them for continuation', async () => {
    const root = await createProject();
    const wikiRoot = join(root, '.open-zread', 'wiki');
    await mkdir(join(wikiRoot, 'guide'), { recursive: true });
    await writeFile(join(wikiRoot, 'guide', 'intro.md'), '# Generated Intro', 'utf8');
    const planFingerprint = await fingerprintGenerationPlan(root, 'generate', pages, 'provider/model');
    const checkpoint: GenerationCheckpoint = {
      version: 1,
      operation: 'generate',
      planFingerprint,
      completedSlugs: ['intro'],
      savedAt: new Date().toISOString(),
    };

    await saveGenerationCheckpoint(root, wikiRoot, pages, checkpoint);
    await rm(wikiRoot, { recursive: true, force: true });
    await mkdir(wikiRoot, { recursive: true });

    const resumed = await hydrateGenerationCheckpoint(root, wikiRoot, pages, 'generate', planFingerprint);
    expect(resumed?.completedSlugs).toEqual(['intro']);
    expect(await readFile(join(wikiRoot, 'guide', 'intro.md'), 'utf8')).toBe('# Generated Intro');
    await expect(readFile(join(wikiRoot, 'guide', 'api.md'), 'utf8')).rejects.toThrow();
  });

  test('rejects a checkpoint after associated source contents change', async () => {
    const root = await createProject();
    const wikiRoot = join(root, '.open-zread', 'wiki');
    await mkdir(join(wikiRoot, 'guide'), { recursive: true });
    await writeFile(join(wikiRoot, 'guide', 'intro.md'), '# Generated Intro', 'utf8');
    const original = await fingerprintGenerationPlan(root, 'generate', pages, 'provider/model');
    await saveGenerationCheckpoint(root, wikiRoot, pages, {
      version: 1,
      operation: 'generate',
      planFingerprint: original,
      completedSlugs: ['intro'],
      savedAt: new Date().toISOString(),
    });
    await writeFile(join(root, 'src', 'main.lua'), 'print("after")', 'utf8');
    const changed = await fingerprintGenerationPlan(root, 'generate', pages, 'provider/model');
    expect(changed).not.toBe(original);
    await expect(hydrateGenerationCheckpoint(root, join(root, '.open-zread', 'wiki'), pages, 'generate', changed))
      .rejects.toThrow('does not match the current project and generation plan');
  });

  test('failed stdio generation rolls back the live Wiki, then resumes only unfinished pages', async () => {
    const root = await createProject();
    const wikiRoot = join(root, '.open-zread', 'wiki');
    await mkdir(wikiRoot, { recursive: true });
    await writeFile(join(wikiRoot, 'existing.md'), '# Existing Wiki', 'utf8');
    const config: AppConfig = {
      language: 'en', doc_language: 'en',
      llm: { provider: 'test-provider', model: 'test-model', api_key: 'test-key', base_url: null },
      concurrency: { max_concurrent: 1, max_retries: 0 },
    };
    const generatedBatches: string[][] = [];
    let invocation = 0;
    const applicationDependencies = {
      refreshProjectIndex: async () => ({
        manifest: { files: [], totalFiles: 0, totalSize: 0 },
        symbols: { symbols: [], loadedParsers: [] },
      }),
      generateWikiCatalog: async (options: { projectRoot?: string }) => {
        await generateWikiJson(pages, config, undefined, options.projectRoot);
        return { pagesCount: pages.length, durationMs: 1 };
      },
      generateWikiContent: async (options: GenerateWikiOptions): Promise<WikiResult> => {
        const batch = options.pages ?? [];
        generatedBatches.push(batch.map((page) => page.slug));
        invocation += 1;
        for (const page of batch) {
          if (invocation === 1 && page.slug === 'api') {
            options.onEvent?.({ type: 'page_error', slug: 'api', error: 'HTTP 429: provider quota exceeded' });
            continue;
          }
          const output = join(wikiRoot, page.section, page.file);
          await mkdir(join(output, '..'), { recursive: true });
          await writeFile(output, `# Generated ${page.title}`, 'utf8');
        }
        const succeeded = invocation === 1 ? batch.filter((page) => page.slug === 'intro') : batch;
        const failed = invocation === 1 ? batch.filter((page) => page.slug === 'api') : [];
        if (invocation === 1) options.onEvent?.({ type: 'page_complete', slug: 'intro' });
        return {
          total: batch.length,
          completed: succeeded.length,
          failed: failed.length,
          durationMs: 1,
          results: [
            ...succeeded.map((page) => ({ slug: page.slug, success: true, outputPath: page.file })),
            ...failed.map((page) => ({ slug: page.slug, success: false, error: 'temporary quota error' })),
          ],
        };
      },
    };
    const events: OpenZreadStdioEvent[] = [];

    await expect(runOpenZreadStdio({
      projectRoot: root,
      operation: 'generate',
      generationSettings: { concurrency: 1, modelIdentity: 'test-provider/test-model' },
      applicationDependencies,
      emit: (event) => events.push(event),
    })).rejects.toThrow('2 pages succeeded');

    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      canResume: true,
      message: 'Wiki content generation was incomplete: 1/2 pages succeeded; 1 failed.',
      details: 'api: temporary quota error',
      progress: { current: 2, total: 2, succeeded: 1, failed: 1 },
    });
    expect(await readFile(join(wikiRoot, 'existing.md'), 'utf8')).toBe('# Existing Wiki');
    await expect(readFile(join(wikiRoot, 'guide', 'intro.md'), 'utf8')).rejects.toThrow();

    await runOpenZreadStdio({
      projectRoot: root,
      operation: 'generate',
      resume: true,
      generationSettings: { concurrency: 1, modelIdentity: 'test-provider/test-model' },
      applicationDependencies,
      emit: (event) => events.push(event),
    });

    expect(generatedBatches).toEqual([['intro', 'api'], ['api']]);
    expect(await readFile(join(wikiRoot, 'guide', 'intro.md'), 'utf8')).toBe('# Generated Intro');
    expect(await readFile(join(wikiRoot, 'guide', 'api.md'), 'utf8')).toBe('# Generated API');
    await expect(readFile(join(root, '.open-zread', '.hub-generation-checkpoint', 'manifest.json'), 'utf8')).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ status: 'succeeded', canResume: false, progress: { current: 2, total: 2 } });
  });
});
