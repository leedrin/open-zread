import { describe, test, expect } from 'bun:test';
import { addPage, updatePage, tombstonePage, movePage, toggleLock, setDepth } from '../node-ops.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage> = {}): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id1', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('node-ops', () => {
  test('addPage appends a human page with an id', () => {
    const out = addPage([], { slug: 'n', title: 'N', file: 'n.md', section: 'Sec', level: 'Beginner' });
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBe('human');
    expect(out[0].id).toBeTruthy();
    expect(out[0].status).toBe('active');
  });

  test('updatePage preserves id', () => {
    const out = updatePage([page({ id: 'keep' })], 'keep', { title: 'New' });
    expect(out[0].id).toBe('keep');
    expect(out[0].title).toBe('New');
  });

  test('tombstonePage sets status', () => {
    const out = tombstonePage([page({ id: 'a' })], 'a');
    expect(out[0].status).toBe('tombstone');
  });

  test('movePage preserves id and changes section/group', () => {
    const out = movePage([page({ id: 'a' })], 'a', 'NewSec', 'G');
    expect(out[0].id).toBe('a');
    expect(out[0].section).toBe('NewSec');
    expect(out[0].group).toBe('G');
  });

  test('toggleLock flips locked', () => {
    const out = toggleLock([page({ id: 'a', locked: false })], 'a');
    expect(out[0].locked).toBe(true);
  });

  test('setDepth sets depth', () => {
    const out = setDepth([page({ id: 'a' })], 'a', 'deep');
    expect(out[0].depth).toBe('deep');
  });
});
