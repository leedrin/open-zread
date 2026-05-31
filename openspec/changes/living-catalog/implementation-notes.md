# Implementation Notes: living-catalog

Notes captured during build (for the close phase). These do NOT modify the spec.

## Phase A (foundation) — built 2026-05-31

Built via subagent-driven development from `docs/superpowers/plans/2026-05-31-living-catalog.md`.
Covered plan-ready Tasks 1–9, 13 (data model, migration, persistence, tombstone filter,
node-ops, glossary page renderer + finalize integration). Green gate: typecheck 16/16,
lint clean, utils 34/34, orchestrator 42/42.

### Final review findings (opus reviewer)

- **[Resolved] Glossary lost from sidebar after regeneration loop.** The regen re-finalize
  call (`generate-wiki.ts` ~557) originally omitted `glossary`, so a regen-loop run rebuilt
  `_sidebar.md` without the injected glossary page. Fixed by passing `glossary` to the
  re-finalize call too (mirrors the primary call). The plan had deferred this; fixed during
  build as a strictly-better 1-line change.
- **[Deferred — minor] Empty-glossary render path untested.** `renderGlossaryPage` handles
  `glossary.length === 0` ("（暂无术语）") correctly on inspection but has no unit test.
  Add a test in a later pass.
- **[Pre-existing] Sidebar links omit section dir.** `generateSidebar` links pages as
  `[title](file)` without the section prefix; the glossary page inherits this. Not a Phase A
  regression — applies to all sectioned pages. Revisit if/when sidebar links are corrected.
- **[Awareness] Two id schemes coexist.** `migrate.deriveId(slug)` vs `addPage`'s
  `deriveId(slug-Date.now()-len)`. Intended: human-added pages are new identities distinct
  from migrated AI pages with the same slug. No action needed.

## Phase A-UI (TUI catalog editor) — built 2026-05-31

Built via subagent-driven development from `docs/superpowers/plans/2026-05-31-living-catalog-phase-a-ui.md`
(plan-ready Tasks 10–12). Tree builder unit-tested; Ink view gated by typecheck + lint.
Green gate: typecheck 16/16, lint clean, utils 38/38.

New: `packages/utils/src/catalog/tree.ts` (`buildCatalogTree`), `apps/cli/src/views/catalog-editor/`
(`index.tsx` + `persist.ts`), route `/wiki/catalog-editor`, wiki-home entry "目录编辑器", i18n keys.

### Final review findings (opus reviewer)
- **[Resolved] ESC in sub-modes exited the editor + dropped edits.** The editor never claimed ESC,
  so the Layout's global ESC ran `navigate(-1)` even while the footer said "ESC 取消". Fixed with
  `useEscHandler` claim/release around sub-modes + `key.escape`→browse handler (mirrors config-apikey).
- **[Resolved] Hard-coded strings.** i18n'd the remaining labels (empty/dirty/rename/add/move/uncategorized).
- **[Deferred — minor] UX nits:** add does not move cursor to the new page; new page inherits the
  selected page's `group`; new pages default `level: 'Intermediate'` (no UI to set). Acceptable for Phase A.

### ⚠️ Interactive smoke NOT yet performed
Phase A-UI was built and verified ONLY by typecheck + lint + tree-builder unit tests. No one has run
`bun run dev` to drive the Ink TUI. Human should smoke-test (requires a completed wiki under `.open-zread/`):
1. ESC inside rename/add/move cancels back to browse (does NOT exit the editor / lose edits).
2. Save (`s`) round-trip: wiki.json rewritten, sidebar/index/glossary regenerated, provider reloads,
   glossary + techStackSummary intact (not wiped).
3. Edge catalogs (tombstoned-only / single-page sections): no crash, cursor stays in bounds.

## Phase B-Core (merge engine) — built 2026-05-31

Built via subagent-driven development from `docs/superpowers/plans/2026-05-31-living-catalog-phase-b-core.md`
(plan-ready B1). 100% pure logic, fully unit-tested. Green gate: typecheck 16/16, lint clean, utils 66/66.

New: `packages/utils/src/catalog/align.ts` (`jaccard`, `pageContentEqual`, `alignRemote` — concept-first
identity, fingerprint fallback, thresholds 0.5), `merge.ts` (`computeMergePlan` — full matrix + hard-lock +
tombstone respect + `ensureUniqueIds`), `base-loader.ts` (`loadBaseFromSnapshot`). All re-exported from
`@open-zread/utils`.

### Final review findings (opus reviewer)
- **[Resolved] Critical: silent page loss in `byId` on id collision.** Two remote pages sharing an id (incl.
  alignment-vs-literal collision) → one overwritten/dropped. Fixed with `ensureUniqueIds` on the aligned
  remote list (id-less → deriveId(slug); within-list dup → disambiguated → becomes a distinct ADD).
- **[Resolved] Important: id-less remote page skipped.** `byId`'s `if (p.id)` dropped un-migrated new pages.
  Same `ensureUniqueIds` fix backfills the id so it becomes an ADD.
- **[Resolved] Minor: order-sensitive associatedFiles/concepts compare.** Caused spurious UPDATE/CONFLICT.
  Replaced `arrEq` with order-insensitive `setEq` (matches the set semantics alignment already uses).
- **[Deferred — minor] `pageContentEqual` ignores `slug`/`file`.** A remote-only slug/file relocation is
  treated as no-op. Defensible (slug/file are derived identity, not content); revisit if remote file moves matter.
- **[Deferred — minor] `loadBaseFromSnapshot` trusts dir names.** A malformed dir name sorting above valid
  snapshots that also contains a `wiki.json` could be picked as BASE. Junk dirs without wiki.json are safely
  skipped. Low likelihood; consider validating the `YYYY-MM-DD_HHMM_hash` pattern later.

### Thresholds (design open-question — chosen defaults)
`CONCEPT_THRESHOLD = 0.5`, `FINGERPRINT_THRESHOLD = 0.5` (exported consts in `align.ts`, tunable).

## Deferred scope (follow-on plans, not built)
- **Phase B-Flow** (plan-ready B2/B3): regenerate-as-proposal (run Catalog Agent → REMOTE without overwriting;
  glossary-anchored naming in `generate-catalog.ts`), TUI merge-review view (accept/reject per node; on confirm
  write+finalize+generate only added/accepted), wiki-home "重新生成（合并）" entry, diataxis-migration smoke.
  Needs a live Catalog Agent (LLM) + Ink UI — not unit-verifiable here.
- **Phase C**: topic scopes + deep-dive (Tasks 24–29).
