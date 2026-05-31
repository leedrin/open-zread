import type { WikiPage, CatalogMergePlan } from '@open-zread/types';
import { deriveId } from './migrate.js';

export const DEEP_DIVE_MAX_CHILDREN = 6;

/**
 * Normalize proposed deep-dive children: require non-empty associatedFiles, bound the count,
 * inherit the parent's section/group, set origin 'ai' + active + unlocked, assign fresh ids.
 */
export function normalizeDeepDiveChildren(
  children: WikiPage[],
  parent: WikiPage,
  max: number = DEEP_DIVE_MAX_CHILDREN,
): WikiPage[] {
  return children
    .filter((c) => (c.associatedFiles?.length ?? 0) > 0)
    .slice(0, max)
    .map((c, i) => ({
      ...c,
      id: deriveId(`deepdive-${parent.id ?? parent.slug}-${i}-${c.slug}`),
      section: parent.section,
      group: parent.group,
      origin: 'ai' as const,
      status: 'active' as const,
      locked: false,
    }));
}

/** Build an adds-only merge plan so deep-dive children flow through the standard review/apply path. */
export function buildAddsOnlyPlan(children: WikiPage[]): CatalogMergePlan {
  return { adds: children, updates: [], conflicts: [], removes: [], kept: [] };
}
