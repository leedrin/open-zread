# Implementation Plan: living-catalog

## Source
- Proposal: openspec/changes/living-catalog/proposal.md
- Design: openspec/changes/living-catalog/design.md
- Specs: openspec/changes/living-catalog/specs/
- Tasks: openspec/changes/living-catalog/tasks.md

## Phasing note
Three independently shippable phases: **A** (editable model + TUI editor + glossary page), **B** (3-way reconciliation), **C** (topic scopes + deep-dive). Each phase ends green (typecheck/lint/tests) and is usable on its own. Do not start B before A is merged; C reuses B's merge engine.

## Execution Order

### Task 1: Extend WikiPage type + new catalog types
- Goal: `WikiPage` carries `id`, `origin`, `locked`, `status`, `depth?`, `concepts?`; stub `TopicScope` and `CatalogMergePlan`.
- Source tasks: A1.1
- Design anchors: D1 (stable id + concepts, page→many terms), D-lock 1/3, catalog-editable-model spec
- Changed files: `packages/types/src/wiki.ts`, `packages/types/src/index.ts`
- Validation: `bun run typecheck` (expect downstream errors in non-optional consumers; new fields optional except `id`/`origin`/`locked`/`status` which get defaults via Task 2)
- Depends on: none
- Notes: `slug` stays URL/file-only; `id` is the merge key. `concepts` is `string[]` (one page → many canonical terms). Do NOT remove existing fields.

### Task 2: Catalog migration + deterministic id generator
- Goal: loading a legacy `wiki.json` backfills `id` (deterministic from slug), `origin:'ai'`, `locked:false`, `status:'active'`; idempotent.
- Source tasks: A1.2
- Design anchors: D2 (migration), catalog-editable-model "旧 catalog 迁移补 id"
- Changed files: `packages/utils/src/output/wiki-content.ts` (hook into `loadWikiBlueprint`), `packages/utils/src/catalog/migrate.ts` `to confirm`
- Validation: `bun test` new unit test — legacy pages get ids; second load leaves ids unchanged
- Depends on: 1
- Notes: deterministic id from slug (e.g. stable hash), so re-running yields identical ids. Idempotency is a hard requirement.

### Task 3: Persist new fields round-trip
- Goal: `generateWikiJson()` and load path round-trip `id/origin/locked/status/depth/concepts` losslessly.
- Source tasks: A1.3
- Design anchors: catalog-editable-model "持久化新字段"
- Changed files: `packages/utils/src/output/wiki-content.ts`, `packages/orchestrator/src/tools/output-tools.ts` (GenerateBlueprintTool inputSchema accepts new fields)
- Validation: `bun test` — write a `locked:true, origin:'human'` page, read back, assert preserved
- Depends on: 1, 2
- Notes: GenerateBlueprintTool must accept (not strip) the new fields when the Catalog Agent emits them.

### Task 4: finalize respects tombstone
- Goal: `status:'tombstone'` pages excluded from `_sidebar.md`, `source-files-index.json`, and content generation; still present in `wiki.json`.
- Source tasks: A1.4
- Design anchors: D6 (tombstone + derived artifacts), catalog-editable-model "finalize 尊重 tombstone"
- Changed files: `packages/utils/src/output/finalize.ts`
- Validation: `bun test` (extend sidebar-ordering-style test) — tombstoned page absent from sidebar, active pages unaffected
- Depends on: 1
- Notes: only filter at the derivation boundary; never physically delete from `wiki.json`.

### Task 5: Shared catalog node operations (pure)
- Goal: pure functions `addPage`, `updatePage`, `tombstonePage`, `movePage`, `toggleLock`, `setDepth` operating on a catalog node tree.
- Source tasks: A2.1
- Design anchors: D5 (editor + review share node ops)
- Changed files: `packages/utils/src/catalog/node-ops.ts` `to confirm`, `packages/utils/src/catalog/index.ts` `to confirm`, `packages/utils/src/index.ts` (re-export)
- Validation: `bun test` Task 6
- Depends on: 1
- Notes: pure/no-IO so both the TUI editor and the merge-review reuse them (D5). Rename/move must preserve `id`.

