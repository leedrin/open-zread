import { describe, test, expect } from 'bun:test';
import { normalizeDeepDiveChildren, buildAddsOnlyPlan, DEEP_DIVE_MAX_CHILDREN } from '../deepdive.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('normalizeDeepDiveChildren', () => {
  const parent = page({ id: 'p', section: 'Combat', group: 'Skill', title: '技能系统' });

  test('inherits parent section/group, origin ai, fresh ids, active', () => {
    const kids = normalizeDeepDiveChildren([page({ slug: 'c1', title: 'C1', associatedFiles: ['x.cs'], section: 'wrong' })], parent);
    expect(kids).toHaveLength(1);
    expect(kids[0].section).toBe('Combat');
    expect(kids[0].group).toBe('Skill');
    expect(kids[0].origin).toBe('ai');
    expect(kids[0].status).toBe('active');
    expect(kids[0].id).toBeTruthy();
  });

  test('drops children without associatedFiles', () => {
    const kids = normalizeDeepDiveChildren([
      page({ slug: 'a', associatedFiles: ['x.cs'] }),
      page({ slug: 'b', associatedFiles: [] }),
      page({ slug: 'c' }),
    ], parent);
    expect(kids.map((k) => k.slug)).toEqual(['a']);
  });

  test('bounds to the max', () => {
    const many = Array.from({ length: DEEP_DIVE_MAX_CHILDREN + 3 }, (_, i) =>
      page({ slug: `c${i}`, associatedFiles: ['x.cs'] }));
    expect(normalizeDeepDiveChildren(many, parent)).toHaveLength(DEEP_DIVE_MAX_CHILDREN);
  });
});

describe('buildAddsOnlyPlan', () => {
  test('puts children in adds, everything else empty', () => {
    const children = [page({ id: 'a' }), page({ id: 'b' })];
    const plan = buildAddsOnlyPlan(children);
    expect(plan.adds.map((p) => p.id)).toEqual(['a', 'b']);
    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.removes).toHaveLength(0);
    expect(plan.kept).toHaveLength(0);
  });
});
