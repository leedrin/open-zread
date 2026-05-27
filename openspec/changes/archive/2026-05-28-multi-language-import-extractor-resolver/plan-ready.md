# Implementation Plan: multi-language-import-extractor-resolver

## Source
- Proposal: openspec/changes/multi-language-import-extractor-resolver/proposal.md
- Design: openspec/changes/multi-language-import-extractor-resolver/design.md
- Specs: openspec/changes/multi-language-import-extractor-resolver/specs/
- Tasks: openspec/changes/multi-language-import-extractor-resolver/tasks.md

## Execution Order

### Task 1: Add ImportInfo type and extend SymbolInfo
- Goal: New `ImportInfo` interface and extended `SymbolInfo` with `structuredImports` + `language` fields, all consumers compile without changes.
- Source tasks: 1.1, 1.2, 1.3, 1.4
- Design anchors: D5 (SymbolInfo 类型扩展策略 — 新增字段，保留 imports: string[])
- Changed files:
  - `packages/types/src/symbols.ts` — add `ImportInfo` interface; extend `SymbolInfo` with `structuredImports?: ImportInfo[]` and `language?: string` (both optional for backward compat); extend inner type in `SymbolManifest.symbols` array similarly
  - `packages/types/src/index.ts` — add `ImportInfo` to exports
- Validation: `bun run typecheck` passes (new fields are optional so existing code compiles)
- Depends on: none
- Notes: Fields MUST be optional (`?`) to avoid breaking every consumer that constructs `SymbolInfo` objects. The design says "保持 imports: string[] 向后兼容" — do NOT remove or rename the existing `imports` field.

### Task 2: Create Extractor interface and base utilities
- Goal: `LanguageExtractor` interface and shared AST traversal utilities ready for 4 language implementations.
- Source tasks: 2.1, 2.2, 2.3
- Design anchors: D1 (Extractor 模式)
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/types.ts` — `LanguageExtractor` interface with `languageIds: string[]` and `extractStructure(rootNode: TreeSitterNode): { imports: ImportInfo[] }`; `TreeSitterNode` type alias (`any` for now, matching existing parser usage)
  - `packages/repo-analyzer/src/parser/extractors/base-extractor.ts` — `findChild(node, type)`, `findChildren(node, type)`, `getStringValue(node)` (strip quotes from string literal), `hasChildOfType(node, type)`
- Validation: `bun run typecheck` passes; files import cleanly
- Depends on: Task 1 (needs `ImportInfo` type)
- Notes: Follow the exact patterns from Understand-Anything's `base-extractor.ts`. `getStringValue` strips surrounding quotes from `string` AST nodes. `TreeSitterNode` can be typed as `any` initially since web-tree-sitter types are not fully exported.

### Task 3: Implement TypeScriptExtractor
- Goal: AST-based import extraction for TS/JS producing `ImportInfo[]`.
- Source tasks: 3.1
- Design anchors: D1, D6 (Vue uses TS extractor)
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/typescript-extractor.ts` — `TypeScriptExtractor implements LanguageExtractor`; `languageIds: ["typescript", "javascript"]`; handle `import_statement` → find `string` child → `getStringValue()` for source; handle `import_clause` → extract specifiers from `named_imports`/`namespace_import`/`identifier`; handle `export_statement` wrapping `import_statement` for re-exports
- Validation: `bun run typecheck` passes
- Depends on: Task 2
- Notes: Use `childForFieldName()` and `children.find()` to navigate AST. Do NOT use regex. The SCM query `(import_statement) @import` captures the whole node — the extractor walks that node's children to extract structured data instead of using `node.text`.

