# Implementation Plan: wiki-quality-loop-and-glossary

## Source
- Proposal: openspec/changes/wiki-quality-loop-and-glossary/proposal.md
- Design: openspec/changes/wiki-quality-loop-and-glossary/design.md
- Specs: openspec/changes/wiki-quality-loop-and-glossary/specs/
  - specs/blueprint-glossary/spec.md
  - specs/coverage-verifier/spec.md
  - specs/quality-regeneration-loop/spec.md
  - specs/dual-pass-page-agent/spec.md
- Tasks: openspec/changes/wiki-quality-loop-and-glossary/tasks.md

## Execution Order

---

### Task 1: Add GlossaryTerm type to packages/types
- Goal: Define `GlossaryTerm` interface and extend `WikiOutput` with optional `glossary` field
- Source tasks: 1.1, 1.2, 1.3, 1.4
- Design anchors: D2 (GlossaryTerm 结构)
- Changed files:
  - `packages/types/src/wiki.ts` — add `GlossaryTerm` interface; add `glossary?: GlossaryTerm[]` to `WikiOutput`
  - `packages/types/src/index.ts` — export `GlossaryTerm`
- Validation: `bun run typecheck`
- Depends on: none
- Notes: GlossaryTerm fields: `term: string`, `aliases?: string[]`, `definition: string`, `canonicalPage?: string`. Glossary is optional on WikiOutput for backward compatibility (D2).

---

### Task 2: Update catalog prompt to request glossary
- Goal: Instruct the Blueprint Agent to produce a `glossary[]` alongside `pages[]`
- Source tasks: 2.1
- Design anchors: D1 (Glossary 由 Catalog Agent 一次性产出)
- Changed files:
  - `packages/orchestrator/src/prompts/generate-catalog.ts`
- Validation: `bun run typecheck`
- Depends on: none
- Notes: Add a new section instructing the agent to identify core domain concepts and emit them as glossary terms (term/aliases/definition/canonicalPage). Add a JSON example showing the `glossary` array alongside `pages` in the `generate_blueprint` call example. The prompt should emphasize that glossary captures canonical names to enforce cross-page naming consistency.

---

### Task 3: Extend GenerateBlueprintTool to accept and persist glossary
- Goal: `generate_blueprint` tool accepts optional `glossary` and passes it to `generateWikiJson()`
- Source tasks: 2.2, 2.3, 2.4
- Design anchors: D1, D2 (glossary persisted into wiki.json, not separate file)
- Changed files:
  - `packages/orchestrator/src/tools/output-tools.ts` — add optional `glossary` to inputSchema properties; in `call()`, read `input.glossary` and pass to `generateWikiJson()`; include glossary count in result summary
  - `packages/utils/src/output/wiki-content.ts` — `generateWikiJson()` accept optional `glossary` param, persist into `WikiOutput`
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 1
- Notes: Glossary is optional in both inputSchema and `generateWikiJson()`. When absent, `WikiOutput.glossary` is `undefined`. Backward compatible (D2).

---

### Task 4: Add buildGlossarySection() helper and inject into buildPagePrompt
- Goal: Render `## 📖 项目术语表（统一命名）` before Facts when glossary is present
- Source tasks: 2.5, 2.6, 2.7
- Design anchors: D3 (Glossary 注入位置 — Facts 段落之前)
- Changed files:
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — add `buildGlossarySection(glossary: GlossaryTerm[]): string` helper; update `buildPagePrompt(page, facts, glossary?)` signature; inject glossary section before the Facts section when glossary is non-empty; thread glossary from `loadWikiBlueprint()` result through `generateWikiContent()` options into `buildPagePrompt()`
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 1, Task 3
- Notes: Glossary section lists each term with aliases and definition, plus a rule: "提到这些概念时必须使用术语表中的规范名称". When glossary is absent/empty, the section is entirely omitted (D3). Need to extend `GenerateWikiOptions` to accept glossary or read it from loaded blueprint.

---

### Task 5: Add analyzeFactsCoverage() to quality-audit.ts
- Goal: Implement word-boundary, case-sensitive export name matching for coverage analysis
- Source tasks: 3.1, 3.2
- Design anchors: D4 (覆盖率提及判定 — 标识符级文本匹配)
- Changed files:
  - `packages/utils/src/output/quality-audit.ts` — add `escapeRegExp()` helper; add `analyzeFactsCoverage(content: string, facts: PageFacts): { exportsTotal, exportsCovered, uncoveredExports }`; use `\b${name}\b` regex for word-boundary matching
- Validation: `bun run typecheck && bun run lint`
- Depends on: none
- Notes: Import `PageFacts` from `@open-zread/types`. When `facts.exports` is empty, return `{ exportsTotal: 0, exportsCovered: 0, uncoveredExports: [] }` (D4 — no penalty).

---

