import { describe, test, expect } from 'bun:test';
import { computeMergePlan } from '../merge.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('computeMergePlan matrix', () => {
  test('ADD: remote-only new page', () => {
    const plan = computeMergePlan({ base: [], local: [], remote: [page({ id: 'new', title: 'N' })] });
    expect(plan.adds.map((p) => p.id)).toEqual(['new']);
  });

  test('KEEP: human page absent from base and remote', () => {
    const human = page({ id: 'h', origin: 'human' });
    const plan = computeMergePlan({ base: [], local: [human], remote: [] });
    expect(plan.kept.map((p) => p.id)).toEqual(['h']);
    expect(plan.removes).toHaveLength(0);
  });

  test('APPLY: local==base, remote changed, not locked', () => {
    const base = page({ id: 'a', title: 'Old' });
    const local = page({ id: 'a', title: 'Old' });
    const remote = page({ id: 'a', title: 'New' });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [remote] });
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.updates[0].to.title).toBe('New');
  });

  test('CONFLICT: local edited AND remote changed', () => {
    const base = page({ id: 'a', title: 'Old' });
    const local = page({ id: 'a', title: 'LocalEdit' });
    const remote = page({ id: 'a', title: 'RemoteEdit' });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [remote] });
    expect(plan.conflicts.map((c) => c.id)).toEqual(['a']);
  });

  test('RESPECT DELETE: local tombstone is kept, not re-added from remote', () => {
    const base = page({ id: 'a', title: 'X' });
    const local = page({ id: 'a', title: 'X', status: 'tombstone' });
    const remote = page({ id: 'a', title: 'X' });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [remote] });
    expect(plan.adds).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.kept.map((p) => p.id)).toEqual(['a']);
  });

  test('REMOVE: base+local present, missing in remote, not locked', () => {
    const base = page({ id: 'a' });
    const local = page({ id: 'a' });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [] });
    expect(plan.removes.map((p) => p.id)).toEqual(['a']);
  });

  test('LOCKED: hard guarantee — local locked is kept verbatim, remote change discarded', () => {
    const base = page({ id: 'a', title: 'Old' });
    const local = page({ id: 'a', title: 'Old', locked: true });
    const remote = page({ id: 'a', title: 'RemoteEdit' });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [remote] });
    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.kept.find((p) => p.id === 'a')?.title).toBe('Old');
  });

  test('LOCKED: not removed even when remote drops it', () => {
    const base = page({ id: 'a', title: 'Old' });
    const local = page({ id: 'a', title: 'Old', locked: true });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [] });
    expect(plan.removes).toHaveLength(0);
    expect(plan.kept.map((p) => p.id)).toEqual(['a']);
  });

  test('alignment integration: renamed remote becomes UPDATE not ADD+REMOVE', () => {
    const base = page({ id: 'a', title: '技能系统', concepts: ['技能系统'] });
    const local = page({ id: 'a', title: '技能系统', concepts: ['技能系统'] });
    const remote = page({ id: 'fresh', title: '技能与战斗', concepts: ['技能系统'] });
    const plan = computeMergePlan({ base: [base], local: [local], remote: [remote] });
    expect(plan.adds).toHaveLength(0);
    expect(plan.removes).toHaveLength(0);
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.updates[0].to.title).toBe('技能与战斗');
  });

  test('id-less remote new page is added (not dropped)', () => {
    const plan = computeMergePlan({ base: [], local: [], remote: [page({ id: undefined, slug: 'fresh', title: 'Fresh' })] });
    expect(plan.adds).toHaveLength(1);
    expect(plan.adds[0].title).toBe('Fresh');
    expect(plan.adds[0].id).toBeTruthy();
  });

  test('two remote pages sharing an id are both preserved (no silent drop)', () => {
    const plan = computeMergePlan({
      base: [], local: [],
      remote: [page({ id: 'dup', slug: 'a', title: 'First' }), page({ id: 'dup', slug: 'b', title: 'Second' })],
    });
    expect(plan.adds).toHaveLength(2);
    expect(plan.adds.map((p) => p.title).sort()).toEqual(['First', 'Second']);
  });
});
