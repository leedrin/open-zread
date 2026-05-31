import { describe, test, expect } from 'bun:test';
import { jaccard, pageContentEqual, alignRemote } from '../align.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('jaccard', () => {
  test('identical sets = 1', () => expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1));
  test('disjoint = 0', () => expect(jaccard(['a'], ['b'])).toBe(0));
  test('partial overlap', () => expect(jaccard(['a', 'b', 'c'], ['a', 'b'])).toBeCloseTo(2 / 3));
  test('both empty = 0', () => expect(jaccard([], [])).toBe(0));
});

describe('pageContentEqual', () => {
  test('same content fields = true (ignores id/origin/locked/status)', () => {
    const a = page({ id: 'x', title: 'T', section: 'S', locked: false });
    const b = page({ id: 'y', title: 'T', section: 'S', locked: true, origin: 'human' });
    expect(pageContentEqual(a, b)).toBe(true);
  });
  test('different title = false', () => {
    expect(pageContentEqual(page({ title: 'A' }), page({ title: 'B' }))).toBe(false);
  });
  test('different associatedFiles = false', () => {
    expect(pageContentEqual(page({ associatedFiles: ['a'] }), page({ associatedFiles: ['b'] }))).toBe(false);
  });
  test('associatedFiles order does not matter', () => {
    expect(pageContentEqual(page({ associatedFiles: ['x.ts', 'y.ts'] }), page({ associatedFiles: ['y.ts', 'x.ts'] }))).toBe(true);
  });
  test('concepts order does not matter', () => {
    expect(pageContentEqual(page({ concepts: ['A', 'B'] }), page({ concepts: ['B', 'A'] }))).toBe(true);
  });
});

describe('alignRemote', () => {
  test('exact id match: remote inherits existing id', () => {
    const existing = [page({ id: 'keep', title: 'Old' })];
    const remote = [page({ id: 'keep', title: 'New title' })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('keep');
  });

  test('concept-set match: renamed remote inherits id via shared concepts', () => {
    const existing = [page({ id: 'skill-id', title: '技能系统', concepts: ['技能系统'], associatedFiles: ['x.cs'] })];
    const remote = [page({ id: 'fresh', title: '技能与战斗系统', concepts: ['技能系统'], associatedFiles: ['y.cs'] })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('skill-id');
  });

  test('fingerprint fallback when concepts absent', () => {
    const existing = [page({ id: 'a-id', associatedFiles: ['f1.ts', 'f2.ts', 'f3.ts'] })];
    const remote = [page({ id: 'fresh', associatedFiles: ['f1.ts', 'f2.ts'] })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('a-id');
  });

  test('no match: remote keeps its own id (new page)', () => {
    const existing = [page({ id: 'a-id', concepts: ['X'], associatedFiles: ['f1.ts'] })];
    const remote = [page({ id: 'fresh', concepts: ['Y'], associatedFiles: ['z.ts'] })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('fresh');
  });

  test('does not double-map two remote pages to the same existing id', () => {
    const existing = [page({ id: 'a-id', concepts: ['X'] })];
    const remote = [page({ id: 'r1', concepts: ['X'] }), page({ id: 'r2', concepts: ['X'] })];
    const aligned = alignRemote(remote, existing);
    const mapped = aligned.filter((p) => p.id === 'a-id');
    expect(mapped).toHaveLength(1);
  });
});