### Task 4: Implement GoExtractor
- Goal: AST-based import extraction for Go, handling both single and grouped imports.
- Source tasks: 3.2
- Design anchors: D1, D3 (Go — 模块系统)
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/go-extractor.ts` — `GoExtractor implements LanguageExtractor`; `languageIds: ["go"]`; walk top-level children for `import_declaration`; if has `import_spec_list` child → iterate `import_spec` children; else → single `import_spec`; extract `path` field → `interpreted_string_literal_content` child for unquoted path; specifier = alias name or last path component
- Validation: `bun run typecheck` passes
- Depends on: Task 2
- Notes: Go's grouped `import ( ... )` is naturally split into multiple `import_spec` children in the AST. No regex needed for splitting. Reference Understand-Anything's `go-extractor.ts` `extractImportSpec()` pattern.

### Task 5: Implement PythonExtractor
- Goal: AST-based import extraction for Python, handling `import X` and `from X import Y` forms.
- Source tasks: 3.3
- Design anchors: D1, D3 (Python — 探测型)
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/python-extractor.ts` — `PythonExtractor implements LanguageExtractor`; `languageIds: ["python"]`; handle `import_statement` → find `dotted_name` children; handle `import_from_statement` → `module_name` field as source, remaining `dotted_name`/`aliased_import`/`wildcard_import` as specifiers; preserve leading dots in source for relative imports (e.g., `..utils.parser`)
- Validation: `bun run typecheck` passes
- Depends on: Task 2
- Notes: Leading dots in the source string are critical — the Python resolver counts them to determine relative levels. Do NOT strip leading dots.