### Task 6: Node ops unit tests
- Goal: cover identity preserved on rename/move; soft-delete sets tombstone; lock/depth toggles.
- Source tasks: A2.2
- Design anchors: catalog-editable-model scenarios
- Changed files: `packages/utils/src/catalog/__tests__/node-ops.test.ts` `to confirm`
- Validation: `bun test packages/utils/src/catalog/__tests__/node-ops.test.ts`
- Depends on: 5

### Task 7: Glossary page deterministic renderer
- Goal: build the glossary page markdown from `glossary[]` + each page's `concepts`: per-term (canonical/aliases/definition) + bidirectional term↔page mapping (canonicalPage link + "appears in" list). No LLM.
- Source tasks: A4.2
- Design anchors: D9 (deterministic render), catalog-glossary-page spec
- Changed files: `packages/utils/src/output/glossary-page.ts` `to confirm`
- Validation: `bun test` Task 9 (renderer assertions)
- Depends on: 1
- Notes: pure render, zero tokens, no Agent call. Reuse existing `GlossaryTerm` (term/aliases/definition/canonicalPage).

### Task 8: Reserve glossary page in catalog + finalize hook
- Goal: a stable glossary page (`id`/slug `glossary`, `docType:'reference'`) appears in the sidebar; finalize invokes the renderer and refreshes on glossary/concepts change; skips refresh when the page is `locked`.
- Source tasks: A4.1, A4.3
- Design anchors: D9, D-lock 3 (locked → no refresh), catalog-glossary-page "刷新"
- Changed files: `packages/utils/src/output/finalize.ts`, `packages/utils/src/output/glossary-page.ts` `to confirm`
- Validation: manual — after finalize, `.open-zread/wiki/.../glossary.md` exists and is in `_sidebar.md`; re-run after editing glossary updates it; lock it → unchanged
- Depends on: 4, 7
- Notes: glossary page is a real visible page but its content is derived (like `_sidebar.md`). Honor lock for consistency with D-lock 3.

### Task 9: Glossary page renderer tests
- Goal: term entries rendered; bidirectional mapping correct; no LLM call; locked page not refreshed.
- Source tasks: A4.4
- Design anchors: catalog-glossary-page scenarios
- Changed files: `packages/utils/src/output/__tests__/glossary-page.test.ts` `to confirm`
- Validation: `bun test packages/utils/src/output/__tests__/glossary-page.test.ts`
- Depends on: 7, 8

### Task 10: TUI catalog editor — tree view
- Goal: new Ink view rendering catalog as section → group → page with keyboard navigation.
- Source tasks: A3.1
- Design anchors: D-lock 2 (real TUI editor), catalog-tui-editor spec
- Changed files: `apps/cli/src/views/catalog-editor/index.tsx` `to confirm`, route registration in `apps/cli/src/App.tsx` `to confirm`
- Validation: manual — `bun run dev` → open editor → tree renders and navigates
- Depends on: 3
- Notes: follow DESIGN.md (Notion warm palette, whisper borders). Read-only first, then Task 11 wires mutations.

### Task 11: TUI editor — mutations wired to node ops
- Goal: add / rename / move / delete(soft) / lock toggle / depth set call the shared node ops; save writes `wiki.json` + re-runs finalize.
- Source tasks: A3.2, A3.3
- Design anchors: D5 (shared ops), catalog-tui-editor scenarios (add→origin:human, delete→tombstone, rename keeps id)
- Changed files: `apps/cli/src/views/catalog-editor/index.tsx` `to confirm`, hooks `apps/cli/src/views/catalog-editor/hooks/` `to confirm`
- Validation: manual V1 — edit/save, confirm `wiki.json` + `_sidebar.md` reflect edits, tombstoned page hidden
- Depends on: 5, 10
- Notes: new pages → `origin:'human'`, fresh `id`. Delete is soft (tombstone). Rename keeps `id`.

