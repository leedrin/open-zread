import { describe, test, expect } from 'bun:test';
import { applyMergePlan } from '../apply.js';
import type { WikiPage, CatalogMergePlan } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}
function emptyPlan(): CatalogMergePlan {
  return { adds: [], updates: [], conflicts: [], removes: [], kept: [] };
}

describe('applyMergePlan', () => {
  test('accepted add appears in pages and toGenerate', () => {
    const local = [page({ id: 'a', title: 'A' })];
    const plan = { ...emptyPlan(), adds: [page({ id: 'new', title: 'New' })] };
    const r = applyMergePlan(local, plan, { acceptedAddIds: new Set(['new']) });
    expect(r.pages.map((p) => p.id).sort()).toEqual(['a', 'new']);
    expect(r.toGenerate.map((p) => p.id)).toEqual(['new']);
  });

  test('rejected add is not applied', () => {
    const local = [page({ id: 'a' })];
    const plan = { ...emptyPlan(), adds: [page({ id: 'new' })] };
    const r = applyMergePlan(local, plan, { acceptedAddIds: new Set() });
    expect(r.pages.map((p) => p.id)).toEqual(['a']);
    expect(r.toGenerate).toHaveLength(0);
  });

  test('accepted update takes remote content, keeps id + local metadata, regenerates', () => {
    const from = page({ id: 'a', title: 'Old', origin: 'human' });
    const to = page({ id: 'a', title: 'New', origin: 'ai' });
    const plan = { ...emptyPlan(), updates: [{ id: 'a', from, to }] };
    const r = applyMergePlan([from], plan, { acceptedUpdateIds: new Set(['a']) });
    const a = r.pages.find((p) => p.id === 'a');
    expect(a).toBeDefined();
    if (a) {
      expect(a.title).toBe('New');
      expect(a.origin).toBe('human');
    }
    expect(r.toGenerate.map((p) => p.id)).toEqual(['a']);
  });

  test('rejected update keeps local, no regen', () => {
    const from = page({ id: 'a', title: 'Old' });
    const to = page({ id: 'a', title: 'New' });
    const r = applyMergePlan([from], { ...emptyPlan(), updates: [{ id: 'a', from, to }] }, { acceptedUpdateIds: new Set() });
    const a = r.pages.find((p) => p.id === 'a');
    expect(a).toBeDefined();
    if (a) expect(a.title).toBe('Old');
    expect(r.toGenerate).toHaveLength(0);
  });

  test('conflict resolved to remote replaces + regenerates; to local keeps', () => {
    const local = page({ id: 'a', title: 'Local' });
    const remote = page({ id: 'a', title: 'Remote' });
    const plan = { ...emptyPlan(), conflicts: [{ id: 'a', local, remote }] };
    const toRemote = applyMergePlan([local], plan, { conflictResolutions: new Map([['a', 'remote']]) });
    const remoteA = toRemote.pages.find((p) => p.id === 'a');
    expect(remoteA).toBeDefined();
    if (remoteA) expect(remoteA.title).toBe('Remote');
    expect(toRemote.toGenerate.map((p) => p.id)).toEqual(['a']);
    const toLocal = applyMergePlan([local], plan, { conflictResolutions: new Map([['a', 'local']]) });
    const localA = toLocal.pages.find((p) => p.id === 'a');
    expect(localA).toBeDefined();
    if (localA) expect(localA.title).toBe('Local');
    expect(toLocal.toGenerate).toHaveLength(0);
  });

  test('accepted remove tombstones the page, no regen', () => {
    const local = page({ id: 'a' });
    const plan = { ...emptyPlan(), removes: [local] };
    const r = applyMergePlan([local], plan, { acceptedRemoveIds: new Set(['a']) });
    const a = r.pages.find((p) => p.id === 'a');
    expect(a).toBeDefined();
    if (a) expect(a.status).toBe('tombstone');
    expect(r.toGenerate).toHaveLength(0);
  });

  test('locked page is never put into toGenerate even if accepted as update', () => {
    const from = page({ id: 'a', title: 'Old', locked: true });
    const to = page({ id: 'a', title: 'New' });
    const plan = { ...emptyPlan(), updates: [{ id: 'a', from, to }] };
    const r = applyMergePlan([from], plan, { acceptedUpdateIds: new Set(['a']) });
    expect(r.toGenerate).toHaveLength(0);
  });
});
