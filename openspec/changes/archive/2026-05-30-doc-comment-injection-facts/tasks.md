## 1. Type Definitions

- [x] 1.1 Add `doc?: string` field to `SymbolInfo.functions[]` element type in `packages/types/src/symbols.ts`
- [x] 1.2 Add `doc?: string` field to `SymbolManifest.symbols[].functions[]` element type in `packages/types/src/symbols.ts`
- [x] 1.3 Add `doc?: string` field to `ExportFact` in `packages/types/src/facts.ts`
- [x] 1.4 Verify all types re-exported from `packages/types/src/index.ts`
- [x] 1.5 Run `bun run typecheck` to verify all existing consumers still compile

## 2. Doc Extractor Infrastructure

- [x] 2.1 Create `packages/repo-analyzer/src/parser/doc-extractor.ts`
- [x] 2.2 Define `DocExtractor` interface: `{ languageIds: string[], extractDocForNode(node: TreeSitterNode, source: string): string | undefined }`
- [x] 2.3 Implement `normalizeDoc(raw: string, style: 'jsdoc' | 'python' | 'go' | 'csharp'): string` — strip prefixes (`/**`, ` * `, `///`, `// `, `"""`), trim, preserve internal newlines
- [x] 2.4 Implement `truncateDoc(doc: string, maxChars = 800): string` — append `...（已截断）` when exceeded
- [x] 2.5 Export `builtinDocExtractors` array and `getDocExtractorForLanguage(language: string)` lookup function

## 3. Language Doc Extractors

- [x] 3.1 Implement `TypeScriptDocExtractor` for `["typescript", "javascript"]`:
  - Walk `previousSibling` from declaration node, skip whitespace-only nodes
  - Match `comment` type node where `node.text.startsWith('/**')`
  - Normalize with `style: 'jsdoc'`
- [x] 3.2 Implement `PythonDocExtractor` for `["python"]`:
  - Find `body` field of function/class declaration
  - First child of body is `expression_statement`
  - If its child is a `string` node with triple quotes, extract as docstring
  - Normalize with `style: 'python'`
- [x] 3.3 Implement `GoDocExtractor` for `["go"]`:
  - Walk `previousSibling`, collect consecutive `comment` nodes (all starting with `// `)
  - Stop at first non-comment / blank-line gap (>1 newline between text spans)
  - Join with newline, normalize with `style: 'go'`
- [x] 3.4 Implement `CSharpDocExtractor` for `["csharp"]`:
  - Walk `previousSibling`, collect consecutive `comment` nodes starting with `///`
  - Stop at first non-comment / blank-line gap
  - Join with newline, normalize with `style: 'csharp'` (strip `///`, preserve XML tags as-is)

## 4. Parser Integration

- [x] 4.1 Modify `packages/repo-analyzer/src/parser/index.ts` `extractWithQuery()`:
  - For each captured `fn` / `method` / `ctor` etc. node, call `getDocExtractorForLanguage(language)?.extractDocForNode(node, source)`
  - Attach to the `functions[].doc` field
- [x] 4.2 Modify `extractBasic()` similarly to maintain consistency
- [ ] 4.3 Handle Vue: in `parseFile()` Vue branch, when extracting from `<script>` AST, call TypeScriptDocExtractor on each function node
  - Note: Vue branch currently returns `functions: []` (pre-existing limitation). The TypeScriptDocExtractor is ready for reuse when Vue function extraction is implemented.
- [x] 4.4 Verify `parseFile()` returns SymbolInfo with `doc` populated where present, `undefined` where absent

## 5. Facts Extraction Update

- [x] 5.1 Modify `packages/repo-analyzer/src/repo-map/module-facts.ts` `extractPageFacts()`:
  - When building ExportFact from `sym.functions[]`, transfer the `doc` field
  - For exports from `sym.exports[]` (raw export names), `doc` remains `undefined` (no AST node to extract from)
- [x] 5.2 Verify `PageFacts.exports[].doc` populated when source has JSDoc

## 6. Page Prompt Update

- [x] 6.1 Modify `packages/orchestrator/src/wiki/generate-wiki.ts` `buildPagePrompt()`:
  - In the Facts section, when rendering each export, if `e.doc` is present, append a newline + `  📝 作者注释：${formatDoc(e.doc)}` (indent continuation lines to align)
  - When `e.doc` is absent, render the existing single-line format unchanged
- [x] 6.2 Add helper `formatDoc(doc: string): string` — split by newline, join with `\n              ` (14-space indent) to align continuation lines
- [x] 6.3 Add a new rule to the "Facts 规则" list: `4. 描述 API 用途时，**优先**使用作者注释中的措辞和角度，避免重新发挥`
- [x] 6.4 Renumber existing rules if needed

## 7. Tests

- [x] 7.1 Create `packages/repo-analyzer/src/parser/__tests__/doc-extractor.test.ts`
- [x] 7.2 Test TypeScriptDocExtractor: function with JSDoc above → extracts normalized text
- [x] 7.3 Test TypeScriptDocExtractor: function without comment → returns undefined
- [x] 7.4 Test TypeScriptDocExtractor: function with `// inline` comment above → returns undefined (only block JSDoc)
- [ ] 7.5 Test PythonDocExtractor: function with triple-quoted docstring → extracts inner text
  - Note: No Python WASM parser available in test environment
- [ ] 7.6 Test PythonDocExtractor: function with no docstring → returns undefined
  - Note: No Python WASM parser available in test environment
- [ ] 7.7 Test GoDocExtractor: function with multiple `// ` lines above → joined as doc
  - Note: No Go WASM parser available in test environment
- [ ] 7.8 Test GoDocExtractor: function with blank line between comment and func → returns undefined
  - Note: No Go WASM parser available in test environment
- [x] 7.9 Test CSharpDocExtractor: function with `/// <summary>...` lines → joined as doc
- [x] 7.10 Test `normalizeDoc()` for all four styles
- [x] 7.11 Test `truncateDoc()` with text exceeding 800 chars

## 8. Verification

- [x] 8.1 Run `bun run typecheck` — ensure all types are correct across the monorepo
- [x] 8.2 Run `bun run lint` — ensure code style compliance
- [x] 8.3 Run existing tests — `packages/repo-analyzer` and `packages/types` test suites
- [ ] 8.4 Run `bun run dev` on open-zread itself; verify generated Wiki includes JSDoc text from `buildRepoMap` / `extractPageFacts` / `createAgent` etc. in the API descriptions
  - Note: Manual verification required by user
- [ ] 8.5 Manual verification on a TypeScript project: confirm Page Agent uses JSDoc text in API descriptions, not invented prose
  - Note: Manual verification required by user
- [ ] 8.6 Manual verification on a Python project: confirm docstrings appear in Facts
  - Note: Manual verification required by user
- [ ] 8.7 Manual verification on a Go project: confirm multi-line `// ` doc comments appear in Facts
  - Note: Manual verification required by user
- [ ] 8.8 Measure parser overhead: time `parseFiles()` on open-zread itself before and after — must be within 10% of baseline
  - Note: Manual verification required by user