### Task 12: Editor home-menu entry + i18n
- Goal: wiki-home shows a "目录编辑器" entry when wiki.json exists; i18n keys added.
- Source tasks: A3.4
- Design anchors: catalog-tui-editor "reachable from home"
- Changed files: `apps/cli/src/views/wiki-home/index.tsx`, `apps/cli/src/i18n/translations/zh-CN.ts`, `apps/cli/src/i18n/translations/en-US.ts`, `apps/cli/src/i18n/types.ts`
- Validation: `bun run typecheck` (i18n key must exist in `TranslationKeys`), manual menu render
- Depends on: 10
- Notes: i18n type is canonical in `types.ts` — add the key there or typecheck fails (known gotcha from prior change).

### Task 13: Phase A green gate
- Goal: typecheck + lint + tests pass; Phase A is shippable.
- Source tasks: A1.5, A3.5, V1, V1b
- Design anchors: D7 (phase independence)
- Changed files: none
- Validation: `bun run typecheck` && `bun run lint` && `bun test` (utils + orchestrator); manual V1/V1b
- Depends on: 1-12

### Task 14: BASE loader from snapshot
- Goal: `loadBaseFromSnapshot()` reads `wiki.json` from the latest `versions/<...>/`; falls back to current catalog when no snapshot.
- Source tasks: B1.1
- Design anchors: D2 (snapshot = BASE), catalog-reconciliation "BASE = snapshot"
- Changed files: `packages/utils/src/catalog/base-loader.ts` `to confirm`
- Validation: `bun test` — picks newest snapshot dir; no-snapshot returns current catalog
- Depends on: 13
- Notes: reuse `versions/` produced by `createVersionSnapshot` (already shipped in incremental-update-and-snapshots).

### Task 15: Identity alignment (concept channel primary)
- Goal: `alignNodes(base, local, remote)` priority: exact `id` → concept-set match → associatedFiles fingerprint → else new.
- Source tasks: B1.2
- Design anchors: D1 (alignment order, concept channel primary), catalog-reconciliation "身份对齐"
- Changed files: `packages/utils/src/catalog/align.ts` `to confirm`
- Validation: `bun test` Task 18 — renamed page matched by concept; concept beats fingerprint; fingerprint fallback when concepts absent
- Depends on: 14
- Notes: concept channel MUST take precedence over fingerprint. When neither matches → ADD/REMOVE proposal (never silent overwrite). Threshold conservative; open question — start with shared-primary-term OR Jaccard≥0.6.

### Task 16: Three-way merge plan
- Goal: `computeMergePlan(base, local, remote)` classifies ADD / KEEP / APPLY / CONFLICT / RESPECT-DELETE / REMOVE per the matrix.
- Source tasks: B1.3
- Design anchors: D3 (merge matrix), catalog-reconciliation "合并矩阵"
- Changed files: `packages/utils/src/catalog/merge.ts` `to confirm`
- Validation: `bun test` Task 18 — one test per matrix row
- Depends on: 15

### Task 17: Hard-lock enforcement in merge
- Goal: `locked` pages preserved verbatim, REMOTE changes for them discarded, excluded from generation.
- Source tasks: B1.4
- Design anchors: D-lock 3 (hard guarantee), catalog-reconciliation "locked 是硬保证"
- Changed files: `packages/utils/src/catalog/merge.ts` `to confirm`
- Validation: `bun test` Task 18 — locked page ignores REMOTE; excluded from generation set
- Depends on: 16
- Notes: lock is absolute — content, metadata, position all immutable. This is a contract, not a tie-breaker.

