import type { WikiPage } from '@open-zread/types';

export interface CatalogTreeGroup {
  group: string;
  pages: WikiPage[];
}

export interface CatalogTreeSection {
  section: string;
  directPages: WikiPage[];
  groups: CatalogTreeGroup[];
}

export interface CatalogTree {
  sections: CatalogTreeSection[];
  /** Flattened render/navigation order: per section, direct pages first, then grouped pages. */
  flat: WikiPage[];
}

/**
 * Build a section -> group -> page tree from a flat pages list, preserving first-seen order.
 * Tombstoned pages are excluded unless opts.includeTombstoned is true.
 */
export function buildCatalogTree(
  pages: WikiPage[],
  opts?: { includeTombstoned?: boolean },
): CatalogTree {
  const visible = opts?.includeTombstoned
    ? pages
    : pages.filter((p) => p.status !== 'tombstone');

  const sections: CatalogTreeSection[] = [];
  const sectionIndex = new Map<string, CatalogTreeSection>();

  for (const page of visible) {
    let sec = sectionIndex.get(page.section);
    if (!sec) {
      sec = { section: page.section, directPages: [], groups: [] };
      sectionIndex.set(page.section, sec);
      sections.push(sec);
    }
    if (page.group) {
      let grp = sec.groups.find((g) => g.group === page.group);
      if (!grp) {
        grp = { group: page.group, pages: [] };
        sec.groups.push(grp);
      }
      grp.pages.push(page);
    } else {
      sec.directPages.push(page);
    }
  }

  const flat: WikiPage[] = [];
  for (const sec of sections) {
    flat.push(...sec.directPages);
    for (const grp of sec.groups) flat.push(...grp.pages);
  }

  return { sections, flat };
}
