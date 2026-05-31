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

## Phase B-Flow (reconciliation flow + review UI) — built 2026-05-31

Built via subagent-driven development from `docs/superpowers/plans/2026-05-31-living-catalog-phase-b-flow.md`
(plan-ready B2/B3). Green gate: typecheck 16/16, lint clean, utils 73/73, orchestrator 42/42.

New: `packages/utils/src/catalog/apply.ts` (`applyMergePlan` — decisions → merged pages + toGenerate, unit-tested),
`packages/orchestrator/src/wiki/reconcile.ts` (`generateCatalogProposal` backup/restore around the Catalog Agent
so the live wiki.json is never clobbered; `persistMergedCatalog`), glossary-anchored naming + `concepts` backfill
in `generate-catalog.ts`, and the Ink merge-review view `apps/cli/src/views/catalog-merge/` with route
`/wiki/catalog-merge` and wiki-home entry "重新生成（合并）".

### Verification status
- **Unit-tested**: `applyMergePlan` (7 tests) — add/update/reject/conflict-local|remote/remove/locked-skip.
- **Typecheck + lint only** (NOT interactively verified — needs a live LLM run + provider config):
  the proposal orchestration, the glossary-anchored naming (LLM behavior), and the entire TUI merge-review flow.

### Final review findings (opus reviewer)
- **[Resolved] Critical: sidebar clobbered to the regenerated subset.** `generateWikiContent` runs its own
  internal `finalizeWiki` with only `toGenerate`, overwriting `_sidebar.md` to those pages. Fixed by re-running
  `finalizeWiki(getWikiDir(), { pages: <full merged>, glossary })` after generation.
- **[Resolved] Important: ESC abandoned in-flight work.** The view now `claimEsc()` during proposing/applying so
  ESC can't navigate away mid agent-run/generation; releases in review/done/error.
- **[Deferred — minor] `migrateCatalog` cryptic error on malformed agent JSON** (no `pages`): caught by the TUI →
  error phase, LOCAL restored, no data loss; just a poor message.
- **[Deferred — minor] First-run leaves REMOTE wiki.json** when no local existed: largely unreachable (menu entry
  only shows when a completed wiki exists).
- **[Deferred — minor] Crash window** between agent overwrite and restore (inherent to backup/restore-in-place).
- **[Deferred — minor] No defense-in-depth for locked pages in `applyMergePlan`** (unreachable: `computeMergePlan`
  routes locked → kept, never into updates/conflicts/removes).

### ⚠️ Manual smoke checklist (human, requires live LLM + a completed `.open-zread/` wiki)
- **V2**: edit + lock a page in the catalog editor, then run "重新生成（合并）". Confirm: proposal generates without
  clobbering live wiki.json; the locked page never appears as update/conflict (kept); conflicts are reviewable;
  on confirm only accepted adds/updates regenerate (locked/unchanged skipped); `_sidebar`/glossary refresh.
- **V3** (diataxis-migration): on a pre-diataxis wiki (explanation-only), run "重新生成（合并）". Confirm the new
  Tutorial/How-to/Reference track pages appear as ADD proposals and existing pages are preserved (not add+remove).
- **Crash-window note**: `generateCatalogProposal` overwrites then restores wiki.json; a process kill between the
  agent write and the restore could leave wiki.json as REMOTE. Acceptable v1 risk; revisit with a temp-path write.
- **B3.4** (verify diataxis-migration) left unchecked in tasks.md pending this live V3 smoke.

## Phase C (topic scopes + deep-dive) — built 2026-05-31

Built via subagent-driven development from `docs/superpowers/plans/2026-05-31-living-catalog-phase-c.md`
(plan-ready Tasks 24–29). Green gate: typecheck 16/16, lint clean, utils 81/81.

New: `packages/utils/src/catalog/scopes.ts` (`saveScope`/`listScopes`/`loadScope`/`resolveScope` — stale-id
tolerant, unit-tested), `packages/utils/src/catalog/deepdive.ts` (`normalizeDeepDiveChildren` — anchored +
bounded ≤6 + inherits parent section/group + origin ai + fresh ids; `buildAddsOnlyPlan` — unit-tested),
`packages/orchestrator/src/prompts/deep-dive.ts` + `generateDeepDiveCatalog` (scoped agent) +
`generateDeepDiveProposal` (backup/restore, adds-only proposal). Editor gained multi-select (`v`) + save scope
(`S`) + load scope (`L`) + deep-dive trigger (`D` → `/wiki/catalog-merge?deepDive=<id>`); the merge-review view
gained a `?deepDive` branch that reuses the entire Phase B-Flow review→apply→generate path (children arrive as ADDs).

### Design realization
Deep-dive **reuses the B-Flow merge engine + review UI** end to end: the scoped agent's children become an
adds-only `CatalogMergePlan`, reviewed/applied/persisted/generated by the same code. Locked parent is never in
the adds-only plan (children are new pages), so it's untouched. A child is a normal page → it can itself be
deep-dived (recursive) via the same `D` key.

### Verification status
- **Unit-tested**: `scopes.ts` (4) + `deepdive.ts` (4).
- **Typecheck + lint only** (NOT interactively verified — needs a live LLM run): the deep-dive scoped agent,
  the editor scope/deep-dive wiring, and the merge-view `?deepDive` branch.

### Final review findings (opus reviewer)
- **[Resolved] `S`/`L` (save/load scope) were dead when no page selected.** They sat after an `if (!id) return`
  guard but don't need a cursor page; moved above the guard.
- **[Known behavior] Re-deep-diving the same topic replaces prior children.** Child ids are deterministic
  (`deepdive-<parent>-<i>-<slug>`), so a second run with the same slug order idempotently replaces the first run's
  children (manual edits to those children are lost). Different slug order → duplicates. Acceptable; document for users.
- **[Deferred — minor] `existingIds` filter in `generateDeepDiveProposal` is mostly cosmetic** (children get
  re-ided by normalize); it only drops an exact same-slug-as-existing child. Harmless.
- **[Deferred — minor] Scope-name filename collision**: distinct names sanitizing to the same file overwrite
  (e.g. `a b` / `a.b` → `a_b.json`). Low impact; no overwrite warning.
- **[Deferred — minor] `selection` Set not pruned on delete**: a stale id self-heals via `resolveScope` on load.
- **[Manual confirm] Capital `S`/`L`/`D` vs lowercase**: terminal delivers distinct uppercase chars; confirm in smoke.

### ⚠️ Manual smoke checklist (V4, human, live LLM)
- Save a themed selection (`v` several pages → `S` name it), reload it (`L`) → selection restored (stale ids ignored).
- `D` on a page → "深挖（合并）" runs the scoped agent → 3–6 anchored child pages appear as ADD proposals →
  review/accept → children generated under the parent's section; locked parent untouched.
- Recursive: `D` on a freshly-added child → further sub-pages proposed.

## Deferred scope (follow-on plans, not built)
- None — Phase C was the final phase of the living-catalog arc. Remaining open items are the manual smoke
  verifications (V2/V3/V4) which require a live LLM run, and the deferred-minor hardening items noted above.
