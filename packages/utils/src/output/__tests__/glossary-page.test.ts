import { describe, test, expect } from 'bun:test';
import { renderGlossaryPage, ensureGlossaryPage, GLOSSARY_PAGE_ID } from '../glossary-page.js';
import type { GlossaryTerm, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

const glossary: GlossaryTerm[] = [
  { term: '技能系统', aliases: ['技能与战斗系统'], definition: '技能的注册与释放', canonicalPage: 'skill' },
];
const pages: WikiPage[] = [
  page({ slug: 'skill', title: '技能系统', concepts: ['技能系统'] }),
  page({ slug: 'combat', title: '战斗', concepts: ['技能系统', '战斗'] }),
];

describe('renderGlossaryPage', () => {
  test('renders term name, aliases, definition', () => {
    const md = renderGlossaryPage(glossary, pages);
    expect(md).toContain('技能系统');
    expect(md).toContain('技能与战斗系统');
    expect(md).toContain('技能的注册与释放');
  });
  test('renders bidirectional appears-in mapping', () => {
    const md = renderGlossaryPage(glossary, pages);
    expect(md).toContain('技能系统');
    expect(md).toContain('战斗');
  });
  test('ignores tombstoned pages in appears-in', () => {
    const withDead = [...pages, page({ slug: 'dead', title: 'Dead', concepts: ['技能系统'], status: 'tombstone' })];
    const md = renderGlossaryPage(glossary, withDead);
    expect(md).not.toContain('Dead');
  });
});

describe('ensureGlossaryPage', () => {
  test('injects a reserved glossary page when absent', () => {
    const out = ensureGlossaryPage(pages);
    const g = out.find((p) => p.id === GLOSSARY_PAGE_ID);
    expect(g).toBeDefined();
    expect(g?.docType).toBe('reference');
  });
  test('is idempotent', () => {
    const once = ensureGlossaryPage(pages);
    const twice = ensureGlossaryPage(once);
    expect(twice.filter((p) => p.id === GLOSSARY_PAGE_ID)).toHaveLength(1);
  });
});
