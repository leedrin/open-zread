# Implementation Plan: doc-comment-injection-facts

## Source
- Proposal: openspec/changes/doc-comment-injection-facts/proposal.md
- Design: openspec/changes/doc-comment-injection-facts/design.md
- Specs: openspec/changes/doc-comment-injection-facts/specs/
- Tasks: openspec/changes/doc-comment-injection-facts/tasks.md

## Execution Order

### Task 1: Extend type definitions — SymbolInfo + ExportFact
- Goal: Add optional `doc` fields to shared types so downstream packages can carry documentation comments.
- Source tasks: Tasks 1.1–1.5
- Design anchors: D6 (per-symbol field, not file-level), D5 (800 char truncation happens later)
- Changed files:
  - `packages/types/src/symbols.ts` — add `doc?: string` to `SymbolManifest.symbols[].functions[]` element and `SymbolInfo.functions[]` element
  - `packages/types/src/facts.ts` — add `doc?: string` to `ExportFact`
- Validation: `bun run typecheck` passes across monorepo
- Depends on: none
- Notes: Fields are all optional — backward compatible, no migration.

### Task 2: Create doc-extractor infrastructure
- Goal: Build the reusable `DocExtractor` interface, `normalizeDoc()`, `truncateDoc()`, and registry lookup.
- Source tasks: Tasks 2.1–2.5
- Design anchors: D1 (AST traversal not regex), D3 (normalization), D5 (800 char limit)
- Changed files:
  - `packages/repo-analyzer/src/parser/doc-extractor.ts` (NEW)
- Validation: `bun run typecheck` passes
- Depends on: Task 1 (types must have `doc` field)
- Notes: Pure functions, no side effects. `normalizeDoc` handles `jsdoc | python | go | csharp` styles. `truncateDoc` appends `...（已截断）` beyond 800 chars.

### Task 3: Implement language-specific DocExtractors
- Goal: Provide extractors for TypeScript/JS, Python, Go, C# — covering 5 of the project's supported languages.
- Source tasks: Tasks 3.1–3.4
- Design anchors: D2 (per-language strategies table), D4 (only function/class/interface/method/ctor), D8 (Vue reuses TS extractor)
- Changed files:
  - `packages/repo-analyzer/src/parser/doc-extractor.ts` (extend Task 2 file with 4 extractor classes)
- Validation: `bun run typecheck` passes
- Depends on: Task 2
- Notes:
  - TypeScript: walk `previousSibling`, skip whitespace, match `comment` node starting with `/**`
  - Python: `body` first child → `expression_statement` → `string` with triple quotes
  - Go: collect consecutive `comment` nodes (`// ` prefix), stop at blank-line gap
  - C#: collect consecutive `comment` nodes (`///` prefix), stop at blank-line gap

### Task 4: Integrate DocExtractor into parser
- Goal: Wire doc extraction into `extractWithQuery()`, `extractBasic()`, and Vue SFC parsing so `SymbolInfo.functions[].doc` is populated.
- Source tasks: Tasks 4.1–4.4
- Design anchors: D1 (extract after SCM capture), D8 (Vue reuses TS extractor on `<script>` AST)
- Changed files:
  - `packages/repo-analyzer/src/parser/index.ts`:
    - `extractWithQuery()` (~line 130): after capturing `fn/method/ctor/prop/event/indexer/operator` nodes, call `getDocExtractorForLanguage(language)?.extractDocForNode(node, source)` and set `functions[].doc`
    - `extractBasic()` (~line 180): same logic for `function_declaration` nodes
    - `parseFile()` Vue branch (~line 220): when parsing `<script>` AST, use `TypeScriptDocExtractor` on each function node to populate `functions[].doc`
  - `packages/repo-analyzer/src/parser/vue-handler.ts`: the `parseVueSfc()` return type needs to carry `functions` with `doc` — either extend its return or do doc extraction in `parseFile()` after Vue parsing using the script tree
- Validation: `bun run typecheck` passes
- Depends on: Task 1, Task 3
- Notes: Source text is already available in `parseFile()` as the `source` variable. Must pass it to extractor. For `extractWithQuery`/`extractBasic`, source is needed but currently not passed — must thread it through from `parseFile()`.

