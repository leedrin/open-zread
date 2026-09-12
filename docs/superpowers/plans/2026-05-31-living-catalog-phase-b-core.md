# Living Catalog — Phase B-Core Implementation Plan (Merge Engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The pure, unit-tested 3-way catalog merge engine — BASE (snapshot) × LOCAL (current, user-edited) × REMOTE (fresh AI proposal) → `CatalogMergePlan`, with concept-first identity alignment and a hard-lock guarantee. (Phase B-Core of `living-catalog`; plan-ready Tasks 14–17, the testable heart of B1.)

**Architecture:** Three pure modules in `packages/utils/src/catalog/`: `align.ts` (identity alignment: exact id → concept-set → associatedFiles fingerprint → new), `merge.ts` (the merge matrix + hard-lock enforcement), `base-loader.ts` (read the newest `versions/<...>/wiki.json` as BASE). All `bun:test`-covered. The TUI review and the regenerate-as-proposal/agent wiring (B2/B3) are a SEPARATE follow-on plan because they need a live Catalog Agent (LLM) + Ink UI that can't be unit-verified here.

**Tech Stack:** TypeScript, `bun:test`, Node `fs` (base loader), `@open-zread/types` (`WikiPage`, `CatalogMergePlan`), existing `migrateCatalog`.

**Source (locked handoff):**
- plan-ready.md: `openspec/changes/living-catalog/plan-ready.md` (Tasks 14–17)
- design.md: D1 (alignment order, concept channel primary), D3 (merge matrix), D-lock 3 (hard lock), D2 (snapshot=BASE)
- specs: `catalog-reconciliation`

**Grounded facts (verified):**
- `CatalogMergePlan` (in `@open-zread/types`): `{ adds: WikiPage[]; updates: {id;from;to}[]; conflicts: {id;local;remote}[]; removes: WikiPage[]; kept: WikiPage[] }`.
- Snapshots live at `<wikiDir>/versions/<name>/wiki.json` (created by `createVersionSnapshot`, which copies `getWikiDir()` excluding `versions/`). `getWikiDir()` from `@open-zread/utils`.
- `WikiPage` has `id`, `origin`, `locked`, `status`, `concepts?`, `associatedFiles?`, plus content fields title/section/group/level/docType/depth.
- `migrateCatalog(output)` backfills ids idempotently; reuse it on loaded BASE.
- Catalog barrel: `packages/utils/src/catalog/index.ts` currently exports migrate/node-ops/tree.

**Decisions baked in (do not re-derive):**
- Thresholds: `CONCEPT_THRESHOLD = 0.5`, `FINGERPRINT_THRESHOLD = 0.5` (conservative; design open-question — these are the chosen defaults, exported as named consts so they can be tuned).
- "Delete" = tombstone (page stays in LOCAL with `status:'tombstone'`). Tombstoned local pages are RESPECTed (kept, never regenerated, never re-added from REMOTE).
- Hard lock: a LOCAL page with `locked:true` is preserved verbatim and any REMOTE change for it is discarded.

