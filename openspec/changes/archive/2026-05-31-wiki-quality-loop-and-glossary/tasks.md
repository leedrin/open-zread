## 1. Type Definitions

- [x] 1.1 Add `GlossaryTerm` interface (`term`, `aliases?`, `definition`, `canonicalPage?`) to `packages/types/src/wiki.ts`
- [x] 1.2 Add `glossary?: GlossaryTerm[]` to `WikiOutput` in `packages/types/src/wiki.ts`
- [x] 1.3 Verify exports from `packages/types/src/index.ts`
- [x] 1.4 Run `bun run typecheck`

## 2. Blueprint Glossary (P0-2)

- [x] 2.1 Update `packages/orchestrator/src/prompts/generate-catalog.ts` — instruct the Agent to produce a glossary of core concepts (term/aliases/definition/canonicalPage) alongside pages; add a JSON example showing the `glossary` array
- [x] 2.2 Extend `GenerateBlueprintTool` inputSchema in `packages/orchestrator/src/tools/output-tools.ts` — add optional `glossary` array property
- [x] 2.3 In `GenerateBlueprintTool.call()` — read `input.glossary`, pass it to `generateWikiJson()`; include glossary count in the result summary
- [x] 2.4 Update `generateWikiJson()` in `packages/utils/src/output/wiki-content.ts` — accept optional `glossary` param, persist into `WikiOutput`
- [x] 2.5 Add `buildGlossarySection(glossary)` helper in `packages/orchestrator/src/wiki/generate-wiki.ts` — renders `## 📖 项目术语表（统一命名）` with terms, aliases, definitions, and canonical-naming rule
- [x] 2.6 Update `buildPagePrompt(page, facts, glossary?)` — inject glossary section before the Facts section when glossary is non-empty; omit when absent
- [x] 2.7 Thread glossary from `loadWikiBlueprint()` result through `generateWikiContent()` into `buildPagePrompt()`
- [x] 2.8 Run `bun run typecheck` and `bun run lint`

## 3. Coverage Verifier (P1-5)

- [x] 3.1 Add `analyzeFactsCoverage(content, facts)` to `packages/utils/src/output/quality-audit.ts` — word-boundary, case-sensitive matching of export names; return `{ exportsTotal, exportsCovered, uncoveredExports }`
- [x] 3.2 Add `escapeRegExp()` helper if not already present
- [x] 3.3 Extend `DocMetrics` with `exportsTotal`, `exportsCovered`, `uncoveredExports`
- [x] 3.4 Update `analyzeDoc(filePath, facts?)` — accept optional facts, populate coverage fields (zero when absent)
- [x] 3.5 Update `scoreByComplexity()` — add `coverageScore` (3/2/1 by 80%/60% thresholds; 3 when `exportsTotal === 0`); include in total score
- [x] 3.6 Update `analyzeWiki(wikiPath, pages?, factsMap?)` — accept `factsMap: Map<string, PageFacts>` keyed by `page.file`; look up per-doc facts; add `totalExports`/`totalExportsCovered` to `QualityReport.summary`
- [x] 3.7 Update `finalizeWiki()` `FinalizeOptions` in `packages/utils/src/output/finalize.ts` — add `factsMap?`; forward to `analyzeWiki()`
- [x] 3.8 In `generateWikiContent()` — collect per-page `facts` into a `Map<page.file, PageFacts>` during generation; pass as `factsMap` to `finalizeWiki()`
- [x] 3.9 Run `bun run typecheck` and `bun run lint`

## 4. Quality Regeneration Loop (P0-3)