### Task 18: Merge engine unit tests
- Goal: each matrix row + lock protection + concept/fingerprint alignment of a renamed page.
- Source tasks: B1.5
- Design anchors: catalog-reconciliation scenarios
- Changed files: `packages/utils/src/catalog/__tests__/merge.test.ts` `to confirm`
- Validation: `bun test packages/utils/src/catalog/__tests__/merge.test.ts`
- Depends on: 15, 16, 17

### Task 19: Glossary-anchored naming in Catalog Agent
- Goal: `generate-catalog.ts` instructs the Agent to name pages from canonical glossary terms (collapse aliases) and record each page's `concepts`.
- Source tasks: B2.3
- Design anchors: D8 (drift prevention), catalog-reconciliation "术语锚定命名"
- Changed files: `packages/orchestrator/src/prompts/generate-catalog.ts`, `packages/orchestrator/src/tools/output-tools.ts` (accept `concepts`)
- Validation: manual — generated catalog pages carry `concepts`; titles use canonical terms
- Depends on: 3
- Notes: treats the drift cause, complementing Task 15's matching. concepts = owned canonical terms (page→many).

### Task 20: Regenerate-as-proposal flow
- Goal: a "regenerate (merge)" action runs the Catalog Agent to produce REMOTE WITHOUT overwriting live `wiki.json`, then computes `CatalogMergePlan` from BASE×LOCAL×REMOTE.
- Source tasks: B2.1, B2.2
- Design anchors: catalog-reconciliation "重新生成产出提案而非覆盖"
- Changed files: `apps/cli/src/views/wiki-generate/hooks/` `to confirm`, orchestrator entry `packages/orchestrator/src/orchestrator.ts` (proposal mode) `to confirm`
- Validation: manual — run regenerate-merge, confirm live `wiki.json` untouched until accepted
- Depends on: 16, 19

### Task 21: TUI merge review
- Goal: review view lists ADD/APPLY/CONFLICT/REMOVE; batch-accept clean updates; per-node decide conflicts; on confirm write merged `wiki.json` + finalize + generate only added/accepted-updated pages (skip locked/unchanged).
- Source tasks: B3.1, B3.2
- Design anchors: D4 (review screen), catalog-reconciliation "TUI 冲突 review"
- Changed files: `apps/cli/src/views/catalog-merge/index.tsx` `to confirm`, route in `apps/cli/src/App.tsx` `to confirm`
- Validation: manual V2 — edit+lock a page, regenerate-merge, locked untouched, conflicts reviewable, only new/accepted pages generated
- Depends on: 17, 18, 20
- Notes: conflicts MUST be decided individually; clean updates MAY batch-accept.

### Task 22: Reconciliation home entry + diataxis-migration check
- Goal: wiki-home "重新生成（合并）" alongside `force`; i18n; verify a pre-diataxis wiki gains new tracks as ADDs without losing content.
- Source tasks: B3.3, B3.4, B3.5
- Design anchors: catalog-reconciliation "修复 diataxis 迁移缺口"
- Changed files: `apps/cli/src/views/wiki-home/index.tsx`, `apps/cli/src/i18n/translations/*`, `apps/cli/src/i18n/types.ts`
- Validation: `bun run typecheck` && `bun run lint`; manual V3 — old wiki + regenerate-merge → tutorial/howto/reference appear as ADDs, existing content preserved
- Depends on: 21
- Notes: this is the concrete payoff that closes the diataxis-migration gap.

### Task 23: Phase B green gate
- Goal: typecheck + lint + tests pass; Phase B shippable.
- Source tasks: V2, V3
- Design anchors: D7
- Changed files: none
- Validation: `bun run typecheck` && `bun run lint` && `bun test`; manual V2/V3
- Depends on: 14-22