### Task 6: Extend DocMetrics and scoring with coverage
- Goal: Add coverage fields to `DocMetrics`, update `analyzeDoc()`, `scoreByComplexity()` with `coverageScore`
- Source tasks: 3.3, 3.4, 3.5
- Design anchors: D5 (DocMetrics 与评分扩展)
- Changed files:
  - `packages/utils/src/output/quality-audit.ts` — add `exportsTotal`, `exportsCovered`, `uncoveredExports` to `DocMetrics` interface; update `analyzeDoc(filePath, facts?)` to accept optional `PageFacts`, populate coverage fields via `analyzeFactsCoverage()` (zero when absent); update `scoreByComplexity()` to add `coverageScore` (3/2/1 by 80%/60% thresholds; 3 when `exportsTotal === 0`); include in `totalScore`
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 5
- Notes: Coverage score thresholds (D5): ≥80% or no facts → 3; 60%-80% → 2; <60% → 1. Add to existing 6 dimensions (diagram, codeBlock, sourceLink, security, mermaid, length) making total max 21 for Advanced pages. Level thresholds in `scoreByComplexity` will need recalibration since total max increases by 3.

---

### Task 7: Thread factsMap through analyzeWiki → finalizeWiki → generateWikiContent
- Goal: Propagate per-page Facts from generation to audit via `factsMap: Map<string, PageFacts>`
- Source tasks: 3.6, 3.7, 3.8
- Design anchors: D6 (factsMap 透传链路)
- Changed files:
  - `packages/utils/src/output/quality-audit.ts` — update `analyzeWiki(wikiPath, pages?, factsMap?)` to accept optional `factsMap: Map<string, PageFacts>`; look up per-doc facts by `page.file` key (same as `pageMap`); pass to `analyzeDoc()`; add `totalExports`/`totalExportsCovered` to `QualityReport.summary`
  - `packages/utils/src/output/finalize.ts` — update `FinalizeOptions` to include `factsMap?`; forward to `analyzeWiki()`
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — in `generateWikiContent()`, collect per-page `facts` into `Map<page.file, PageFacts>` during generation loop; pass as `factsMap` to `finalizeWiki()`
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 6
- Notes: Key alignment (D6): `factsMap` key is `page.file`, matching `pageMap.get(relativeFile)` in `analyzeWiki`. When `factsMap` is absent, coverage defaults to zero/full-score — backward compatible.

---

### Task 8: Create regenerate-with-feedback prompt builder
- Goal: Build `buildRegeneratePrompt()` that prepends targeted feedback from `DocMetrics`
- Source tasks: 4.1, 4.2, 4.3
- Design anchors: D8 (重生反馈 Prompt 内容)
- Changed files:
  - `packages/orchestrator/src/prompts/regenerate-with-feedback.ts` — new file; export `buildRegeneratePrompt(page: WikiPage, metrics: DocMetrics, facts?: PageFacts): string`; dynamically derive failing dimensions from metrics; list ONLY items not meeting targets (diagrams, source links, line count, uncovered exports, mermaid errors); include "preserve already-correct content" instruction
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 1 (WikiPage type), Task 6 (DocMetrics)
- Notes: Feedback section format (D8): `## ⚠️ 上一次生成评分为 basic，请针对性补全：` followed by bullet list of ONLY failing dimensions. Include uncovered exports by name. End with "请基于现有内容补全上述缺失，保持已正确的部分不变。"

---

### Task 9: Implement regeneration loop in generateWikiContent
- Goal: After finalize audit, regenerate eligible pages (basic/low-coverage) up to `maxRegenRounds`
- Source tasks: 4.4, 4.5, 4.6, 4.7
- Design anchors: D7 (重生触发条件与轮次控制), D10 (双轮与重生环正交)
- Changed files:
  - `packages/orchestrator/src/wiki/types.ts` — add `maxRegenRounds?: number` (default 1) and `regenThreshold?: number` (default 0.6) to `GenerateWikiOptions`; add `regeneratedCount?: number` to `WikiResult`
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — after finalize audit, implement loop: collect eligible pages (`level === 'basic'` OR `exportsTotal > 0 && coverage < regenThreshold`); regenerate each via `buildRegeneratePrompt()` with single agent + standard tool set; re-audit regenerated pages; repeat up to `maxRegenRounds`; stop early when none eligible; guard when `maxRegenRounds === 0`; report count in logs and WikiResult
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 7 (factsMap + audit integration), Task 8 (regenerate prompt)
- Notes: Default `maxRegenRounds: 1` (D7). Regen uses single-agent `buildRegeneratePrompt`, NOT dual-pass, even for Advanced pages (D10). Must re-audit only regenerated pages (not full wiki) for efficiency.

---

### Task 10: Create architect-page.ts prompt
- Goal: First-pass prompt for Advanced pages focusing on architecture, diagrams, design philosophy
- Source tasks: 5.1
- Design anchors: D9 (Architect Agent 职责)
- Changed files:
  - `packages/orchestrator/src/prompts/architect-page.ts` — new file; export default prompt string; focus on: architectural prose, Mermaid diagrams, module decomposition, design philosophy; receives page's Facts and Glossary; writes initial document skeleton via `write_page`
