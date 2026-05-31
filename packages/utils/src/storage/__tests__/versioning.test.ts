import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVersionSnapshot, generateSnapshotName } from '../versioning.js';

describe('createVersionSnapshot', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `versioning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  function wikiDir(): string {
    return join(testDir, '.open-zread', 'wiki');
  }

  test('copies real section content and excludes versions/', async () => {
    const wiki = wikiDir();
    mkdirSync(join(wiki, '入门指南'), { recursive: true });
    writeFileSync(join(wiki, '入门指南', '1-overview.md'), '# Overview\n', 'utf-8');
    writeFileSync(join(wiki, 'wiki.json'), '{"pages":[]}', 'utf-8');
    // pre-existing versions/ must NOT be copied into the new snapshot
    mkdirSync(join(wiki, 'versions', 'old-snap'), { recursive: true });
    writeFileSync(join(wiki, 'versions', 'old-snap', 'stale.md'), 'old', 'utf-8');

    const name = await createVersionSnapshot();
    expect(name).not.toBe('');

    const snapPath = join(wiki, 'versions', name);
    expect(existsSync(join(snapPath, '入门指南', '1-overview.md'))).toBe(true);
    expect(existsSync(join(snapPath, 'wiki.json'))).toBe(true);
    // no recursive nesting of versions/
    expect(existsSync(join(snapPath, 'versions'))).toBe(false);
  });

  test('returns empty string when wiki dir is missing', async () => {
    const name = await createVersionSnapshot();
    expect(name).toBe('');
  });

  test('returns empty string when wiki only contains versions/', async () => {
    mkdirSync(join(wikiDir(), 'versions', 'prev'), { recursive: true });
    const name = await createVersionSnapshot();
    expect(name).toBe('');
  });

  test('snapshot name has date_time_commit shape', () => {
    const name = generateSnapshotName();
    // YYYY-MM-DD_HHMM_<hash|unknown>
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_.+$/);
  });
});
