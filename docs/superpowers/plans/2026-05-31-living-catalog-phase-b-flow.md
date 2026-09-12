# Living Catalog — Phase B-Flow Implementation Plan (Reconciliation Flow + Review UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the Phase B-Core merge engine into a usable flow: run the Catalog Agent to produce a REMOTE proposal WITHOUT clobbering the live `wiki.json`, compute a `CatalogMergePlan`, review it in a TUI (accept/reject per node), and on confirm apply + persist + regenerate only the affected pages. Plus glossary-anchored naming so the agent records each page's `concepts`. (Phase B-Flow of `living-catalog`; plan-ready Tasks B2/B3.)

**Architecture:** One pure, unit-tested core — `applyMergePlan` (decisions → merged pages + pages-to-generate). The rest is orchestration (proposal capture via backup/restore around the existing `generateWikiCatalog`) + an Ink review view; both are typecheck/lint-gated and need a live `bun run dev` + LLM run to verify end-to-end (recorded honestly, not claimed).

**Tech Stack:** TypeScript, `bun:test` (apply core), `@open-zread/utils` (merge engine, generateWikiJson, finalizeWiki, loadBaseFromSnapshot), `@open-zread/orchestrator` (generateWikiCatalog, generateWikiContent), Ink 4 + React 18.

**Source (locked handoff):**
- plan-ready.md: `openspec/changes/living-catalog/plan-ready.md` (Tasks B2/B3, i.e. 20–22)
- design.md: catalog-reconciliation "重新生成产出提案而非覆盖", D4 (review), D8 (anchored naming), B3.4 (diataxis migration)
- specs: `catalog-reconciliation`

**Grounded facts (verified):**
- `GenerateBlueprintTool` already accepts `pages` (incl. `concepts`) + `glossary` and writes via `generateWikiJson(pages, config, techStackSummary, glossary)` to `getWikiJsonPath()` (= `<wikiDir>/wiki.json`). The catalog prompt (`generate-catalog.ts`) already produces a glossary (Step 5).
- `generateWikiCatalog(onEvent?)` (orchestrator) runs the agent which writes `wiki.json`.
- `generateWikiContent({ pages, symbols?, maxConcurrent?, onEvent? })` generates content for a given page list.
- Phase B-Core exports from `@open-zread/utils`: `computeMergePlan`, `alignRemote`, `loadBaseFromSnapshot`, `migrateCatalog`. `CatalogMergePlan` is `{ adds, updates[{id,from,to}], conflicts[{id,local,remote}], removes, kept }`.
- `loadWikiBlueprint(path?)` migrates on load; `getWikiJsonPath`, `getWikiDir`, `loadConfig`, `finalizeWiki` from utils.
- TUI patterns: `apps/cli/src/views/catalog-editor/index.tsx` (tree + useInput + persist + useEscHandler), `apps/cli/src/views/wiki-generate/` (agent-event-driven progress), `apps/cli/src/views/wiki-home/index.tsx` (menu).

**Do not edit OpenSpec artifacts during build.** Record gaps in `openspec/changes/living-catalog/implementation-notes.md`.

**Verification honesty:** Only `applyMergePlan` (Task 1) is unit-tested. Tasks 2–4 (prompt, orchestration, TUI) are gated by typecheck + lint; their behavior needs a live LLM + interactive run. The final report MUST state this and NOT claim interactive verification.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/utils/src/catalog/apply.ts` (create) | `applyMergePlan` (decisions → merged pages + toGenerate), `MergeDecisions` |
| `packages/utils/src/catalog/index.ts` + `packages/utils/src/index.ts` (modify) | export apply API |
| `packages/orchestrator/src/prompts/generate-catalog.ts` (modify) | glossary-anchored naming + record `concepts` |
| `packages/orchestrator/src/wiki/reconcile.ts` (create) | `generateCatalogProposal`, `persistMergedCatalog` |
| `packages/orchestrator/src/index.ts` (modify) | export the reconcile API |
| `apps/cli/src/views/catalog-merge/index.tsx` (create) | Ink merge-review view |
| `apps/cli/src/App.tsx` + `wiki-home/index.tsx` + i18n (modify) | route + menu entry "重新生成（合并）" + keys |

---

## Task 1: `applyMergePlan` (pure, TDD)

**Files:**
- Create: `packages/utils/src/catalog/apply.ts`
- Modify: `packages/utils/src/catalog/index.ts`, `packages/utils/src/index.ts`
- Test: `packages/utils/src/catalog/__tests__/apply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/apply.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { applyMergePlan } from '../apply.js';
import type { WikiPage, CatalogMergePlan } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}
function emptyPlan(): CatalogMergePlan {
  return { adds: [], updates: [], conflicts: [], removes: [], kept: [] };
}