### Task 5: Update Facts extraction — module-facts.ts
- Goal: `extractPageFacts()` copies `doc` from `SymbolInfo.functions[]` into `ExportFact.doc`.
- Source tasks: Tasks 5.1–5.2
- Design anchors: D6 (doc belongs to specific function, transparent pass-through)
- Changed files:
  - `packages/repo-analyzer/src/repo-map/module-facts.ts` (~line 16–25): when building ExportFact from `sym.functions[]`, copy `fn.doc` to `ExportFact.doc`
- Validation: `bun run typecheck` passes
- Depends on: Task 1 (ExportFact type), Task 4 (functions populated with doc)
- Notes: Raw exports from `sym.exports[]` (re-exports, type names) will have `doc: undefined` — correct by design.

### Task 6: Update Page Agent Prompt rendering
- Goal: Render `ExportFact.doc` in the Facts section; add 4th rule requiring LLM to prefer author comments.
- Source tasks: Tasks 6.1–6.4
- Design anchors: D7 (rendering format + 4th rule), spec facts-doc-enrichment
- Changed files:
  - `packages/orchestrator/src/wiki/generate-wiki.ts`:
    - `buildPagePrompt()` (~line 55–79): modify the Facts rendering loop (~line 68)
      - When `e.doc` exists: append `\n  📝 作者注释：${formatDoc(e.doc)}` after the signature line
      - When `e.doc` absent: keep existing single-line format
    - Add helper `formatDoc(doc: string): string` — splits by `\n`, joins with `\n              ` (14-space indent) for continuation lines
    - Add 4th rule to the `⚠️ Facts 规则` list (~line 73–76): `4. 描述 API 用途时，**优先**使用作者注释中的措辞和角度，避免重新发挥`
- Validation: `bun run typecheck` + `bun run lint`
- Depends on: Task 1 (ExportFact type), Task 5 (doc populated in facts)
- Notes: When Facts are empty (no SymbolManifest), the entire section is omitted — this behavior is unchanged.

### Task 7: Tests — DocExtractor unit tests
- Goal: Verify each extractor handles positive/negative/edge cases per spec scenarios.
- Source tasks: Tasks 7.1–7.11
- Design anchors: All specs in `specs/doc-comment-extraction/spec.md`
- Changed files:
  - `packages/repo-analyzer/src/parser/__tests__/doc-extractor.test.ts` (NEW)
- Validation: `bun test packages/repo-analyzer/src/parser/__tests__/doc-extractor.test.ts`
- Depends on: Task 3
- Notes: Follow existing test pattern from `signature-extraction.test.ts` — uses `bun:test`, real `web-tree-sitter` parsers loaded from `~/.zread/parsers/`. Test cases:
  - TypeScript: JSDoc → extracts; `// inline` → undefined; `/* block */` → undefined; multi-paragraph preserves `\n\n`; `@param` tags retained
  - Python: triple-quoted docstring → extracts; no docstring → undefined; non-string first stmt → undefined
  - Go: multi-line `//` → joined; blank line gap → undefined; mixed comment styles → only contiguous `//` lines
  - C#: `/// <summary>...` → extracts; `// note` → undefined
  - `normalizeDoc()` for all 4 styles
  - `truncateDoc()` > 800 chars

### Task 8: Verification — typecheck + lint + integration smoke test
- Goal: Ensure monorepo compiles, lints clean, and the feature works end-to-end.
- Source tasks: Tasks 8.1–8.8
- Design anchors: All
- Changed files: none (verification only)
- Validation:
  - `bun run typecheck` — zero errors
  - `bun run lint` — zero errors
  - `bun test` in `packages/repo-analyzer` — all existing + new tests pass
  - Manual: `bun run dev` on open-zread itself → verify generated Wiki includes JSDoc text (e.g., from `buildRepoMap`, `extractPageFacts`, `createAgent`) in API descriptions
- Depends on: Tasks 1–7
- Notes: Performance check (Task 8.8) — time `parseFiles()` before/after, must be within 10% of baseline. This is manual for now.
