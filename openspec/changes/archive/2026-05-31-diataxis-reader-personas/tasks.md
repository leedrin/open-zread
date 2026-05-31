## 1. Type Definitions

- [x] 1.1 Add `DocType` union (`'tutorial' | 'howto' | 'reference' | 'explanation'`) to `packages/types/src/wiki.ts`
- [x] 1.2 Add optional `docType?: DocType` to `WikiPage`
- [x] 1.3 Verify exports from `packages/types/src/index.ts`
- [x] 1.4 Run `bun run typecheck`

## 2. Blueprint Tool & Persistence

- [x] 2.1 Extend `GenerateBlueprintTool` inputSchema in `packages/orchestrator/src/tools/output-tools.ts` — add optional `docType` per page item constrained to the four values
- [x] 2.2 In `GenerateBlueprintTool.call()` — include docType distribution in the result summary
- [x] 2.3 Confirm `generateWikiJson()` persists `docType` (passes through `pages` unchanged); add a regression note if needed
- [x] 2.4 Run `bun run typecheck` and `bun run lint`

## 3. Quadrant Prompt Templates

- [x] 3.1 Create `packages/orchestrator/src/prompts/tutorial-page.ts` — tutorial-quadrant rules (build-first, single path, visible output per step, link not embed; anti-pattern list)
- [x] 3.2 Create `packages/orchestrator/src/prompts/howto-page.ts` — how-to-quadrant rules ("如何[动词][对象]" title, skip basics, prerequisites, verification, troubleshooting)
- [x] 3.3 Create `packages/orchestrator/src/prompts/reference-page.ts` — reference-quadrant rules (preserve skeleton, fill descriptions + one example per API, no narrative, no API add/remove)
- [x] 3.4 Keep `page-agent.ts` unchanged as the Explanation template
- [x] 3.5 Add cross-quadrant forward-link instructions to each of the three new templates (and confirm explanation template links to Tutorial)

## 4. Facts-Driven Reference Skeleton

- [x] 4.1 Create `packages/orchestrator/src/wiki/reference-skeleton.ts` with `buildReferenceSkeleton(facts: PageFacts): string`
- [x] 4.2 Render one API table row per `facts.exports` entry: name, signature, doc-as-description, source link (`file#Lline` when line present)
- [x] 4.3 Handle empty exports (no rows) and missing line (no `#L`) cases
- [x] 4.4 Add `buildReferencePrompt(page, facts)` helper that embeds the skeleton and the reference-quadrant constraints

## 5. Prompt Builders for Tutorial / How-to

- [x] 5.1 Add `buildTutorialPrompt(page, facts?, glossary?)` in `generate-wiki.ts` (or a prompt-builders module) reusing `buildGlossarySection` and the Facts section
- [x] 5.2 Add `buildHowToPrompt(page, facts?, glossary?)` reusing the same Glossary/Facts injection
- [x] 5.3 Ensure all four builders share the Facts/Glossary rendering helpers (no duplication)

## 6. Generation Routing

- [x] 6.1 In `generateWikiContent()` page task — add a `switch (page.docType ?? 'explanation')` dispatch
- [x] 6.2 Route `tutorial` → `buildTutorialPrompt` (single pass, standard tool set)
- [x] 6.3 Route `howto` → `buildHowToPrompt` (single pass)
- [x] 6.4 Route `reference` → `buildReferencePrompt` (single pass, no dual-pass even if Advanced)
- [x] 6.5 Route `explanation` → existing logic (Advanced → `generatePageDualPass`, else `buildPagePrompt`)
- [x] 6.6 Confirm regeneration loop uses single-agent `buildRegeneratePrompt` for all docTypes (no quadrant re-selection)

## 7. Catalog Dual-Axis Orchestration

- [x] 7.1 Update `packages/orchestrator/src/prompts/generate-catalog.ts` — instruct producing a Tutorial track, How-to guides (anchored to real entry files/scripts/tests), and Reference pages for export-rich modules, in addition to domain Explanation pages
- [x] 7.2 Specify fixed section names: tutorial→`上手教程`, howto→`操作指南`, reference→`API 参考`; explanation keeps functional-domain section
- [x] 7.3 Add a JSON example to the catalog prompt showing pages with `docType` across all four quadrants
- [x] 7.4 Require how-to pages to have non-empty `associatedFiles`; allow the how-to track to be empty when no workflows are identifiable

## 8. Diátaxis Sidebar Ordering

- [x] 8.1 Update `generateSidebar()` in `packages/utils/src/output/finalize.ts` — apply track priorities (上手教程=0, 操作指南=1, domains=2..N preserving order, API 参考=99)
- [x] 8.2 Preserve insertion order for sections not matching a known track
- [x] 8.3 Verify domain-only wikis (no track sections) keep current ordering (backward compatible)

## 9. Tests

- [x] 9.1 Test `buildReferenceSkeleton()` — one row per export; doc seeds description; source link with/without line; empty exports → no rows
- [x] 9.2 Test `buildReferencePrompt()` — skeleton embedded; forbids API add/remove; forbids narrative
- [x] 9.3 Test `buildTutorialPrompt()` — single-path + link-not-embed instructions present; glossary injected when provided
- [x] 9.4 Test `buildHowToPrompt()` — task-title format + verification/troubleshooting required
- [x] 9.5 Test routing — each docType selects the correct template; reference never dual-passes; explanation Advanced dual-passes
- [x] 9.6 Test `generateSidebar()` ordering — tutorial first, reference last, domains in between; domain-only unchanged
- [x] 9.7 Test `GenerateBlueprintTool` persists docType; omitting docType is valid

## 10. Verification

- [x] 10.1 Run `bun run typecheck` — whole monorepo
- [x] 10.2 Run `bun run lint`
- [x] 10.3 Run existing test suites — `packages/types`, `packages/utils`, `packages/orchestrator`
- [ ] 10.4 Manual: run `bun run dev` on a runnable project; confirm wiki.json contains tutorial/howto/reference pages alongside domain explanation pages
- [ ] 10.5 Manual: confirm the Tutorial page reads as a build-first walkthrough (not architecture prose) and the Reference page is a complete Facts-covered API table
- [ ] 10.6 Manual: confirm sidebar order is 上手教程 → 操作指南 → domains → API 参考, with cross-quadrant links present
- [ ] 10.7 Manual: confirm a domain-only run (Catalog emits no new tracks) reproduces current behavior
