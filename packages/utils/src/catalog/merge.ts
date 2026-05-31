import type { WikiPage, CatalogMergePlan } from '@open-zread/types';
import { alignRemote, pageContentEqual } from './align.js';

export interface MergeInput {
  base: WikiPage[];
  local: WikiPage[];
  remote: WikiPage[];
}

/**
 * Three-way merge: BASE x LOCAL x REMOTE -> CatalogMergePlan.
 * REMOTE is first aligned onto LOCAL identities (concept-first), so a renamed
 * AI page maps to an existing id (update) instead of add+remove.
 *
 * Hard lock: a LOCAL page with locked:true is kept verbatim; REMOTE changes for
 * it are discarded and it is never removed. Tombstoned LOCAL pages are respected
 * (kept, never re-added).
 */
export function computeMergePlan(input: MergeInput): CatalogMergePlan {
  const aligned = alignRemote(input.remote, input.local);
  const base = byId(input.base);
  const local = byId(input.local);
  const remote = byId(aligned);

  const plan: CatalogMergePlan = { adds: [], updates: [], conflicts: [], removes: [], kept: [] };

  const ids = new Set<string>([...base.keys(), ...local.keys(), ...remote.keys()]);

  for (const id of ids) {
    const b = base.get(id);
    const l = local.get(id);
    const r = remote.get(id);

    // Hard lock: kept verbatim regardless of remote
    if (l && l.locked) {
      plan.kept.push(l);
      continue;
    }
    // Tombstone: respect local delete, never re-add from remote
    if (l && l.status === 'tombstone') {
      plan.kept.push(l);
      continue;
    }

    if (!b && !l && r) {
      // Remote-only new page → ADD
      plan.adds.push(r);
      continue;
    }
    if (!b && l && !r) {
      // Local-only (no base, no remote) → KEEP (human or new local page)
      plan.kept.push(l);
      continue;
    }
    if (!b && l && r) {
      // Both local and remote exist but no base → KEEP if same, CONFLICT if different
      if (pageContentEqual(l, r)) plan.kept.push(l);
      else plan.conflicts.push({ id, local: l, remote: r });
      continue;
    }
    if (b && l && !r) {
      // Remote removed → REMOVE local
      plan.removes.push(l);
      continue;
    }
    if (b && !l && r) {
      // Local was removed, remote still has it → ADD from remote
      plan.adds.push(r);
      continue;
    }
    if (b && l && r) {
      // Three-way: check what changed
      const localEdited = !pageContentEqual(l, b);
      const remoteChanged = !pageContentEqual(r, b);
      if (!remoteChanged) {
        // Remote unchanged → keep local
        plan.kept.push(l);
      } else if (!localEdited) {
        // Local unchanged, remote changed → UPDATE
        plan.updates.push({ id, from: l, to: r });
      } else {
        // Both changed → CONFLICT
        plan.conflicts.push({ id, local: l, remote: r });
      }
      continue;
    }
  }

  return plan;
}

function byId(pages: WikiPage[]): Map<string, WikiPage> {
  const m = new Map<string, WikiPage>();
  for (const p of pages) if (p.id) m.set(p.id, p);
  return m;
}
