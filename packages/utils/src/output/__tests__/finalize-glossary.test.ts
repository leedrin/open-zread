import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWiki } from '../finalize.js';
import { GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE } from '../glossary-page.js';
import type { GlossaryTerm, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('finalize glossary page', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('writes glossary.md and lists it in the sidebar', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fg-'));
    const pages = [page({ slug: 'skill', title: '技能系统', file: 'skill.md', section: 'Sec', concepts: ['技能系统'] })];
    mkdirSync(join(dir, 'Sec'), { recursive: true });
    writeFileSync(join(dir, 'Sec', 'skill.md'), '# x\n', 'utf-8');
    const glossary: GlossaryTerm[] = [{ term: '技能系统', definition: 'def', canonicalPage: 'skill' }];

    await finalizeWiki(dir, { pages, glossary });

    expect(existsSync(join(dir, GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE))).toBe(true);
    const sidebar = readFileSync(join(dir, '_sidebar.md'), 'utf-8');
    expect(sidebar).toContain('统一术语表');
  });
});