### Task 6: Implement CSharpExtractor
- Goal: AST-based import extraction for C#, handling all `using` directive forms.
- Source tasks: 3.4
- Design anchors: D1, D3 (C# — 索引型)
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/csharp-extractor.ts` — `CSharpExtractor implements LanguageExtractor`; `languageIds: ["csharp"]`; handle `using_directive` nodes; `extractUsingSource()` handles 3 forms: `using System;` (identifier), `using System.Collections.Generic;` (qualified_name), `using X = Some.Namespace;` (aliased — extract target after `=`); specifier = last dotted component; walk into `namespace_declaration` bodies to find nested classes
- Validation: `bun run typecheck` passes
- Depends on: Task 2
- Notes: Reference Understand-Anything's `csharp-extractor.ts` for `extractUsingSource()` and `hasModifier()` patterns.

### Task 7: Create extractor index and register all extractors
- Goal: Single entry point that exports all extractors and provides a lookup-by-language map.
- Source tasks: 2.4
- Design anchors: D1
- Changed files:
  - `packages/repo-analyzer/src/parser/extractors/index.ts` — export all extractor classes; export `getExtractorForLanguage(language: string): LanguageExtractor | null`; create `builtinExtractors` array; build internal `Map<string, LanguageExtractor>` from `languageIds`
- Validation: `bun run typecheck` passes
- Depends on: Tasks 3, 4, 5, 6
- Notes: The map maps each `languageId` to its extractor instance. One extractor can handle multiple languages (e.g., TypeScriptExtractor handles both `"typescript"` and `"javascript"`).

### Task 8: Integrate extractors into parser
- Goal: `parseFile()` populates both `imports` (existing) and `structuredImports` (new) + `language` on every `SymbolInfo`.
- Source tasks: 4.1, 4.2, 4.3, 4.4
- Design anchors: D5 (populate both fields), D6 (Vue uses TS extractor)
- Changed files:
  - `packages/repo-analyzer/src/parser/index.ts` — import `getExtractorForLanguage`; after tree-sitter parse, if extractor exists for the file's language, call `extractor.extractStructure(rootNode)` and assign to `symbol.structuredImports`; set `symbol.language`; keep existing SCM query logic for `symbol.imports` unchanged
- Validation: `bun run typecheck` passes; existing tests in `packages/repo-analyzer/src/parser/__tests__/` still pass
- Depends on: Tasks 1, 7
- Notes: The existing SCM query `(import_statement) @import` + `node.text` path stays in place. The extractor is an ADDITIONAL path that fills `structuredImports`. Both are populated. Vue files: the `vue-handler.ts` produces a sub-tree for the `<script>` block — pass that sub-tree to TypeScriptExtractor.

### Task 9: Create ResolutionContext and shared config loaders
- Goal: `buildResolutionContext()` constructs all pre-computed indices from the file manifest.
- Source tasks: 5.1, 5.2
- Design anchors: D4 (ResolutionContext 一次构建), D3 (四种策略的上下文需求)
- Changed files:
  - `packages/utils/src/cache/resolvers/context.ts` — `ResolutionContext` interface with `fileSet`, `tsConfigs`, `goModules`, `goFilesByDir`, `csSuffixIndex`; `buildResolutionContext(projectRoot: string, files: Array<{path: string}>)` function; `loadTsConfigs()` — find all tsconfig.json, parse JSONC (strip comments), extract `compilerOptions.baseUrl` + `compilerOptions.paths`; `loadGoModules()` — find all go.mod, extract `module` line; `buildSuffixIndex()` — for .cs files, index every path suffix; `goFilesByDir` — group .go files by parent directory; `findNearestConfigDir()` — walk up from importer dir to find deepest matching config; `toPosix()`, `dirOf()`, `resolveRelative()` utility functions
- Validation: `bun run typecheck` passes
- Depends on: Task 1 (needs type awareness for file manifest shape)
- Notes: This is the largest single file (~150 lines). tsconfig parsing needs JSONC support (strip `//` and `/* */` comments before JSON.parse). go.mod parsing is line-by-line extraction of `module <name>`. Follow Understand-Anything's `extract-import-map.mjs` patterns exactly.

### Task 10: Implement TS/JS Resolver
- Goal: Resolve TS/JS import paths including tsconfig aliases and multi-extension probing.
- Source tasks: 6.1
- Design anchors: D3 (TS — 配置驱动)
- Changed files:
  - `packages/utils/src/cache/resolvers/ts-resolver.ts` — `resolveTsJsImport(source, filePath, ctx): string | null`; relative path resolution (`./`, `../` → `resolveRelative` → `probeWithExtensions`); tsconfig alias matching (`matchTsAlias` with `*` wildcard, `applyTsAlias`); `probeWithExtensions` tries: exact match, then `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`; bare specifiers return `null`
- Validation: `bun run typecheck` passes
- Depends on: Task 9 (needs ResolutionContext)
- Notes: The extension probe list has 10 candidates. `findNearestConfigDir` walks up from importer to find nearest tsconfig. Alias `@/*` → target `src/*` → `@/utils/helper` resolves to `src/utils/helper` then probes extensions.

### Task 11: Implement Go Resolver
- Goal: Resolve Go import paths by stripping go.mod module prefix and mapping to directory.
- Source tasks: 6.2
- Design anchors: D3 (Go — 模块系统)
- Changed files:
  - `packages/utils/src/cache/resolvers/go-resolver.ts` — `resolveGoImport(source, filePath, ctx): string[]`; find nearest go.mod via `findNearestConfigDir`; get module name; strip module prefix from import path; map remainder to directory under module dir; return ALL .go files in that directory from `ctx.goFilesByDir`; cross-module and stdlib imports return `[]`
- Validation: `bun run typecheck` passes
- Depends on: Task 9
- Notes: Go imports are package-level. A single `import "github.com/foo/bar/util"` produces edges to EVERY .go file in the `util/` directory. Cross-module imports (different go.mod) are external → return `[]`.

### Task 12: Implement Python Resolver
- Goal: Resolve Python imports including relative (leading dots) and absolute forms.
- Source tasks: 6.3
- Design anchors: D3 (Python — 探测型)
- Changed files:
  - `packages/utils/src/cache/resolvers/python-resolver.ts` — `resolvePythonImport(source, specifiers, filePath, ctx): string[]`; count leading dots → calculate walk-up levels; `resolvePythonProbe` checks `.py` then `/__init__.py`; on package match, probe each specifier as submodule; absolute imports walk up from importer dir trying each ancestor as root; return multiple files for `from pkg import a, b` (package init + each submodule)
- Validation: `bun run typecheck` passes
- Depends on: Task 9
- Notes: This is the only resolver that can return multiple files per import. `from . import x` (1 dot, 0 walk-up) probes siblings at the same level. `from .. import x` (2 dots, 1 walk-up) goes up one level. `resolvePythonProbe` checks `path.py` first, then `path/__init__.py`.

### Task 13: Implement CSharp Resolver
- Goal: Resolve C# namespace references to file paths via suffix index.
- Source tasks: 6.4
- Design anchors: D3 (C# — 索引型)
- Changed files:
  - `packages/utils/src/cache/resolvers/csharp-resolver.ts` — `resolveCSharpImport(source, filePath, ctx): string[]`; strip trailing `.*`; replace `.` with `/`; append `.cs`; lookup in `ctx.csSuffixIndex`; external namespaces (no match) return `[]`; shared `resolveDottedFqn(fqn, ext, suffixIndex)` function for potential future Java/Kotlin reuse
- Validation: `bun run typecheck` passes
- Depends on: Task 9
- Notes: Very simple resolver — the complexity is in the suffix index (built in context.ts). `System.Collections.Generic` → `System/Collections/Generic.cs` → lookup → no match → `[]`. `MyApp.Services` → `MyApp/Services.cs` → lookup → match if file exists.

### Task 14: Create resolver dispatch
- Goal: Single `resolveImport()` function that routes to the correct resolver by language.
- Source tasks: 5.3
- Design anchors: D2 (Resolver 层独立), D3
- Changed files:
  - `packages/utils/src/cache/resolvers/dispatch.ts` — `resolveImport(importInfo: ImportInfo, filePath: string, language: string, ctx: ResolutionContext): string[]`; route: `typescript|javascript|tsx|jsx|vue` → `resolveTsJsImport` (wrap single result in array); `go` → `resolveGoImport`; `python` → `resolvePythonImport` (pass specifiers); `csharp` → `resolveCSharpImport`; unknown → `[]`
  - `packages/utils/src/cache/resolvers/index.ts` — export `resolveImport`, `buildResolutionContext`, `ResolutionContext`
- Validation: `bun run typecheck` passes
- Depends on: Tasks 10, 11, 12, 13
- Notes: Python resolver gets `importInfo.specifiers` because `from pkg import a, b` can resolve to multiple files. All other resolvers get just `importInfo.source`.

### Task 15: Integrate resolvers into buildDependencyGraph
- Goal: `buildDependencyGraph()` uses resolvers instead of regex for all languages, with fallback to existing regex.
- Source tasks: 7.1, 7.2, 7.3, 7.4
- Design anchors: D2, D4
- Changed files:
  - `packages/utils/src/cache/dependency-graph.ts` — import `buildResolutionContext`, `resolveImport` from resolvers; at start of `buildDependencyGraph`, build context from symbols; for each symbol: if `structuredImports` is non-empty, iterate and dispatch through `resolveImport()`; else fallback to existing `extractImportPath` + `resolveImportPath` regex for backward compat; collect resolved paths into `forward`, `reverse`, `edges` as before
- Validation: `bun run typecheck` passes; existing tests pass
- Depends on: Tasks 8, 14
- Notes: The fallback is critical — if a symbol has no `structuredImports` (e.g., from a cache built before this change), the existing regex path still works. The `DependencyGraph` output shape does NOT change — `forward`, `reverse`, `edges` remain the same.

### Task 16: Update downstream consumers to prefer structuredImports
- Goal: `reference-counter` and `module-facts` use `structuredImports` when available for better accuracy.
- Source tasks: 8.1, 8.2, 8.3
- Design anchors: D5 (逐步迁移)
- Changed files:
  - `packages/repo-analyzer/src/repo-map/reference-counter.ts` — when counting refs, prefer `structuredImports[].source` over regex-matching `imports[]`; if `structuredImports` is empty, fall back to existing logic
  - `packages/repo-analyzer/src/repo-map/module-facts.ts` — when classifying external/internal deps, prefer `structuredImports` over `imports`
  - `packages/utils/src/cache/incremental-pipeline.ts` — verify it works with new `DependencyGraph` output (shape unchanged, but verify no breakage)
- Validation: `bun run typecheck` passes; `bun run lint` passes
- Depends on: Task 15
- Notes: This is a "soft migration" — prefer new data, fall back to old. No breaking changes. `incremental-pipeline.ts` should need no changes since `DependencyGraph` shape is unchanged.

### Task 17: Full verification
- Goal: All code quality checks pass; manual verification on real projects.
- Source tasks: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
- Design anchors: all
- Changed files: none (verification only)
- Validation:
  - `bun run typecheck` — zero errors
  - `bun run lint` — zero errors (or `bun run lint:fix` to auto-fix)
  - Existing test suites pass
  - Manual: run on TS project → graph has edges (regression check)
  - Manual: run on Go project → graph has edges (new capability)
  - Manual: run on Python project → graph has edges (new capability)
  - Manual: run on C# project → graph has edges, no more isolated nodes (new capability)
- Depends on: Task 16
- Notes: Manual verification requires the user to run `bun run dev` and test against real projects. The automated checks (typecheck, lint, tests) should all pass before manual testing.
