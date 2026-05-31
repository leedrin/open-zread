import { describe, test, expect } from 'bun:test';
import { deriveId, migrateCatalog } from '../migrate.js';
import type { WikiOutput, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage> = {}): WikiPage {
  return { slug: 'x', title: 'X', file: 'x.md', section: 'S', level: 'Intermediate', ...p };
}

function out(pages: WikiPage[]): WikiOutput {
  return { id: 'w', generated_at: 't', language: 'zh', pages };
}

describe('deriveId', () => {
  test('is deterministic for the same slug', () => {
    expect(deriveId('1-overview')).toBe(deriveId('1-overview'));
  });
  test('differs for different slugs', () => {
    expect(deriveId('a')).not.toBe(deriveId('b'));
  });
});

describe('migrateCatalog', () => {
  test('backfills id/origin/locked/status on legacy pages', () => {
    const m = migrateCatalog(out([page({ slug: 's1' })]));
    const p = m.pages[0];
    expect(p.id).toBe(deriveId('s1'));
    expect(p.origin).toBe('ai');
    expect(p.locked).toBe(false);
    expect(p.status).toBe('active');
  });
  test('is idempotent and preserves existing metadata', () => {
    const once = migrateCatalog(out([page({ slug: 's1', id: 'fixed', origin: 'human', locked: true })]));
    const twice = migrateCatalog(once);
    expect(twice.pages[0].id).toBe('fixed');
    expect(twice.pages[0].origin).toBe('human');
    expect(twice.pages[0].locked).toBe(true);
  });
});