- [x] 4.1 Create `packages/orchestrator/src/prompts/regenerate-with-feedback.ts` with `buildRegeneratePrompt(page, metrics, facts?)`
- [x] 4.2 Implement dynamic feedback section — list ONLY failing dimensions (diagrams, code-block source links, line count, uncovered exports, mermaid errors) derived from `DocMetrics`
- [x] 4.3 Add "preserve already-correct content" instruction to the regenerate prompt
- [x] 4.4 Add `maxRegenRounds?` (default 1) and `regenThreshold?` (default 0.6) to `GenerateWikiOptions` in `packages/orchestrator/src/wiki/types.ts`
- [x] 4.5 In `generateWikiContent()` — after finalize audit, implement the regeneration loop:
  - select eligible pages (`level === 'basic'` OR coverage `< regenThreshold` with `exportsTotal > 0`)
  - regenerate each via `buildRegeneratePrompt()` (single agent, standard tool set)
  - re-audit regenerated pages; repeat up to `maxRegenRounds`; stop early when none eligible
- [x] 4.6 Guard: when `maxRegenRounds === 0`, skip the loop entirely (backward-compatible)
- [x] 4.7 Report regenerated page count and final quality distribution in logs and `WikiResult`
- [x] 4.8 Run `bun run typecheck` and `bun run lint`

## 5. Dual-Pass Page Agent (P1-6)

- [x] 5.1 Create `packages/orchestrator/src/prompts/architect-page.ts` — first-pass prompt (architecture prose, diagrams, decomposition, design philosophy)
- [x] 5.2 Create `packages/orchestrator/src/prompts/reviewer-page.ts` — second-pass prompt (verify API coverage vs Facts, add examples/source links, fix naming vs Glossary; augment not rewrite)
- [x] 5.3 Add `generatePageDualPass(page, facts, glossary)` helper in `generate-wiki.ts` — runs Architect (`maxTurns: 30`) then Reviewer (`maxTurns: 20`, tools `[FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool]`)
- [x] 5.4 In `generateWikiContent()` page task — route `level === 'Advanced'` to `generatePageDualPass()`, others to existing single-pass
- [x] 5.5 Ensure dual-pass shares the same event/progress callbacks (`page_start`/`page_complete`) so the CLI reflects a single logical page
- [x] 5.6 Confirm regeneration loop (section 4) uses single-agent feedback even for Advanced pages (no dual-pass in regen)
- [x] 5.7 Run `bun run typecheck` and `bun run lint`

## 6. Tests

- [x] 6.1 Test `analyzeFactsCoverage()` — prose mention covered; missing export uncovered; word-boundary precision (`buildRepoMapInternal` ≠ `buildRepoMap`); empty facts → no penalty
- [x] 6.2 Test `scoreByComplexity()` coverage dimension — high/low coverage and no-facts cases
- [ ] 6.3 Test `analyzeWiki()` with a `factsMap` — per-doc coverage computed; aggregate `totalExports`/`totalExportsCovered`
- [x] 6.4 Test `buildGlossarySection()` — renders terms/aliases/definitions; empty glossary → empty/omitted
- [x] 6.5 Test `buildPagePrompt()` — glossary injected before Facts when present; omitted when absent
- [x] 6.6 Test `buildRegeneratePrompt()` — only failing dimensions listed; uncovered exports listed; preserve-correct instruction present
- [ ] 6.7 Test regeneration eligibility predicate — basic, low-coverage, and professional cases
- [ ] 6.8 Test `GenerateBlueprintTool` persists glossary into wiki.json; omits when absent

## 7. Verification

- [x] 7.1 Run `bun run typecheck` — whole monorepo (16/16 tasks pass)
- [x] 7.2 Run `bun run lint` (0 errors, 0 warnings)
- [x] 7.3 Run existing test suites — 17 tests pass across 3 test files
- [ ] 7.4 Manual: run `bun run dev` on open-zread itself; confirm wiki.json contains a glossary and Page docs use canonical terms
- [ ] 7.5 Manual: confirm the audit log reports Facts coverage per doc and aggregate totals
- [ ] 7.6 Manual: introduce a deliberately thin page; confirm it is regenerated once and improves
- [ ] 7.7 Manual: confirm an Advanced page runs Architect then Reviewer (two agent runs, one logical page in the UI)
- [ ] 7.8 Manual: set `maxRegenRounds: 0`; confirm pipeline matches pre-change behavior
- [ ] 7.9 Measure token cost delta with dual-pass + 1 regen round enabled vs. baseline; record in PR description
