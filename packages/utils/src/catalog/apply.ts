import type { WikiPage, CatalogMergePlan } from '@open-zread/types';

export interface MergeDecisions {
  acceptedAddIds?: Set<string>;
  acceptedUpdateIds?: Set<string>;
  acceptedRemoveIds?: Set<string>;
  conflictResolutions?: Map<string, 'local' | 'remote'>;
}

export interface ApplyResult {
  /** The merged catalog pages (includes tombstoned). */
  pages: WikiPage[];
  /** Pages whose content must be (re)generated (accepted adds/updates/conflict-remote), excluding locked. */
  toGenerate: WikiPage[];
}

/**
 * Apply a reviewed CatalogMergePlan to the LOCAL catalog according to per-item decisions.
 * Only explicitly accepted items are applied; everything else keeps LOCAL. Updates take
 * REMOTE content but preserve LOCAL id/origin/locked/status. Locked pages are never
 * scheduled for generation.
 */
export function applyMergePlan(
  local: WikiPage[],
  plan: CatalogMergePlan,
  decisions: MergeDecisions,
): ApplyResult {
  const addIds = decisions.acceptedAddIds ?? new Set<string>();
  const updIds = decisions.acceptedUpdateIds ?? new Set<string>();
  const remIds = decisions.acceptedRemoveIds ?? new Set<string>();
  const conf = decisions.conflictResolutions ?? new Map<string, 'local' | 'remote'>();

  const map = new Map<string, WikiPage>();
  for (const p of local) if (p.id) map.set(p.id, p);

  const toGenerate: WikiPage[] = [];

  for (const a of plan.adds) {
    if (a.id && addIds.has(a.id)) {
      map.set(a.id, a);
      if (!a.locked) toGenerate.push(a);
    }
  }

  for (const u of plan.updates) {
    if (updIds.has(u.id)) {
      const merged: WikiPage = { ...u.to, id: u.id, origin: u.from.origin, locked: u.from.locked, status: u.from.status };
      map.set(u.id, merged);
      if (!merged.locked) toGenerate.push(merged);
    }
  }

  for (const c of plan.conflicts) {
    if (conf.get(c.id) === 'remote') {
      const merged: WikiPage = { ...c.remote, id: c.id, origin: c.local.origin, locked: c.local.locked, status: c.local.status };
      map.set(c.id, merged);
      if (!merged.locked) toGenerate.push(merged);
    }
  }

  for (const r of plan.removes) {
    if (r.id && remIds.has(r.id)) {
      const existing = map.get(r.id);
      if (existing) map.set(r.id, { ...existing, status: 'tombstone' });
    }
  }

  return { pages: [...map.values()], toGenerate };
}
