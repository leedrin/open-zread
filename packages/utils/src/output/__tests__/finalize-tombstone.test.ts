import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWiki } from '../finalize.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}

describe('finalize tombstone handling', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('tombstoned page is excluded from _sidebar.md', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fin-'));
    const pages = [
      page({ slug: 'alive', title: 'Alive', file: 'alive.md', section: 'Sec', status: 'active' }),
      page({ slug: 'dead', title: 'Dead', file: 'dead.md', section: 'Sec', status: 'tombstone' }),
    ];
    for (const p of pages) {
      mkdirSync(join(dir, p.section), { recursive: true });
      writeFileSync(join(dir, p.section, p.file), '# x\n', 'utf-8');
    }
    await finalizeWiki(dir, { pages });
    const sidebar = readFileSync(join(dir, '_sidebar.md'), 'utf-8');
    expect(sidebar).toContain('Alive');
    expect(sidebar).not.toContain('Dead');
  });
});
