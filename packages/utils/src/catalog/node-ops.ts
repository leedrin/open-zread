import type { WikiPage } from '@open-zread/types';
import { deriveId } from './migrate.js';

type NewPageInput = Pick<WikiPage, 'slug' | 'title' | 'file' | 'section' | 'level'> & Partial<WikiPage>;

/** Append a new human-authored page (fresh id, origin 'human', active). */
export function addPage(pages: WikiPage[], input: NewPageInput): WikiPage[] {
  const newPage: WikiPage = {
    ...input,
    id: input.id ?? deriveId(`${input.slug}-${Date.now()}-${pages.length}`),
    origin: input.origin ?? 'human',
    locked: input.locked ?? false,
    status: input.status ?? 'active',
  };
  return [...pages, newPage];
}

/** Patch a page by id; id is never changed. */
export function updatePage(pages: WikiPage[], id: string, patch: Partial<WikiPage>): WikiPage[] {
  return pages.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p));
}

/** Soft-delete a page by id. */
export function tombstonePage(pages: WikiPage[], id: string): WikiPage[] {
  return updatePage(pages, id, { status: 'tombstone' });
}

/** Move a page to another section/group; preserves id. */
export function movePage(pages: WikiPage[], id: string, section: string, group?: string): WikiPage[] {
  return updatePage(pages, id, { section, group });
}

/** Flip the locked flag. */
export function toggleLock(pages: WikiPage[], id: string): WikiPage[] {
  return pages.map((p) => (p.id === id ? { ...p, locked: !p.locked } : p));
}

/** Set the depth directive. */
export function setDepth(pages: WikiPage[], id: string, depth: 'standard' | 'deep'): WikiPage[] {
  return updatePage(pages, id, { depth });
}
