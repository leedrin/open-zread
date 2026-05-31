import { describe, test, expect, afterEach } from 'bun:test';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWikiBlueprint } from '../../output/wiki-content.js';

describe('loadWikiBlueprint migration', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('legacy wiki.json gets ids/metadata on load', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wc-'));
    const file = join(dir, 'wiki.json');
    writeFileSync(file, JSON.stringify({
      id: 'w', generated_at: 't', language: 'zh',
      pages: [{ slug: 's1', title: 'T', file: 's1.md', section: 'S', level: 'Beginner' }],
    }), 'utf-8');

    const bp = await loadWikiBlueprint(file);
    const p = bp.pages[0];
    expect(p.id).toBeDefined();
    expect(p.origin).toBe('ai');
    expect(p.status).toBe('active');
  });

  test('locked/human metadata survives round-trip', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wc-'));
    const file = join(dir, 'wiki.json');
    writeFileSync(file, JSON.stringify({
      id: 'w', generated_at: 't', language: 'zh',
      pages: [{ slug: 's1', title: 'T', file: 's1.md', section: 'S', level: 'Beginner',
                id: 'fixed', origin: 'human', locked: true, status: 'active' }],
    }), 'utf-8');

    const bp = await loadWikiBlueprint(file);
    expect(bp.pages[0].locked).toBe(true);
    expect(bp.pages[0].origin).toBe('human');
    expect(bp.pages[0].id).toBe('fixed');
  });
});
