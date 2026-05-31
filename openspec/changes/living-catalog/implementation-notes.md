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

### Deferred scope (follow-on plans, not built)
- Phase A-UI: TUI catalog editor (plan-ready Tasks 10–12). No React-hook test infra; manual verify.
- Phase B: reconciliation (Tasks 14–23).
- Phase C: topic scopes + deep-dive (Tasks 24–29).
