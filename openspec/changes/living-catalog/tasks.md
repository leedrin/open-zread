## Phase A — Editable Catalog Model + TUI Editor

### A1. Data Model & Persistence

- [x] A1.1 Add `id`, `origin`, `locked`, `status`, `depth?`, `concepts?: string[]` to `WikiPage` in `packages/types/src/wiki.ts`; add `TopicScope`, `CatalogMergePlan` type stubs
- [x] A1.2 Add a deterministic `id` generator (from slug) and a `migrateCatalog()` that backfills `id`/`origin`/`locked`/`status` on load (idempotent)
- [x] A1.3 Update `generateWikiJson()` + blueprint load to round-trip the new fields
- [x] A1.4 Update `finalize` to skip `status: 'tombstone'` pages in sidebar, source-index, and generation
- [x] A1.5 Run `bun run typecheck` and `bun run lint`

### A2. Shared Catalog Node Operations (pure, testable)

- [x] A2.1 Create `packages/utils/src/catalog/` with pure node ops: `addPage`, `updatePage`, `tombstonePage`, `movePage`, `toggleLock`, `setDepth`
- [x] A2.2 Unit tests for node ops (identity preserved on rename/move; soft-delete sets tombstone)

### A3. TUI Catalog Editor

- [x] A3.1 New Ink view: catalog tree (section → group → page) with keyboard navigation
- [x] A3.2 Wire add / rename / move / delete (soft) / lock toggle / depth set to the node ops
- [x] A3.3 Save: write `wiki.json` + re-run finalize
- [x] A3.4 Add wiki-home menu entry + i18n (zh-CN / en-US / types.ts)
- [x] A3.5 Run `bun run typecheck` and `bun run lint`

### A4. Glossary Page (deterministic render)

- [x] A4.1 Reserve a stable glossary page (`id`/slug `glossary`, `docType: 'reference'`) in the catalog, visible in sidebar
- [x] A4.2 Add a deterministic renderer in `packages/utils/src/output/` that builds the glossary page from `glossary[]` + each page's `concepts`: per-term (canonical/aliases/definition) + bidirectional term↔page mapping (canonicalPage link + "appears in" list)
- [x] A4.3 Invoke the renderer during finalize; refresh on glossary/concepts change; skip refresh when the glossary page is `locked`
- [x] A4.4 Unit tests: term entries rendered; bidirectional mapping correct; no LLM call; locked page not refreshed

## Phase B — Reconciliation (3-way merge)

### B1. Merge Engine (pure, testable)

- [x] B1.1 `loadBaseFromSnapshot()` — read `wiki.json` from the latest `versions/<...>/`; fall back to current catalog when no snapshot
- [x] B1.2 `alignNodes(base, local, remote)` — priority: exact id → **concept-set match (concepts overlap, primary channel)** → associatedFiles fingerprint fallback → else new page
- [x] B1.3 `computeMergePlan(base, local, remote)` — classify ADD / KEEP / APPLY / CONFLICT / RESPECT-DELETE / REMOVE per the matrix
- [x] B1.4 Enforce hard lock: locked pages preserved verbatim, REMOTE changes for them discarded, excluded from generation
- [x] B1.5 Unit tests for each matrix row + lock protection + fingerprint alignment of a renamed page

### B2. Regenerate-as-Proposal Flow

- [ ] B2.1 Run Catalog Agent to produce REMOTE without overwriting live `wiki.json`
- [ ] B2.2 Produce `CatalogMergePlan` from BASE × LOCAL × REMOTE
- [ ] B2.3 Glossary-anchored naming: update `generate-catalog.ts` so the Catalog Agent names pages from canonical glossary terms (collapse aliases) and records each page's `concepts`

### B3. TUI Merge Review

- [ ] B3.1 Review view: list ADD/APPLY/CONFLICT/REMOVE; batch-accept clean updates; per-node decide conflicts
- [ ] B3.2 On confirm: write merged `wiki.json` + finalize; generate only added/accepted-updated pages (skip locked/unchanged)
- [ ] B3.3 wiki-home entry "重新生成（合并）" alongside `force`; i18n
- [ ] B3.4 Verify diataxis-migration: REMOTE with new tracks → ADD proposals, existing content preserved
- [ ] B3.5 Run `bun run typecheck` and `bun run lint`

## Phase C — Topic Scopes + Deep-Dive

### C1. Topic Scopes

- [ ] C1.1 `TopicScope` persistence under `.open-zread/wiki/scopes/<name>.json` (save/list/load); ignore stale ids
- [ ] C1.2 Editor: save current selection as named scope; load scope → restore selection
- [ ] C1.3 Scope-restricted operation plumbing (operations limited to scope ids)
- [ ] C1.4 Unit tests for scope save/load + stale-id tolerance

### C2. Deep-Dive (explode into sub-tree)

- [ ] C2.1 Scoped Catalog Agent mode: given a topic (page/scope), propose a focused sub-catalog of child pages anchored to real files, bounded count
- [ ] C2.2 Child pages inherit parent section/group, `origin: 'ai'`; merge back via the reconciliation engine (review as ADDs)
- [ ] C2.3 Protect locked parent during deep-dive; support recursive deep-dive on a child
- [ ] C2.4 Editor entry: deep-dive a selected page/scope
- [ ] C2.5 Run `bun run typecheck` and `bun run lint`

## Verification (per phase)

- [ ] V1 Phase A: edit catalog (add/rename/move/delete/lock), save, confirm sidebar reflects edits and tombstoned page hidden
- [ ] V1b Phase A: confirm a glossary page appears in the sidebar and renders the term table + bidirectional term↔page mapping (no LLM call)
- [ ] V2 Phase B: edit + lock a page, run regenerate-merge, confirm locked page untouched, conflicts reviewable, new pages generated
- [ ] V3 Phase B: run regenerate-merge on a pre-diataxis wiki, confirm new tracks appear as ADDs without losing existing content
- [ ] V4 Phase C: save a themed scope, reload it, deep-dive it, confirm child pages proposed/merged and bounded
- [ ] V5 Run full `bun run typecheck`, `bun run lint`, and existing test suites