**Do not edit OpenSpec artifacts during build.** Record spec gaps in `openspec/changes/living-catalog/implementation-notes.md`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/utils/src/catalog/align.ts` (create) | `jaccard`, `pageContentEqual`, `alignRemote`, threshold consts |
| `packages/utils/src/catalog/merge.ts` (create) | `computeMergePlan` (matrix + hard lock + tombstone respect) |
| `packages/utils/src/catalog/base-loader.ts` (create) | `loadBaseFromSnapshot` |
| `packages/utils/src/catalog/index.ts` (modify) | export the three modules' public API |
| `packages/utils/src/index.ts` (modify) | re-export `computeMergePlan`, `alignRemote`, `loadBaseFromSnapshot` |
| `packages/utils/src/catalog/__tests__/{align,merge,base-loader}.test.ts` (create) | unit tests |

---

## Task 1: Identity alignment (`align.ts`)

**Files:**
- Create: `packages/utils/src/catalog/align.ts`
- Modify: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/align.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/align.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { jaccard, pageContentEqual, alignRemote } from '../align.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('jaccard', () => {
  test('identical sets = 1', () => expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1));
  test('disjoint = 0', () => expect(jaccard(['a'], ['b'])).toBe(0));
  test('partial overlap', () => expect(jaccard(['a', 'b', 'c'], ['a', 'b'])).toBeCloseTo(2 / 3));
  test('both empty = 0', () => expect(jaccard([], [])).toBe(0));
});

describe('pageContentEqual', () => {
  test('same content fields = true (ignores id/origin/locked/status)', () => {
    const a = page({ id: 'x', title: 'T', section: 'S', locked: false });
    const b = page({ id: 'y', title: 'T', section: 'S', locked: true, origin: 'human' });
    expect(pageContentEqual(a, b)).toBe(true);
  });
  test('different title = false', () => {
    expect(pageContentEqual(page({ title: 'A' }), page({ title: 'B' }))).toBe(false);
  });
  test('different associatedFiles = false', () => {
    expect(pageContentEqual(page({ associatedFiles: ['a'] }), page({ associatedFiles: ['b'] }))).toBe(false);
  });
});

describe('alignRemote', () => {
  test('exact id match: remote inherits existing id', () => {
    const existing = [page({ id: 'keep', title: 'Old' })];
    const remote = [page({ id: 'keep', title: 'New title' })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('keep');
  });

  test('concept-set match: renamed remote inherits id via shared concepts', () => {
    const existing = [page({ id: 'skill-id', title: '技能系统', concepts: ['技能系统'], associatedFiles: ['x.cs'] })];
    const remote = [page({ id: 'fresh', title: '技能与战斗系统', concepts: ['技能系统'], associatedFiles: ['y.cs'] })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('skill-id'); // concept channel beats the differing files
  });

  test('fingerprint fallback when concepts absent', () => {
    const existing = [page({ id: 'a-id', associatedFiles: ['f1.ts', 'f2.ts', 'f3.ts'] })];
    const remote = [page({ id: 'fresh', associatedFiles: ['f1.ts', 'f2.ts'] })]; // 2/3 = 0.66 >= 0.5
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('a-id');
  });

  test('no match: remote keeps its own id (new page)', () => {
    const existing = [page({ id: 'a-id', concepts: ['X'], associatedFiles: ['f1.ts'] })];
    const remote = [page({ id: 'fresh', concepts: ['Y'], associatedFiles: ['z.ts'] })];
    const aligned = alignRemote(remote, existing);
    expect(aligned[0].id).toBe('fresh');
  });

  test('does not double-map two remote pages to the same existing id', () => {
    const existing = [page({ id: 'a-id', concepts: ['X'] })];
    const remote = [page({ id: 'r1', concepts: ['X'] }), page({ id: 'r2', concepts: ['X'] })];
    const aligned = alignRemote(remote, existing);
    const mapped = aligned.filter((p) => p.id === 'a-id');
    expect(mapped).toHaveLength(1); // only one wins
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/align.test.ts`
Expected: FAIL (`Cannot find module '../align.js'`).

- [ ] **Step 3: Implement align.ts**

Create `packages/utils/src/catalog/align.ts`:

```typescript
import type { WikiPage } from '@open-zread/types';

/** Identity-alignment thresholds (conservative defaults; tunable). */
export const CONCEPT_THRESHOLD = 0.5;
export const FINGERPRINT_THRESHOLD = 0.5;

/** Jaccard similarity of two string sets. Empty/empty returns 0. */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Compare the CONTENT fields of two pages (ignores id/origin/locked/status). */
export function pageContentEqual(a: WikiPage, b: WikiPage): boolean {
  return (
    a.title === b.title &&
    a.section === b.section &&
    (a.group ?? '') === (b.group ?? '') &&
    a.level === b.level &&
    (a.docType ?? '') === (b.docType ?? '') &&
    (a.depth ?? '') === (b.depth ?? '') &&
    arrEq(a.associatedFiles ?? [], b.associatedFiles ?? []) &&
    arrEq(a.concepts ?? [], b.concepts ?? [])
  );
}

function arrEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Candidate {
  page: WikiPage;
  used: boolean;
}

/**
 * Resolve each REMOTE page's identity against `existing` pages (typically LOCAL),
 * returning REMOTE pages whose `id` is set to the matched existing id (or kept when new).
 * Priority: exact id -> concept-set overlap -> associatedFiles fingerprint -> new.
 * Each existing page is matched at most once.
 */
export function alignRemote(remote: WikiPage[], existing: WikiPage[]): WikiPage[] {
  const candidates: Candidate[] = existing.map((page) => ({ page, used: false }));

  const matchById = (r: WikiPage) =>
    candidates.find((c) => !c.used && c.page.id && c.page.id === r.id);

  const bestByScore = (r: WikiPage, score: (c: WikiPage) => number, threshold: number) => {
    let best: Candidate | undefined;
    let bestScore = threshold;
    for (const c of candidates) {
      if (c.used) continue;
      const s = score(c.page);
      if (s >= bestScore) {
        // strictly take the highest; ties resolve to first seen
        if (!best || s > bestScore) {
          best = c;
          bestScore = s;
        }
      }
    }
    return best;
  };

  return remote.map((r) => {
    // 1. exact id
    let match = matchById(r);
    // 2. concept-set overlap
    if (!match && (r.concepts?.length ?? 0) > 0) {
      match = bestByScore(r, (c) => jaccard(r.concepts ?? [], c.concepts ?? []), CONCEPT_THRESHOLD);
    }
    // 3. associatedFiles fingerprint
    if (!match && (r.associatedFiles?.length ?? 0) > 0) {
      match = bestByScore(
        r,
        (c) => jaccard(r.associatedFiles ?? [], c.associatedFiles ?? []),
        FINGERPRINT_THRESHOLD,
      );
    }
    if (match) {
      match.used = true;
      return { ...r, id: match.page.id };
    }
    return r; // new page; keep its own id
  });
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/utils/src/catalog/index.ts`, add:

```typescript
export { jaccard, pageContentEqual, alignRemote, CONCEPT_THRESHOLD, FINGERPRINT_THRESHOLD } from './align.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/align.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/catalog/align.ts packages/utils/src/catalog/index.ts packages/utils/src/catalog/__tests__/align.test.ts
git commit -m "feat(utils): catalog identity alignment (concept-first, fingerprint fallback)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Three-way merge matrix + hard lock (`merge.ts`)

**Files:**
- Create: `packages/utils/src/catalog/merge.ts`
- Modify: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/merge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/merge.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/merge.test.ts`
Expected: FAIL (`Cannot find module '../merge.js'`).

- [ ] **Step 3: Implement merge.ts**

Create `packages/utils/src/catalog/merge.ts`:

```typescript
import type { WikiPage, CatalogMergePlan } from '@open-zread/types';
import { alignRemote, pageContentEqual } from './align.js';

export interface MergeInput {
  base: WikiPage[];
  local: WikiPage[];
  remote: WikiPage[];
}

function byId(pages: WikiPage[]): Map<string, WikiPage> {
  const m = new Map<string, WikiPage>();
  for (const p of pages) if (p.id) m.set(p.id, p);
  return m;
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

    // Hard lock: locked local page is immutable.
    if (l && l.locked) {
      plan.kept.push(l);
      continue;
    }
    // Respect user deletion: tombstoned local page stays, never re-added/regenerated.
    if (l && l.status === 'tombstone') {
      plan.kept.push(l);
      continue;
    }

    if (!b && !l && r) {
      plan.adds.push(r); // AI new page
      continue;
    }
    if (!b && l && !r) {
      plan.kept.push(l); // human-only page
      continue;
    }
    if (!b && l && r) {
      // local page not in base, remote also proposes one with same id
      if (pageContentEqual(l, r)) plan.kept.push(l);
      else plan.conflicts.push({ id, local: l, remote: r });
      continue;
    }
    if (b && l && !r) {
      plan.removes.push(l); // AI dropped it -> propose remove
      continue;
    }
    if (b && !l && r) {
      plan.adds.push(r); // was in base, gone from local, remote re-proposes -> ADD for review
      continue;
    }
    if (b && l && r) {
      const localEdited = !pageContentEqual(l, b);
      const remoteChanged = !pageContentEqual(r, b);
      if (!remoteChanged) plan.kept.push(l);
      else if (!localEdited) plan.updates.push({ id, from: l, to: r });
      else plan.conflicts.push({ id, local: l, remote: r });
      continue;
    }
    // b && !l && !r : gone from both -> nothing
  }

  return plan;
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/utils/src/catalog/index.ts`, add:

```typescript
export { computeMergePlan } from './merge.js';
export type { MergeInput } from './merge.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/merge.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/catalog/merge.ts packages/utils/src/catalog/index.ts packages/utils/src/catalog/__tests__/merge.test.ts
git commit -m "feat(utils): 3-way catalog merge matrix + hard-lock + tombstone respect" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: BASE loader from snapshot (`base-loader.ts`)

**Files:**
- Create: `packages/utils/src/catalog/base-loader.ts`
- Modify: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/base-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/base-loader.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBaseFromSnapshot } from '../base-loader.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}

function writeWiki(dir: string, pages: WikiPage[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wiki.json'),
    JSON.stringify({ id: 'w', generated_at: 't', language: 'zh', pages }), 'utf-8');
}

describe('loadBaseFromSnapshot', () => {
  let testDir = '';
  let originalCwd = '';

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `base-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  function wikiDir() { return join(testDir, '.open-zread', 'wiki'); }

  test('returns null when no snapshot exists', async () => {
    expect(await loadBaseFromSnapshot()).toBeNull();
  });

  test('reads pages from the newest snapshot (migrated to have ids)', async () => {
    const versions = join(wikiDir(), 'versions');
    writeWiki(join(versions, '2026-05-01_0900_aaa'), [page({ slug: 'old', title: 'Old' })]);
    writeWiki(join(versions, '2026-05-02_0900_bbb'), [page({ slug: 'new', title: 'New' })]);
    const base = await loadBaseFromSnapshot();
    expect(base).not.toBeNull();
    expect(base!.map((p) => p.title)).toEqual(['New']); // newest by name
    expect(base![0].id).toBeDefined(); // migrated
  });

  test('ignores a snapshot dir without wiki.json', async () => {
    const versions = join(wikiDir(), 'versions');
    mkdirSync(join(versions, 'empty-snap'), { recursive: true });
    writeWiki(join(versions, '2026-05-01_0900_aaa'), [page({ slug: 'ok' })]);
    const base = await loadBaseFromSnapshot();
    expect(base).not.toBeNull();
    expect(base!).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/base-loader.test.ts`
Expected: FAIL (`Cannot find module '../base-loader.js'`).

- [ ] **Step 3: Implement base-loader.ts**

Create `packages/utils/src/catalog/base-loader.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WikiOutput, WikiPage } from '@open-zread/types';
import { getWikiDir } from '../file-io.js';
import { migrateCatalog } from './migrate.js';

/**
 * Load the BASE catalog pages for a 3-way merge: the wiki.json from the most
 * recent version snapshot (`<wiki>/versions/<name>/wiki.json`). Snapshot names
 * are sortable (YYYY-MM-DD_HHMM_hash), so the lexicographically largest is newest.
 * Returns migrated pages (ids backfilled), or null when no usable snapshot exists.
 */
export async function loadBaseFromSnapshot(): Promise<WikiPage[] | null> {
  const versionsDir = join(getWikiDir(), 'versions');
  if (!existsSync(versionsDir)) return null;

  let names: string[];
  try {
    names = readdirSync(versionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }

  for (const name of names) {
    const wikiJson = join(versionsDir, name, 'wiki.json');
    if (!existsSync(wikiJson)) continue;
    try {
      const output = JSON.parse(readFileSync(wikiJson, 'utf-8')) as WikiOutput;
      if (output?.pages && Array.isArray(output.pages)) {
        return migrateCatalog(output).pages;
      }
    } catch {
      // skip unreadable snapshot, try the next
    }
  }
  return null;
}
```

- [ ] **Step 4: Export from the barrel + utils root**

In `packages/utils/src/catalog/index.ts`, add:
```typescript
export { loadBaseFromSnapshot } from './base-loader.js';
```
In `packages/utils/src/index.ts`, extend the `// Catalog` export line to also export the new public API:
```typescript
export { deriveId, migrateCatalog, buildCatalogTree, addPage, updatePage, tombstonePage, movePage, toggleLock, setDepth, computeMergePlan, alignRemote, loadBaseFromSnapshot } from './catalog/index.js';
```
(Keep any existing names on that line; just add `computeMergePlan, alignRemote, loadBaseFromSnapshot`.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/base-loader.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/catalog/base-loader.ts packages/utils/src/catalog/index.ts packages/utils/src/index.ts packages/utils/src/catalog/__tests__/base-loader.test.ts
git commit -m "feat(utils): load BASE catalog from newest version snapshot" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Green gate + mark tasks

**Files:** `openspec/changes/living-catalog/tasks.md`

- [ ] **Step 1: Full green gate**

Run from `F:/open-zread`:
- `bun run typecheck` → expect 16/16 PASS.
- `bun run lint` → expect 0 errors.
- `cd packages/utils && bun test` → expect all pass (incl. align/merge/base-loader).
Report exact numbers.

- [ ] **Step 2: Mark plan-ready B1 tasks done**

In `openspec/changes/living-catalog/tasks.md`, mark `B1.1`–`B1.5` `[x]` (the merge-engine subtasks this plan delivers: loadBaseFromSnapshot, alignNodes, computeMergePlan, hard lock, unit tests). Leave B2/B3 unchecked (follow-on).

- [ ] **Step 3: Commit**

```bash
git add openspec/changes/living-catalog/tasks.md
git commit -m "chore(living-catalog): mark Phase B merge-engine (B1) tasks complete" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Follow-on (NOT in this plan)
- **Phase B-Flow** (plan-ready Tasks B2/B3): regenerate-as-proposal flow (run Catalog Agent → REMOTE without overwriting; glossary-anchored naming in `generate-catalog.ts`), TUI merge-review view (accept/reject per node; on confirm write+finalize+generate only added/accepted), wiki-home "重新生成（合并）" entry, and the diataxis-migration verification. These need a live Catalog Agent (LLM) + Ink UI and can't be unit-verified here.

---

## Self-Review

**Spec coverage (`catalog-reconciliation`, B1 portion):**
- BASE = newest snapshot's wiki.json; null fallback → Task 3 (`loadBaseFromSnapshot`). ✓
- Alignment id → concept → fingerprint → new → Task 1 (`alignRemote`). ✓
- Merge matrix ADD/KEEP/APPLY/CONFLICT/RESPECT-DELETE/REMOVE → Task 2 (`computeMergePlan`). ✓
- Hard lock (verbatim, discard remote, never remove) → Task 2 (locked branch) + tests. ✓
- Concept channel beats fingerprint; degrade to ADD/REMOVE when unmatched → Task 1 priority order + Task 2. ✓
- Out of scope here (B2/B3): regenerate-as-proposal, TUI review, glossary-anchored naming, diataxis-migration smoke → follow-on.

**Placeholder scan:** all three modules fully coded with tests; no TBD/placeholder.

**Type consistency:** `jaccard`/`pageContentEqual`/`alignRemote` (Task 1) consumed by `computeMergePlan` (Task 2); `CatalogMergePlan` matches the `@open-zread/types` shape (`adds`/`updates{id,from,to}`/`conflicts{id,local,remote}`/`removes`/`kept`); `migrateCatalog`/`getWikiDir` reused in Task 3.

**Testability:** 100% of this plan is pure logic with `bun:test` coverage — every matrix row, lock guarantee, alignment channel, and the snapshot loader (tmp+chdir) are unit-tested. No manual verification needed for B-Core.
