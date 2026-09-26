import { describe, expect, test } from 'bun:test';
import { loadHubPreferences, markdownSessionKey } from '../lib/hub-preferences';

function withStoredPreferences(value: unknown, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['open-zread-hub.preferences.v1', JSON.stringify(value)]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, serialized: string) => values.set(key, serialized),
    },
  });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

describe('Hub local preferences', () => {
  test('restores per-project, per-file Markdown scroll and keeps legacy Wiki sessions intact', () => {
    const projectId = 'legacy-project';
    withStoredPreferences({
      version: 1,
      view: 'project',
      projectId,
      projectSection: 'wiki',
      recentProjectIds: [projectId],
      projectSort: 'name-asc',
      recentWikiVisits: [
        { projectId, provider: 'open_zread', slug: 'legacy', title: 'Legacy root page', visitedAt: 1 },
        { projectId, provider: 'open_zread', wikiId: 'open_zread@framework', sourceRoot: 'framework', slug: 'overview', title: 'Framework overview', visitedAt: 2 },
      ],
      markdownRecentFiles: { [projectId]: 'docs/guide.md' },
      expandedMarkdownPaths: { [projectId]: ['docs'] },
      markdownScrollPositions: { [projectId]: 360 },
      readerSessions: {
        [`${projectId}:open_zread`]: { selectedSlug: 'overview', scrollTop: 120 },
        [`${projectId}:zread`]: { selectedSlug: 'details', scrollTop: 240 },
      },
    }, () => {
      const preferences = loadHubPreferences();
      expect(preferences.view).toBe('project');
      expect(preferences.projectId).toBe(projectId);
      expect(preferences.projectSort).toBe('name-asc');
      expect(preferences.markdownRecentFiles[projectId]).toBe('docs/guide.md');
      expect(preferences.expandedMarkdownPaths[projectId]).toEqual(['docs']);
      expect(preferences.markdownScrollPositions[markdownSessionKey(projectId, 'docs/guide.md')]).toBe(360);
      expect(preferences.readerSessions[`${projectId}:open_zread@.`]).toEqual({ selectedSlug: 'overview', scrollTop: 120 });
      expect(preferences.readerSessions[`${projectId}:zread@.`]).toEqual({ selectedSlug: 'details', scrollTop: 240 });
      expect(preferences.recentWikiVisits.map((visit) => [visit.wikiId, visit.sourceRoot])).toEqual([
        ['open_zread@.', '.'],
        ['open_zread@framework', 'framework'],
      ]);
    });
  });

  test('normalizes Windows separators in Markdown session identities', () => {
    expect(markdownSessionKey('project-1', 'docs\\guide.md')).toBe('project-1:docs/guide.md');
  });
});
