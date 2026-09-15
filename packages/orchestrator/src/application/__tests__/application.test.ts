import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { FileManifest, WikiPage } from '@open-zread/types';
import {
  DEFAULT_CONFIG,
  loadCachedManifest,
  saveCachedManifest,
} from '@open-zread/utils';
import {
  createOpenZreadApplication,
  type OpenZreadApplicationDependencies,
} from '../index.js';

function page(slug: string): WikiPage {
  return {
    slug,
    title: slug,
    file: `${slug}.md`,
    section: 'guides',
    level: 'Beginner',
  };
}

function manifest(path: string, hash: string): FileManifest {
  return {
    files: [{
      path,
      hash,
      size: 1,
      language: 'typescript',
      lastModified: new Date(0).toISOString(),
    }],
    totalFiles: 1,
    totalSize: 1,
  };
}

describe('OpenZread application service', () => {
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    projectA = mkdtempSync(join(tmpdir(), 'open-zread-project-a-'));
    projectB = mkdtempSync(join(tmpdir(), 'open-zread-project-b-'));
  });

  afterEach(() => {
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  });

  test('keeps blueprint reads and writes isolated across interleaved projects', async () => {
    const appA = createOpenZreadApplication(projectA);
    const appB = createOpenZreadApplication(projectB);

    await Promise.all([
      appA.generateWikiBlueprint([page('project-a')], DEFAULT_CONFIG),
      appB.generateWikiBlueprint([page('project-b')], DEFAULT_CONFIG),
      saveCachedManifest(manifest('a.ts', 'hash-a'), projectA),
      saveCachedManifest(manifest('b.ts', 'hash-b'), projectB),
    ]);

    const [blueprintA, blueprintB] = await Promise.all([
      appA.readWikiBlueprint(),
      appB.readWikiBlueprint(),
    ]);

    expect(blueprintA.pages.map((item) => item.slug)).toEqual(['project-a']);
    expect(blueprintB.pages.map((item) => item.slug)).toEqual(['project-b']);
    const [cachedA, cachedB] = await Promise.all([
      loadCachedManifest(projectA),
      loadCachedManifest(projectB),
    ]);
    expect(cachedA?.files.map((item) => item.path)).toEqual(['a.ts']);
    expect(cachedB?.files.map((item) => item.path)).toEqual(['b.ts']);
    expect(existsSync(join(projectA, '.open-zread', 'wiki', 'project-b.md'))).toBe(false);
    expect(existsSync(join(projectB, '.open-zread', 'wiki', 'project-a.md'))).toBe(false);

    const storedA = JSON.parse(
      readFileSync(join(projectA, '.open-zread', 'wiki', 'wiki.json'), 'utf8'),
    ) as { pages: WikiPage[] };
    expect(storedA.pages[0]?.slug).toBe('project-a');
  });

  test('runs no-change sync against each project without changing process cwd', async () => {
    const originalCwd = process.cwd();
    const appA = createOpenZreadApplication(projectA);
    const appB = createOpenZreadApplication(projectB);
    const emptyManifest: FileManifest = { files: [], totalFiles: 0, totalSize: 0 };

    await Promise.all([
      appA.generateWikiBlueprint([page('project-a')], DEFAULT_CONFIG),
      appB.generateWikiBlueprint([page('project-b')], DEFAULT_CONFIG),
      saveCachedManifest(emptyManifest, projectA),
      saveCachedManifest(emptyManifest, projectB),
    ]);

    const [resultA, resultB] = await Promise.all([appA.syncWiki(), appB.syncWiki()]);

    expect(resultA.diff).toEqual({ newPages: [], updatedPages: [], archivedPages: [] });
    expect(resultB.diff).toEqual({ newPages: [], updatedPages: [], archivedPages: [] });
    expect(process.cwd()).toBe(originalCwd);
  });

  test('routes catalog, content, and sync through the explicit project context', async () => {
    const calls: string[] = [];
    const dependencies: OpenZreadApplicationDependencies = {
      refreshProjectIndex: async (root) => {
        calls.push(`refresh:${root}`);
        return {
          manifest: { files: [], totalFiles: 0, totalSize: 0 },
          symbols: { symbols: [], loadedParsers: [] },
        };
      },
      generateWikiCatalog: async (options) => {
        calls.push(`catalog:${options?.projectRoot}`);
        return { pagesCount: 0, durationMs: 0 };
      },
      generateWikiContent: async (options) => {
        calls.push(`content:${options?.projectRoot}`);
        return { total: 0, completed: 0, failed: 0, durationMs: 0, results: [] };
      },
      syncWiki: async (options) => {
        calls.push(`sync:${options?.projectRoot}`);
        return {
          diff: { newPages: [], updatedPages: [], archivedPages: [] },
          durationMs: 0,
        };
      },
    };

    const appA = createOpenZreadApplication(projectA, dependencies);
    const appB = createOpenZreadApplication(projectB, dependencies);

    await Promise.all([
      appA.generateWikiCatalog(),
      appB.generateWikiContent(),
      appA.syncWiki(),
      appB.generateWikiCatalog(),
      appA.generateWikiContent(),
      appB.syncWiki(),
    ]);

    expect(calls.sort()).toEqual([
      `refresh:${projectA}`,
      `refresh:${projectB}`,
      `catalog:${projectA}`,
      `content:${projectB}`,
      `sync:${projectA}`,
      `catalog:${projectB}`,
      `content:${projectA}`,
      `sync:${projectB}`,
    ].sort());
  });
});
