import { describe, test, expect } from 'bun:test';
import { buildCatalogTree } from '../tree.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('buildCatalogTree', () => {
  test('groups pages by section then group, preserving first-seen order', () => {
    const pages = [
      page({ id: 'a', section: 'Engine', group: 'Core', title: 'A' }),
      page({ id: 'b', section: 'Engine', title: 'B' }),
      page({ id: 'c', section: 'Combat', group: 'Skill', title: 'C' }),
      page({ id: 'd', section: 'Engine', group: 'Core', title: 'D' }),
    ];
    const tree = buildCatalogTree(pages);
    expect(tree.sections.map((s) => s.section)).toEqual(['Engine', 'Combat']);
    const engine = tree.sections[0];
    expect(engine.directPages.map((p) => p.id)).toEqual(['b']);
    expect(engine.groups.map((g) => g.group)).toEqual(['Core']);
    expect(engine.groups[0].pages.map((p) => p.id)).toEqual(['a', 'd']);
  });

  test('flat is the render/nav order: per section, direct pages then grouped pages', () => {
    const pages = [
      page({ id: 'a', section: 'Engine', group: 'Core' }),
      page({ id: 'b', section: 'Engine' }),
      page({ id: 'c', section: 'Combat' }),
    ];
    const tree = buildCatalogTree(pages);
    expect(tree.flat.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('excludes tombstoned pages by default', () => {
    const pages = [page({ id: 'a' }), page({ id: 'dead', status: 'tombstone' })];
    expect(buildCatalogTree(pages).flat.map((p) => p.id)).toEqual(['a']);
  });

  test('includes tombstoned pages when includeTombstoned=true', () => {
    const pages = [page({ id: 'a' }), page({ id: 'dead', status: 'tombstone' })];
    const tree = buildCatalogTree(pages, { includeTombstoned: true });
    expect(tree.flat.map((p) => p.id)).toEqual(['a', 'dead']);
  });
});