- Validation: `bun run typecheck`
- Depends on: none
- Notes: Architect writes the first draft — complete on architecture and diagrams but may lack API detail completeness (D9).

---

### Task 11: Create reviewer-page.ts prompt
- Goal: Second-pass prompt that verifies API coverage against Facts and augments gaps
- Source tasks: 5.2
- Design anchors: D9 (Reviewer Agent 职责)
- Changed files:
  - `packages/orchestrator/src/prompts/reviewer-page.ts` — new file; export default prompt string; receives architect output + Facts (emphasizing completeness); verify API coverage vs Facts, add code examples/source links, fix naming vs Glossary; instructed to augment not rewrite; has `read_page` access
- Validation: `bun run typecheck`
- Depends on: none
- Notes: Reviewer must be instructed "只补全/修正，不重写已正确部分" and use `read_page` to read existing document before editing (D9).

---

### Task 12: Add generatePageDualPass() and route Advanced pages
- Goal: Implement dual-pass generation (Architect → Reviewer) for Advanced pages
- Source tasks: 5.3, 5.4, 5.5, 5.6
- Design anchors: D9 (角色分工 + maxTurns), D10 (双轮与重生环正交)
- Changed files:
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — add `generatePageDualPass(page, facts, glossary)` helper: runs Architect agent (`maxTurns: 30`) then Reviewer agent (`maxTurns: 20`, tools `[FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool]`); in page task, route `page.level === 'Advanced'` to dual-pass, others to single-pass; dual-pass shares same `page_start`/`page_complete` events so CLI shows one logical page
- Validation: `bun run typecheck && bun run lint`
- Depends on: Task 10, Task 11
- Notes: Architect `maxTurns: 30`, Reviewer `maxTurns: 20` (D9). Reviewer tool set: `FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool` (D9). Regen loop (Task 9) always uses single-agent even for Advanced pages — confirm this routing is correct (D10).

---

### Task 13: Write unit tests for coverage analysis
- Goal: Verify `analyzeFactsCoverage()`, `scoreByComplexity()` coverage dimension, `analyzeWiki()` with factsMap
- Source tasks: 6.1, 6.2, 6.3
- Design anchors: D4, D5
- Changed files:
  - To confirm — test file in `packages/utils/` (e.g., `packages/utils/tests/quality-audit.test.ts` or adjacent to source)
- Validation: `bun test` (or project test command)
- Depends on: Task 5, Task 6, Task 7
- Notes: Test cases (from tasks 6.1-6.3): prose mention → covered; missing export → uncovered; word-boundary precision (`buildRepoMapInternal` ≠ `buildRepoMap`); empty facts → no penalty; high/low/no-facts coverage scores; `analyzeWiki` with factsMap computes per-doc and aggregate totals.

---

### Task 14: Write unit tests for glossary and regeneration
- Goal: Verify glossary rendering, prompt injection, regenerate feedback, and eligibility logic
- Source tasks: 6.4, 6.5, 6.6, 6.7, 6.8
- Design anchors: D3, D7, D8
- Changed files:
  - To confirm — test files in `packages/orchestrator/tests/` and `packages/utils/tests/`
- Validation: `bun test`
- Depends on: Task 4, Task 8, Task 9
- Notes: Test cases: `buildGlossarySection()` renders terms/aliases; empty glossary → omitted; `buildPagePrompt()` glossary before Facts; `buildRegeneratePrompt()` only failing dimensions listed; uncovered exports listed; preserve instruction present; eligibility: basic/low-coverage/professional cases; `GenerateBlueprintTool` persists glossary to wiki.json.

---

### Task 15: Full verification and manual testing
- Goal: Confirm all changes work together end-to-end
- Source tasks: 7.1–7.9
- Design anchors: Migration/Rollout (分阶段开启)
- Changed files: none (verification only)
- Validation:
  - `bun run typecheck` — whole monorepo
  - `bun run lint`
  - Run existing test suites: `packages/utils`, `packages/orchestrator`, `packages/types`
  - Manual: `bun run dev` on open-zread itself; confirm wiki.json contains glossary and Page docs use canonical terms
  - Manual: confirm audit log reports Facts coverage per doc and aggregate totals
  - Manual: introduce a deliberately thin page; confirm it regenerates once and improves
  - Manual: confirm Advanced page runs Architect then Reviewer (two agent runs, one logical page)
  - Manual: set `maxRegenRounds: 0`; confirm pipeline matches pre-change behavior
- Depends on: Task 12, Task 13, Task 14
- Notes: Suggested rollout order per Migration section: Glossary + Coverage first (zero risk), then Regen (`maxRegenRounds: 1`), then Dual-pass. Record token cost delta in PR description.
