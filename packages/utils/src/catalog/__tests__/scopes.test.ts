import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveScope, listScopes, loadScope, resolveScope } from '../scopes.js';
import type { TopicScope, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}
function scope(p: Partial<TopicScope>): TopicScope {
  return { name: 'n', pageIds: [], createdAt: 't', ...p };
}

describe('topic scopes', () => {
  let testDir = '';
  let originalCwd = '';
  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `scopes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });
  afterEach(() => { process.chdir(originalCwd); rmSync(testDir, { recursive: true, force: true }); });

  test('save -> list -> load round-trip', () => {
    saveScope(scope({ name: '战斗系统深潜', pageIds: ['a', 'b'] }));
    const all = listScopes();
    expect(all.map((s) => s.name)).toEqual(['战斗系统深潜']);
    const loaded = loadScope('战斗系统深潜');
    expect(loaded?.pageIds).toEqual(['a', 'b']);
  });

  test('loadScope returns null when missing', () => {
    expect(loadScope('nope')).toBeNull();
  });

  test('resolveScope ignores stale ids', () => {
    const pages = [page({ id: 'a', title: 'A' }), page({ id: 'c', title: 'C' })];
    const resolved = resolveScope(scope({ pageIds: ['a', 'gone', 'c'] }), pages);
    expect(resolved.map((p) => p.id)).toEqual(['a', 'c']);
  });

  test('listScopes returns [] when no scopes dir', () => {
    expect(listScopes()).toEqual([]);
  });
});
