## 1. Type Definitions

- [ ] 1.1 Add `ImportInfo` interface (`source`, `specifiers`, `lineNumber`) to `packages/types/src/symbols.ts`
- [ ] 1.2 Extend `SymbolInfo` with `structuredImports: ImportInfo[]` and `language: string` fields
- [ ] 1.3 Export new types from `packages/types/src/index.ts`
- [ ] 1.4 Run `bun run typecheck` to verify all existing consumers still compile

## 2. Base Extractor Infrastructure

- [ ] 2.1 Create `packages/repo-analyzer/src/parser/extractors/` directory
- [ ] 2.2 Create `types.ts` — `LanguageExtractor` interface, `ImportInfo` type re-export, `TreeSitterNode` type alias
- [ ] 2.3 Create `base-extractor.ts` — `findChild`, `findChildren`, `getStringValue`, `hasChildOfType` utilities
- [ ] 2.4 Create `index.ts` — export all extractors and register `builtinExtractors` array

## 3. Language Extractors

- [ ] 3.1 Create `typescript-extractor.ts` — handle `import_statement` with `string` source node, `import_clause` specifiers, export re-exports; `languageIds: ["typescript", "javascript"]`
- [ ] 3.2 Create `go-extractor.ts` — handle `import_declaration` → `import_spec_list` → `import_spec` children; extract `path` field with `interpreted_string_literal_content`; `languageIds: ["go"]`
- [ ] 3.3 Create `python-extractor.ts` — handle `import_statement` (dotted_name) and `import_from_statement` (module_name field + specifiers); `languageIds: ["python"]`
- [ ] 3.4 Create `csharp-extractor.ts` — handle `using_directive` with `extractUsingSource` (identifier, qualified_name, aliased forms); `languageIds: ["csharp"]`

## 4. Parser Integration

- [ ] 4.1 Modify `packages/repo-analyzer/src/parser/index.ts` — import `builtinExtractors`, create extractor map keyed by language
- [ ] 4.2 In `parseFile()` — after tree-sitter parsing, look up the extractor for the file's language; call `extractStructure(rootNode)` to get structured imports
- [ ] 4.3 Populate both `symbol.imports` (raw text, existing SCM query) and `symbol.structuredImports` (from extractor) and `symbol.language`
- [ ] 4.4 Verify existing tests in `packages/repo-analyzer/src/parser/__tests__/` still pass

## 5. Resolver Infrastructure

- [ ] 5.1 Create `packages/utils/src/cache/resolvers/` directory
- [ ] 5.2 Create `context.ts` — `ResolutionContext` interface, `buildResolutionContext(projectRoot, files)` function; include `fileSet`, `loadTsConfigs`, `loadGoModules`, `goFilesByDir` builder, `buildSuffixIndex` for `.cs` files
- [ ] 5.3 Create `dispatch.ts` — `resolveImport(importInfo, file, ctx)` function routing by `file.language`

## 6. Language Resolvers

- [ ] 6.1 Create `ts-resolver.ts` — `resolveTsJsImport(source, file, ctx)`: relative path resolution + `probeWithExtensions` (10 candidates) + tsconfig paths alias matching (`matchTsAlias`, `applyTsAlias`) + `findNearestConfigDir` for nearest tsconfig lookup
- [ ] 6.2 Create `go-resolver.ts` — `resolveGoImport(source, file, ctx)`: find nearest go.mod via `findNearestConfigDir`, strip module prefix, map remainder to directory, return all `.go` files in that directory
- [ ] 6.3 Create `python-resolver.ts` — `resolvePythonImport(source, specifiers, file, ctx)`: count leading dots for relative imports, `resolvePythonProbe` (`.py` then `__init__.py`), absolute import walk-up from importer directory
- [ ] 6.4 Create `csharp-resolver.ts` — `resolveCSharpImport(source, file, ctx)`: delegate to `resolveDottedFqn(source, '.cs', ctx.csSuffixIndex)`, convert dots to slashes, append `.cs`, lookup in suffix index

## 7. DependencyGraph Integration

- [ ] 7.1 Modify `packages/utils/src/cache/dependency-graph.ts` — import resolver infrastructure, build `ResolutionContext` from `SymbolManifest`
- [ ] 7.2 In `buildDependencyGraph()` — for each symbol, iterate `structuredImports`; dispatch each through `resolveImport()`; collect resolved paths into `forward`, `reverse`, `edges`
- [ ] 7.3 Add fallback: if `structuredImports` is empty but `imports` has entries, use existing regex extraction for backward compatibility
- [ ] 7.4 Update `computeTransitiveImpact()` if needed (should work unchanged since it operates on the `DependencyGraph` output)

## 8. Downstream Consumer Updates

- [ ] 8.1 Update `packages/repo-analyzer/src/repo-map/reference-counter.ts` — prefer `structuredImports` for reference counting when available
- [ ] 8.2 Update `packages/repo-analyzer/src/repo-map/module-facts.ts` — prefer `structuredImports` for external/internal dep classification
- [ ] 8.3 Update `packages/utils/src/cache/incremental-pipeline.ts` — ensure it works with new `DependencyGraph` output format

## 9. Verification

- [ ] 9.1 Run `bun run typecheck` — ensure all types are correct across the monorepo
- [ ] 9.2 Run `bun run lint` — ensure code style compliance
- [ ] 9.3 Run existing tests — `packages/repo-analyzer` and `packages/utils` test suites
- [ ] 9.4 Manual verification: run open-zread on a TypeScript project and confirm relationship graph still works
- [ ] 9.5 Manual verification: run open-zread on a Go project and confirm relationship graph has edges
- [ ] 9.6 Manual verification: run open-zread on a Python project and confirm relationship graph has edges
- [ ] 9.7 Manual verification: run open-zread on a C# project and confirm relationship graph has edges (no more isolated nodes)
