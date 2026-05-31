import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBaseFromSnapshot } from '../base-loader.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}

function writeWiki(dir: string, pages: WikiPage[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wiki.json'),
    JSON.stringify({ id: 'w', generated_at: 't', language: 'zh', pages }), 'utf-8');
}

describe('loadBaseFromSnapshot', () => {
  let testDir = '';
  let originalCwd = '';

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  function wikiDir() { return join(testDir, '.open-zread', 'wiki'); }

  test('returns null when no snapshot exists', async () => {
    expect(await loadBaseFromSnapshot()).toBeNull();
  });

  test('reads pages from the newest snapshot (migrated to have ids)', async () => {
    const versions = join(wikiDir(), 'versions');
    writeWiki(join(versions, '2026-05-01_0900_aaa'), [page({ slug: 'old', title: 'Old' })]);
    writeWiki(join(versions, '2026-05-02_0900_bbb'), [page({ slug: 'new', title: 'New' })]);
    const base = await loadBaseFromSnapshot();
    expect(base).not.toBeNull();
    if (base === null) return;
    expect(base.map((p) => p.title)).toEqual(['New']);
    expect(base[0].id).toBeDefined();
  });

  test('ignores a snapshot dir without wiki.json', async () => {
    const versions = join(wikiDir(), 'versions');
    mkdirSync(join(versions, 'empty-snap'), { recursive: true });
    writeWiki(join(versions, '2026-05-01_0900_aaa'), [page({ slug: 'ok' })]);
    const base = await loadBaseFromSnapshot();
    expect(base).not.toBeNull();
    expect(base).toHaveLength(1);
  });
});