describe('applyMergePlan', () => {
  test('accepted add appears in pages and toGenerate', () => {
    const local = [page({ id: 'a', title: 'A' })];
    const plan = { ...emptyPlan(), adds: [page({ id: 'new', title: 'New' })] };
    const r = applyMergePlan(local, plan, { acceptedAddIds: new Set(['new']) });
    expect(r.pages.map((p) => p.id).sort()).toEqual(['a', 'new']);
    expect(r.toGenerate.map((p) => p.id)).toEqual(['new']);
  });

  test('rejected add is not applied', () => {
    const local = [page({ id: 'a' })];
    const plan = { ...emptyPlan(), adds: [page({ id: 'new' })] };
    const r = applyMergePlan(local, plan, { acceptedAddIds: new Set() });
    expect(r.pages.map((p) => p.id)).toEqual(['a']);
    expect(r.toGenerate).toHaveLength(0);
  });

  test('accepted update takes remote content, keeps id + local metadata, regenerates', () => {
    const from = page({ id: 'a', title: 'Old', origin: 'human' });
    const to = page({ id: 'a', title: 'New', origin: 'ai' });
    const plan = { ...emptyPlan(), updates: [{ id: 'a', from, to }] };
    const r = applyMergePlan([from], plan, { acceptedUpdateIds: new Set(['a']) });
    const a = r.pages.find((p) => p.id === 'a')!;
    expect(a.title).toBe('New');
    expect(a.origin).toBe('human'); // local metadata preserved
    expect(r.toGenerate.map((p) => p.id)).toEqual(['a']);
  });

  test('rejected update keeps local, no regen', () => {
    const from = page({ id: 'a', title: 'Old' });
    const to = page({ id: 'a', title: 'New' });
    const r = applyMergePlan([from], { ...emptyPlan(), updates: [{ id: 'a', from, to }] }, { acceptedUpdateIds: new Set() });
    expect(r.pages.find((p) => p.id === 'a')!.title).toBe('Old');
    expect(r.toGenerate).toHaveLength(0);
  });

  test('conflict resolved to remote replaces + regenerates; to local keeps', () => {
    const local = page({ id: 'a', title: 'Local' });
    const remote = page({ id: 'a', title: 'Remote' });
    const plan = { ...emptyPlan(), conflicts: [{ id: 'a', local, remote }] };
    const toRemote = applyMergePlan([local], plan, { conflictResolutions: new Map([['a', 'remote']]) });
    expect(toRemote.pages.find((p) => p.id === 'a')!.title).toBe('Remote');
    expect(toRemote.toGenerate.map((p) => p.id)).toEqual(['a']);
    const toLocal = applyMergePlan([local], plan, { conflictResolutions: new Map([['a', 'local']]) });
    expect(toLocal.pages.find((p) => p.id === 'a')!.title).toBe('Local');
    expect(toLocal.toGenerate).toHaveLength(0);
  });

  test('accepted remove tombstones the page, no regen', () => {
    const local = page({ id: 'a' });
    const plan = { ...emptyPlan(), removes: [local] };
    const r = applyMergePlan([local], plan, { acceptedRemoveIds: new Set(['a']) });
    expect(r.pages.find((p) => p.id === 'a')!.status).toBe('tombstone');
    expect(r.toGenerate).toHaveLength(0);
  });

  test('locked page is never put into toGenerate even if accepted as update', () => {
    const from = page({ id: 'a', title: 'Old', locked: true });
    const to = page({ id: 'a', title: 'New' });
    const plan = { ...emptyPlan(), updates: [{ id: 'a', from, to }] };
    const r = applyMergePlan([from], plan, { acceptedUpdateIds: new Set(['a']) });
    expect(r.toGenerate).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/apply.test.ts`
Expected: FAIL (`Cannot find module '../apply.js'`).

- [ ] **Step 3: Implement apply.ts**

Create `packages/utils/src/catalog/apply.ts`:

```typescript
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
    // 'local' / undefined -> keep local (already in map)
  }

  for (const r of plan.removes) {
    if (r.id && remIds.has(r.id)) {
      const existing = map.get(r.id);
      if (existing) map.set(r.id, { ...existing, status: 'tombstone' });
    }
  }

  return { pages: [...map.values()], toGenerate };
}
```

- [ ] **Step 4: Export**

In `packages/utils/src/catalog/index.ts` add:
```typescript
export { applyMergePlan } from './apply.js';
export type { MergeDecisions, ApplyResult } from './apply.js';
```
In `packages/utils/src/index.ts`, append `applyMergePlan` to the `// Catalog` export list.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/apply.test.ts` → PASS (7 tests).

- [ ] **Step 6: typecheck + lint + commit**

`bun run typecheck` (16/16), `bun run lint` (clean). Then:
```bash
git add packages/utils/src/catalog/apply.ts packages/utils/src/catalog/index.ts packages/utils/src/index.ts packages/utils/src/catalog/__tests__/apply.test.ts
git commit -m "feat(utils): apply reviewed catalog merge plan (decisions -> pages + toGenerate)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Glossary-anchored naming (prompt)

**Files:**
- Modify: `packages/orchestrator/src/prompts/generate-catalog.ts`

- [ ] **Step 1: Add the anchored-naming + concepts instruction**

Read the existing `generate-catalog.ts`. Find Step 5 (the glossary section). Add a new explicit rule block instructing the agent to (a) name pages using the canonical glossary term (collapse aliases to the canonical name) and (b) populate each page's `concepts` array with the canonical term(s) it is the authoritative home for. Insert after the glossary requirements:

```
### Step 6: 术语锚定命名与 concepts 回填（强制）

1. **命名锚定**：为页面取 `title`/`slug` 时，优先采用 Glossary 中的**规范术语**（canonical term）。如果某概念有别名/旧称，统一收敛到规范名，避免跨次生成的标题漂移。
2. **回填 concepts**：每个 page 必须填写 `concepts` 数组——列出该页作为**权威归属**的规范术语（即 glossary 中 `canonicalPage` 指向该页的术语）。一页可对应多个术语（如"技能与战斗" → `["技能","战斗"]`）。
3. 这两点用于后续"重新生成（合并）"时按概念对齐页面身份，使改名的页面被识别为同一页（更新）而非"删除+新增"。
```

Also update the JSON example in the prompt so at least one page shows a `concepts` field (e.g. add `"concepts": ["..."]` to one example page), demonstrating the expected shape.

- [ ] **Step 2: typecheck (prompt is a string; just ensure it compiles)**

Run: `bun run typecheck` (16/16 PASS), `bun run lint` (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/prompts/generate-catalog.ts
git commit -m "feat(orchestrator): glossary-anchored page naming + concepts backfill in catalog prompt" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: this changes LLM behavior; it cannot be unit-verified. Behavior is checked in the manual smoke (Task 5).

---

## Task 3: Proposal orchestration (`reconcile.ts`)

**Files:**
- Create: `packages/orchestrator/src/wiki/reconcile.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Implement reconcile.ts**

Create `packages/orchestrator/src/wiki/reconcile.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { WikiOutput, WikiPage, CatalogMergePlan } from '@open-zread/types';
import {
  getWikiJsonPath, getWikiDir, loadConfig, migrateCatalog,
  loadBaseFromSnapshot, computeMergePlan, generateWikiJson, finalizeWiki, logger,
} from '@open-zread/utils';
import { generateWikiCatalog } from '../orchestrator.js';
import type { CatalogEvent } from '../types.js';

export interface CatalogProposal {
  plan: CatalogMergePlan;
  local: WikiPage[];
  /** REMOTE WikiOutput (carries glossary + techStackSummary for the final persist). */
  remote: WikiOutput;
}

/**
 * Produce a REMOTE catalog proposal by running the Catalog Agent, WITHOUT permanently
 * clobbering the live wiki.json: the current wiki.json is preserved and restored after
 * the agent run. Computes a 3-way merge plan against BASE (newest snapshot) and LOCAL.
 */
export async function generateCatalogProposal(onEvent?: (e: CatalogEvent) => void): Promise<CatalogProposal> {
  const wikiJsonPath = getWikiJsonPath();
  const localContent = existsSync(wikiJsonPath) ? readFileSync(wikiJsonPath, 'utf-8') : null;

  let remote: WikiOutput;
  try {
    await generateWikiCatalog(onEvent); // overwrites wiki.json with REMOTE
    remote = migrateCatalog(JSON.parse(readFileSync(wikiJsonPath, 'utf-8')) as WikiOutput);
  } finally {
    if (localContent !== null) writeFileSync(wikiJsonPath, localContent, 'utf-8');
  }

  const local = localContent
    ? migrateCatalog(JSON.parse(localContent) as WikiOutput).pages
    : [];
  const base = (await loadBaseFromSnapshot()) ?? local;
  const plan = computeMergePlan({ base, local, remote: remote.pages });

  logger.info(`合并提案: +${plan.adds.length} 新增 / ${plan.updates.length} 更新 / ${plan.conflicts.length} 冲突 / ${plan.removes.length} 移除`);
  return { plan, local, remote };
}

/**
 * Persist a merged catalog: rewrite wiki.json + re-run finalize (sidebar/index/glossary).
 */
export async function persistMergedCatalog(pages: WikiPage[], remote: WikiOutput): Promise<void> {
  const config = await loadConfig();
  await generateWikiJson(pages, config, remote.techStackSummary, remote.glossary);
  await finalizeWiki(getWikiDir(), { pages, glossary: remote.glossary });
}
```

- [ ] **Step 2: Export from orchestrator index**

In `packages/orchestrator/src/index.ts`, add:
```typescript
export { generateCatalogProposal, persistMergedCatalog } from './wiki/reconcile.js';
export type { CatalogProposal } from './wiki/reconcile.js';
```

- [ ] **Step 3: typecheck + lint + commit**

`bun run typecheck` (16/16), `bun run lint` (clean). Fix anything (e.g. ensure `getWikiJsonPath`/`finalizeWiki`/`logger` are actually exported from `@open-zread/utils` — they are; and `generateWikiCatalog` from `../orchestrator.js`).
```bash
git add packages/orchestrator/src/wiki/reconcile.ts packages/orchestrator/src/index.ts
git commit -m "feat(orchestrator): catalog reconciliation proposal + merged-catalog persist" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: `generateCatalogProposal` runs the LLM agent; behavior verified in the manual smoke. The backup/restore preserves the live wiki.json (small crash-window risk between agent write and restore — acceptable for v1).

---

## Task 4: TUI merge-review view + home entry

**Files:**
- Create: `apps/cli/src/views/catalog-merge/index.tsx`
- Modify: `apps/cli/src/App.tsx`, `apps/cli/src/views/wiki-home/index.tsx`, i18n (`types.ts`, `zh-CN.ts`, `en-US.ts`)

- [ ] **Step 1: Build the merge-review view**

Create `apps/cli/src/views/catalog-merge/index.tsx`. Write idiomatic Ink following `apps/cli/src/views/catalog-editor/index.tsx` (state machine, useInput, useEscHandler if you add a sub-mode) and `apps/cli/src/views/wiki-generate/` (agent-event progress). Requirements:

- Default export `CatalogMergePage`.
- Phase state: `'proposing' | 'review' | 'applying' | 'done' | 'error'`.
- On mount (once), call `generateCatalogProposal(handleEvent)` from `@open-zread/orchestrator`; show a "生成提案中…" status driven by the agent events (mirror how `use-catalog.ts` maps `CatalogEvent`). Store the resulting `{ plan, local, remote }`.
- In `review` phase, render the plan grouped: ADD / UPDATE / CONFLICT / REMOVE (use the i18n labels). Show each item's title + id-short. Maintain decision state:
  - `acceptedAddIds`, `acceptedUpdateIds`, `acceptedRemoveIds` as `Set<string>` (default: adds+updates accepted, removes NOT accepted by default — conservative); `conflictResolutions` as `Map<string,'local'|'remote'>` (default: 'local' — keep user's).
  - ↑/↓ to move a cursor over a flattened list of items; `space`/`enter` to toggle accept (for add/update/remove) or cycle local↔remote (for conflict).
- `s` to confirm: set phase `applying`; call `applyMergePlan(local, plan, decisions)` (from `@open-zread/utils`) → `persistMergedCatalog(result.pages, remote)` → if `result.toGenerate.length > 0` call `generateWikiContent({ pages: result.toGenerate, onEvent: handleEvent })` (from `@open-zread/orchestrator`) → on success set `done` and (if a WikiProvider reload is available via `useWiki`) reload. Show progress/status.
- Footer hints per phase. ESC handled by Layout (back) in review; if you add any text sub-mode, use `useEscHandler` like the editor.
- Empty plan (no adds/updates/conflicts/removes) → show "无变更可合并" and allow ESC back.

Keep the component focused. Reuse the existing event→status mapping style; do not invent a new event protocol.

- [ ] **Step 2: Route + home entry + i18n**

- `App.tsx`: import `CatalogMergePage`, add `<Route path="/wiki/catalog-merge" element={<CatalogMergePage />} />` under `<WikiProvider>`.
- `wiki-home/index.tsx`: in the completed-wiki block, add `items.push({ label: t('wiki.regenerateMerge'), value: 'regenerate-merge' })` (place it near `force`), and a `case 'regenerate-merge': navigate('/wiki/catalog-merge'); break;`.
- i18n: add `wiki.regenerateMerge` ("重新生成（合并）" / "Regenerate (merge)") to `types.ts` (in the `wiki` block) + both translation files. Add a top-level `catalogMerge` block with the labels you use: `{ title, proposing, review, applying, done, empty, add, update, conflict, remove, hintReview }` in `types.ts` + both locales.

- [ ] **Step 3: typecheck + lint**

`bun run typecheck` (16/16 — i18n keys must be in types.ts), `bun run lint` (clean). Fix unused vars / non-null assertions (use the `const id = x?.id; if (!id) return;` pattern).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/views/catalog-merge/ apps/cli/src/App.tsx apps/cli/src/views/wiki-home/index.tsx apps/cli/src/i18n/
git commit -m "feat(cli): TUI catalog merge-review (regenerate as proposal) + home entry" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: this view runs the LLM agent and is interactive; it is NOT unit-verified. Manual smoke in Task 5.

---

## Task 5: Green gate + mark tasks + notes

- [ ] **Step 1: Green gate**

From F:\open-zread: `bun run typecheck` (16/16), `bun run lint` (0), `cd packages/utils && bun test` (all pass incl. apply). Report numbers.

- [ ] **Step 2: Mark plan-ready B2/B3 tasks** in `openspec/changes/living-catalog/tasks.md`: mark `B2.1`–`B2.3` and `B3.1`–`B3.5` `[x]` (built). Note in the commit that interactive verification (V2/V3) is still pending a live run.

- [ ] **Step 3: Append to `openspec/changes/living-catalog/implementation-notes.md`** a "Phase B-Flow" section: what was built, that only `applyMergePlan` is unit-tested, and the manual-smoke checklist (V2: edit+lock a page, run regenerate-merge, locked untouched, conflicts reviewable, only accepted pages generated; V3: pre-diataxis wiki + regenerate-merge → new tracks appear as ADDs without losing content).

- [ ] **Step 4: Commit**

```bash
git add openspec/changes/living-catalog/tasks.md openspec/changes/living-catalog/implementation-notes.md
git commit -m "chore(living-catalog): mark Phase B-Flow tasks; record manual-smoke checklist" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (`catalog-reconciliation`, B2/B3):**
- Regenerate produces a proposal without clobbering live wiki.json → Task 3 (`generateCatalogProposal`, backup/restore). ✓
- Produce CatalogMergePlan from BASE×LOCAL×REMOTE → Task 3 (uses Phase B-Core `computeMergePlan`). ✓
- Glossary-anchored naming + concepts backfill → Task 2 (prompt). ✓
- TUI review: list ADD/UPDATE/CONFLICT/REMOVE, batch-accept clean, decide conflicts → Task 4. ✓
- On confirm: write merged wiki.json + finalize, generate only accepted pages (skip locked/unchanged) → Task 1 (`applyMergePlan` toGenerate) + Task 3 (`persistMergedCatalog`) + Task 4 (calls generateWikiContent). ✓
- Home entry "重新生成（合并）" + i18n → Task 4. ✓
- Diataxis-migration (new tracks → ADDs, content preserved) → emergent from the merge engine; verified in manual smoke (Task 5 / V3). ✓ (behavioral)

**Placeholder scan:** Task 1 fully coded + tested. Task 2 gives exact prompt text. Task 3 fully coded. Task 4 is a precise spec (state machine, decisions, keybindings, exact functions) implemented against the cited existing views — controller-approved deviation from full JSX (same as the editor tasks).

**Type consistency:** `applyMergePlan`/`MergeDecisions`/`ApplyResult` (Task 1) consumed by the view (Task 4); `generateCatalogProposal`/`persistMergedCatalog`/`CatalogProposal` (Task 3) consumed by the view; `CatalogMergePlan` shape matches `@open-zread/types`.

**Verification honesty:** `applyMergePlan` is the only unit-tested piece. The prompt, orchestration, and TUI are typecheck/lint-gated and REQUIRE a live `bun run dev` + LLM run (manual smoke, Task 5). The final report must say so plainly.