### Task 24: Topic scope persistence
- Goal: `TopicScope` save/list/load under `.open-zread/wiki/scopes/<name>.json`; ignore stale ids.
- Source tasks: C1.1
- Design anchors: D-lock 1 (themed collection), catalog-topic-scopes spec
- Changed files: `packages/utils/src/catalog/scopes.ts` `to confirm`
- Validation: `bun test` Task 27 — save/load round-trip; stale id skipped
- Depends on: 23
- Notes: scope stores `pageIds` (references), never copies content.

### Task 25: Scope save/load in editor + scope-restricted ops
- Goal: editor saves current selection as a named scope and loads a scope to restore selection; operations can be restricted to scope ids.
- Source tasks: C1.2, C1.3
- Design anchors: catalog-topic-scopes "保存/读取/集合驱动聚焦操作"
- Changed files: `apps/cli/src/views/catalog-editor/` `to confirm`
- Validation: manual — save "战斗系统深潜", reload restores selection; scoped op touches only scope pages
- Depends on: 24
- Notes: stale ids tolerated gracefully.

### Task 26: Scope unit tests
- Goal: save/load round-trip + stale-id tolerance.
- Source tasks: C1.4
- Design anchors: catalog-topic-scopes scenarios
- Changed files: `packages/utils/src/catalog/__tests__/scopes.test.ts` `to confirm`
- Validation: `bun test packages/utils/src/catalog/__tests__/scopes.test.ts`
- Depends on: 24

### Task 27: Deep-dive scoped sub-catalog generation
- Goal: scoped Catalog Agent mode — given a topic (page/scope), propose a focused sub-catalog of child pages anchored to real files, bounded count.
- Source tasks: C2.1
- Design anchors: D-lock 4 (explode into sub-tree), catalog-deep-dive "约束与递归"
- Changed files: `packages/orchestrator/src/prompts/generate-catalog.ts` (scoped variant) `to confirm`, `packages/orchestrator/src/orchestrator.ts` (deep-dive entry) `to confirm`
- Validation: manual — deep-dive "技能系统" yields multiple child pages, each with non-empty associatedFiles, ≤ upper bound
- Depends on: 23
- Notes: bound child count (open question default ≤6, configurable); every child MUST anchor to real files (reuse how-to anchoring discipline).

### Task 28: Deep-dive merges via reconciliation + recursion
- Goal: deep-dive output flows through the reconciliation engine (children as ADDs, reviewable); locked parent protected; a child may itself be deep-dived.
- Source tasks: C2.2, C2.3, C2.4
- Design anchors: D-lock 4 + D-lock 3, catalog-deep-dive "经合并回主目录"
- Changed files: `apps/cli/src/views/catalog-editor/` `to confirm` (deep-dive action), reuse `packages/utils/src/catalog/merge.ts`
- Validation: manual V4 — deep-dive a scope, children proposed/merged as ADDs and bounded; locked parent untouched; recursive deep-dive works
- Depends on: 16, 17, 25, 27
- Notes: children inherit parent section/group, `origin:'ai'`. Reuse the Phase B merge engine — do not build a second merge path.

### Task 29: Phase C green gate + full verification
- Goal: all phases green.
- Source tasks: C2.5, V4, V5
- Design anchors: D7
- Changed files: none
- Validation: `bun run typecheck` && `bun run lint` && `bun test` (full suites); manual V4
- Depends on: 24-28

## Handoff notes for build
- Use Superpowers TDD where a test path exists (pure modules in `packages/utils/src/catalog/` and `output/` — Tasks 6, 9, 18, 26 are test-first candidates).
- TUI tasks (10, 11, 21, 25, 28) have no React-hook test infra in this repo — verify manually via `bun run dev`, mirroring how `incremental-update-and-snapshots` was verified.
- Do not rewrite OpenSpec artifacts during build. If implementation exposes a spec issue (e.g. concept-threshold tuning, deep-dive child cap), record it and resolve in close.
- Two open questions are deliberately left to build-time tuning: concept-match threshold (Task 15) and deep-dive child upper bound (Task 27). Pick conservative defaults; note chosen values in the PR.
