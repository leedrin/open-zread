# Multi-Language Import Extractor & Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace regex-based import extraction with AST-based Extractors and language-specific Resolvers so that Go, Python, and C# projects produce dependency graphs with real edges instead of isolated nodes.

**Architecture:** Two-layer design — Extractors (AST → structured `{ source, specifiers }`) in repo-analyzer, Resolvers (source string → file paths) in utils. The existing `DependencyGraph` output shape is unchanged; only the input path changes.

**Tech Stack:** web-tree-sitter (AST), TypeScript, Bun test framework

**Handoff:** `openspec/changes/multi-language-import-extractor-resolver/plan-ready.md`

---

## File Structure

```
packages/types/src/symbols.ts                          — MODIFY: add ImportInfo, extend SymbolInfo
packages/types/src/index.ts                            — MODIFY: export ImportInfo

packages/repo-analyzer/src/parser/extractors/          — NEW DIRECTORY
  types.ts                                             — LanguageExtractor interface
  base-extractor.ts                                    — shared AST utilities
  typescript-extractor.ts                              — TS/JS import extraction
  go-extractor.ts                                      — Go import extraction
  python-extractor.ts                                  — Python import extraction
  csharp-extractor.ts                                  — C# using extraction
  index.ts                                             — registry + lookup

packages/repo-analyzer/src/parser/index.ts             — MODIFY: integrate extractors

packages/utils/src/cache/resolvers/                    — NEW DIRECTORY
  context.ts                                           — ResolutionContext builder
  ts-resolver.ts                                       — TS/JS path resolution
  go-resolver.ts                                       — Go path resolution
  python-resolver.ts                                   — Python path resolution
  csharp-resolver.ts                                   — C# path resolution
  dispatch.ts                                          — resolveImport router
  index.ts                                             — barrel export

packages/utils/src/cache/dependency-graph.ts           — MODIFY: use resolvers

packages/repo-analyzer/src/repo-map/reference-counter.ts — MODIFY: prefer structuredImports
```

---

### Task 1: Add ImportInfo type and extend SymbolInfo

**Files:**
- Modify: `packages/types/src/symbols.ts`
- Modify: `packages/types/src/index.ts`

- [x] **Step 1: Add ImportInfo interface and extend SymbolInfo in symbols.ts**

Replace the entire content of `packages/types/src/symbols.ts` with:

```typescript
/**
 * Symbol Manifest Types
 *
 * Parser output - extracted symbols from source files
 */

/**
 * Structured import information extracted from AST.
 * Language-specific extractors produce this instead of raw text.
 */
export interface ImportInfo {
  source: string;
  specifiers: string[];
  lineNumber?: number;
}

/**
 * SymbolManifest - Parser output
 */
export interface SymbolManifest {
  symbols: Array<{
    file: string;
    exports: string[];
    functions: Array<{ name: string; signature: string }>;
    imports: string[];
    docstrings: string[];
    structuredImports?: ImportInfo[];
    language?: string;
  }>;
  loadedParsers: string[];
}

/**
 * SymbolInfo - Single file symbols
 */
export interface SymbolInfo {
  file: string;
  exports: string[];
  functions: Array<{ name: string; signature: string }>;
  imports: string[];
  docstrings: string[];
  structuredImports?: ImportInfo[];
  language?: string;
}
```

- [x] **Step 2: Export ImportInfo from index.ts**

Add to `packages/types/src/index.ts` after line 19 (`export type { SymbolManifest, SymbolInfo }`):

```typescript
export type { ImportInfo } from './symbols.js'
```

Specifically, change line 19 from:
```
export type { SymbolManifest, SymbolInfo } from './symbols.js'
```
to:
```
export type { SymbolManifest, SymbolInfo, ImportInfo } from './symbols.js'
```

- [x] **Step 3: Run typecheck to verify backward compatibility**

Run: `bun run typecheck`
Expected: PASS (new fields are optional, no breaking changes)

---

### Task 2: Create Extractor interface and base utilities

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/types.ts`
- Create: `packages/repo-analyzer/src/parser/extractors/base-extractor.ts`

- [x] **Step 1: Create extractors directory**

Run: `mkdir -p packages/repo-analyzer/src/parser/extractors`

- [x] **Step 2: Create types.ts with LanguageExtractor interface**

Write `packages/repo-analyzer/src/parser/extractors/types.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';

export type TreeSitterNode = {
  type: string;
  text: string;
  id: number;
  childCount: number;
  children: TreeSitterNode[];
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
};

export interface ExtractionResult {
  imports: ImportInfo[];
}

export interface LanguageExtractor {
  readonly languageIds: string[];
  extractStructure(rootNode: TreeSitterNode): ExtractionResult;
}
```

- [x] **Step 3: Create base-extractor.ts with shared utilities**

Write `packages/repo-analyzer/src/parser/extractors/base-extractor.ts`:

```typescript
import type { TreeSitterNode } from './types.js';

export function findChild(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

export function findChildren(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

export function getStringValue(node: TreeSitterNode): string {
  let text = node.text;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text;
}

export function hasChildOfType(node: TreeSitterNode, type: string): boolean {
  return findChild(node, type) !== null;
}
```

- [x] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 3: Implement TypeScriptExtractor

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/typescript-extractor.ts`

- [x] **Step 1: Create TypeScriptExtractor**

Write `packages/repo-analyzer/src/parser/extractors/typescript-extractor.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild, findChildren, getStringValue } from './base-extractor.js';

function extractImportSpecifiers(importClause: TreeSitterNode): string[] {
  const specifiers: string[] = [];
  for (let i = 0; i < importClause.childCount; i++) {
    const child = importClause.child(i);
    if (!child) continue;
    if (child.type === 'named_imports') {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j);
        if (spec && spec.type === 'import_specifier') {
          const alias = spec.childForFieldName('alias');
          const name = spec.childForFieldName('name');
          specifiers.push(alias ? alias.text : name ? name.text : spec.text);
        }
      }
    } else if (child.type === 'namespace_import') {
      const ident = child.children.find((c) => c.type === 'identifier');
      if (ident) specifiers.push('* as ' + ident.text);
    } else if (child.type === 'identifier') {
      specifiers.push(child.text);
    }
  }
  return specifiers;
}

function extractImport(node: TreeSitterNode): ImportInfo | null {
  const sourceNode = node.children.find((c) => c.type === 'string');
  if (!sourceNode) return null;
  const source = getStringValue(sourceNode);
  const specifiers: string[] = [];
  const importClause = node.children.find((c) => c.type === 'import_clause');
  if (importClause) {
    specifiers.push(...extractImportSpecifiers(importClause));
  }
  return { source, specifiers, lineNumber: node.startPosition.row + 1 };
}

export class TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ['typescript', 'javascript'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_statement') {
        const imp = extractImport(node);
        if (imp) imports.push(imp);
      } else if (node.type === 'export_statement') {
        for (let j = 0; j < node.childCount; j++) {
          const child = node.child(j);
          if (child && child.type === 'import_statement') {
            const imp = extractImport(child);
            if (imp) imports.push(imp);
          }
        }
      }
    }
    return { imports };
  }
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 4: Implement GoExtractor

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/go-extractor.ts`

- [x] **Step 1: Create GoExtractor**

Write `packages/repo-analyzer/src/parser/extractors/go-extractor.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild, findChildren } from './base-extractor.js';

export class GoExtractor implements LanguageExtractor {
  readonly languageIds = ['go'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_declaration') {
        const specList = findChild(node, 'import_spec_list');
        if (specList) {
          const specs = findChildren(specList, 'import_spec');
          for (const spec of specs) {
            const imp = this.extractImportSpec(spec);
            if (imp) imports.push(imp);
          }
        } else {
          const spec = findChild(node, 'import_spec');
          if (spec) {
            const imp = this.extractImportSpec(spec);
            if (imp) imports.push(imp);
          }
        }
      }
    }
    return { imports };
  }

  private extractImportSpec(spec: TreeSitterNode): ImportInfo | null {
    const pathNode = spec.childForFieldName('path');
    if (!pathNode) return null;
    const pathContent = findChild(pathNode, 'interpreted_string_literal_content');
    const source = pathContent ? pathContent.text : pathNode.text.replace(/^"|"$/g, '');
    const nameNode = spec.childForFieldName('name');
    let specifier: string;
    if (nameNode) {
      specifier = nameNode.text;
    } else {
      const parts = source.split('/');
      specifier = parts[parts.length - 1];
    }
    return { source, specifiers: [specifier], lineNumber: spec.startPosition.row + 1 };
  }
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 5: Implement PythonExtractor

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/python-extractor.ts`

- [x] **Step 1: Create PythonExtractor**

Write `packages/repo-analyzer/src/parser/extractors/python-extractor.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild, findChildren } from './base-extractor.js';

export class PythonExtractor implements LanguageExtractor {
  readonly languageIds = ['python'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_statement') {
        this.extractImport(node, imports);
      } else if (node.type === 'import_from_statement') {
        this.extractFromImport(node, imports);
      }
    }
    return { imports };
  }

  private extractImport(node: TreeSitterNode, imports: ImportInfo[]): void {
    const dottedNames = findChildren(node, 'dotted_name');
    const aliasedImports = findChildren(node, 'aliased_import');
    for (const dn of dottedNames) {
      imports.push({
        source: dn.text,
        specifiers: [dn.text],
        lineNumber: node.startPosition.row + 1,
      });
    }
    for (const ai of aliasedImports) {
      const dottedName = findChild(ai, 'dotted_name');
      const alias = ai.children.find((c) => c.type === 'identifier');
      if (dottedName) {
        imports.push({
          source: dottedName.text,
          specifiers: [alias ? alias.text : dottedName.text],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }
  }

  private extractFromImport(node: TreeSitterNode, imports: ImportInfo[]): void {
    const moduleNode = node.childForFieldName('module_name');
    const source = moduleNode ? moduleNode.text : '';
    const moduleNodeId = moduleNode?.id;
    const specifiers: string[] = [];
    const allDottedNames = findChildren(node, 'dotted_name');
    for (const dn of allDottedNames) {
      if (dn.id === moduleNodeId) continue;
      specifiers.push(dn.text);
    }
    const aliasedImports = findChildren(node, 'aliased_import');
    for (const ai of aliasedImports) {
      const alias = ai.children.find((c) => c.type === 'identifier');
      if (alias) specifiers.push(alias.text);
    }
    if (findChild(node, 'wildcard_import')) {
      specifiers.push('*');
    }
    imports.push({
      source,
      specifiers,
      lineNumber: node.startPosition.row + 1,
    });
  }
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 6: Implement CSharpExtractor

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/csharp-extractor.ts`

- [x] **Step 1: Create CSharpExtractor**

Write `packages/repo-analyzer/src/parser/extractors/csharp-extractor.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild } from './base-extractor.js';

function extractUsingSource(node: TreeSitterNode): string | null {
  if (findChild(node, '=')) {
    const qualifiedName = findChild(node, 'qualified_name');
    return qualifiedName ? qualifiedName.text : null;
  }
  const qualifiedName = findChild(node, 'qualified_name');
  if (qualifiedName) return qualifiedName.text;
  const identifier = findChild(node, 'identifier');
  return identifier ? identifier.text : null;
}

function lastComponent(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

export class CSharpExtractor implements LanguageExtractor {
  readonly languageIds = ['csharp'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    this.walkTopLevel(rootNode, imports);
    return { imports };
  }

  private walkTopLevel(node: TreeSitterNode, imports: ImportInfo[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (child.type === 'using_directive') {
        const source = extractUsingSource(child);
        if (source) {
          imports.push({
            source,
            specifiers: [lastComponent(source)],
            lineNumber: child.startPosition.row + 1,
          });
        }
      } else if (child.type === 'namespace_declaration') {
        const body = child.childForFieldName('body');
        if (body) this.walkTopLevel(body, imports);
      }
    }
  }
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 7: Create extractor index and registry

**Files:**
- Create: `packages/repo-analyzer/src/parser/extractors/index.ts`

- [x] **Step 1: Create barrel export with language lookup**

Write `packages/repo-analyzer/src/parser/extractors/index.ts`:

```typescript
import type { LanguageExtractor, TreeSitterNode } from './types.js';
import { TypeScriptExtractor } from './typescript-extractor.js';
import { GoExtractor } from './go-extractor.js';
import { PythonExtractor } from './python-extractor.js';
import { CSharpExtractor } from './csharp-extractor.js';

export type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
export { findChild, findChildren, getStringValue, hasChildOfType } from './base-extractor.js';
export { TypeScriptExtractor } from './typescript-extractor.js';
export { GoExtractor } from './go-extractor.js';
export { PythonExtractor } from './python-extractor.js';
export { CSharpExtractor } from './csharp-extractor.js';

const builtinExtractors: LanguageExtractor[] = [
  new TypeScriptExtractor(),
  new GoExtractor(),
  new PythonExtractor(),
  new CSharpExtractor(),
];

const extractorMap = new Map<string, LanguageExtractor>();
for (const extractor of builtinExtractors) {
  for (const langId of extractor.languageIds) {
    extractorMap.set(langId, extractor);
  }
}

export function getExtractorForLanguage(language: string): LanguageExtractor | null {
  return extractorMap.get(language) ?? null;
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 8: Integrate extractors into parser

**Files:**
- Modify: `packages/repo-analyzer/src/parser/index.ts`

- [x] **Step 1: Add extractor import and integrate into parseFile**

In `packages/repo-analyzer/src/parser/index.ts`, add import after line 7:

```typescript
import { getExtractorForLanguage } from './extractors/index.js';
```

Then modify the `parseFile` function. After line 233 (`const { imports, exports, functions } = extractWithQuery(tree, language, parser);`), add the extractor call. Change the return block (lines 237-244) to:

```typescript
  const { imports, exports, functions } = extractWithQuery(tree, language, parser);

  const extractor = getExtractorForLanguage(language);
  const structuredImports = extractor
    ? extractor.extractStructure(tree.rootNode as any).imports
    : undefined;

  tree.delete();

  return {
    file: filePath,
    exports,
    functions,
    imports,
    docstrings: [],
    ...(structuredImports && structuredImports.length > 0 ? { structuredImports } : {}),
    language,
  };
```

Also update the Vue branch (around line 223-229) to include `language`:

```typescript
  if (language === 'vue') {
    const vueParser = parser;
    const tsParser = parsers.get('typescript') || parsers.get('tsx');
    const vueResult = await parseVueSfc(source, vueParser, tsParser);
    const tsExtractor = getExtractorForLanguage('typescript');
    let structuredImports = undefined;
    if (tsExtractor) {
      const scriptInfo = extractVueScript(source);
      if (scriptInfo) {
        const scriptParser = tsParser || vueParser;
        const scriptTree = scriptParser.parse(scriptInfo.scriptContent);
        structuredImports = tsExtractor.extractStructure(scriptTree.rootNode as any).imports;
        if (structuredImports.length === 0) structuredImports = undefined;
        scriptTree.delete();
      }
    }
    return {
      file: filePath,
      exports: vueResult.exports,
      functions: [],
      imports: vueResult.imports,
      docstrings: [],
      ...(structuredImports ? { structuredImports } : {}),
      language,
    };
  }
```

Note: the `extractVueScript` function is already exported from `vue-handler.ts`.

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [x] **Step 3: Run existing parser tests**

Run: `bun test packages/repo-analyzer/src/parser/__tests__/`
Expected: All existing tests PASS (the new fields are optional and don't affect existing behavior)

---

### Task 9: Create ResolutionContext and config loaders

**Files:**
- Create: `packages/utils/src/cache/resolvers/context.ts`

- [x] **Step 1: Create resolvers directory**

Run: `mkdir -p packages/utils/src/cache/resolvers`

- [x] **Step 2: Create context.ts with all config loaders**

Write `packages/utils/src/cache/resolvers/context.ts`:

```typescript
import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';

function toPosix(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).join('/');
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function resolveRelative(dir: string, rel: string): string {
  const parts = (dir ? dir.split('/').filter(Boolean) : []).concat(
    rel.split('/').filter(Boolean),
  );
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return '';
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function findNearestConfigDir(startDir: string, configMap: Map<string, unknown>): string | undefined {
  if (configMap.size === 0) return undefined;
  const parts = startDir ? startDir.split('/').filter(Boolean) : [];
  for (let i = parts.length; i >= 0; i--) {
    const ancestor = parts.slice(0, i).join('/');
    if (configMap.has(ancestor)) return ancestor;
  }
  return undefined;
}

interface TsConfig {
  baseUrl: string;
  paths: Map<string, string[]>;
}

function parseTsConfigText(raw: string): TsConfig | null {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let parsed: any;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const compilerOptions = parsed?.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl ?? '.';
  const paths = new Map<string, string[]>();
  if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
    for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
      if (Array.isArray(targets)) {
        paths.set(alias, targets);
      }
    }
  }
  return { baseUrl, paths };
}

function loadTsConfigs(projectRoot: string, filePaths: string[]): Map<string, TsConfig> {
  const out = new Map<string, TsConfig>();
  for (const p of filePaths) {
    const posix = toPosix(p);
    const base = posix.includes('/') ? posix.slice(posix.lastIndexOf('/') + 1) : posix;
    if (base !== 'tsconfig.json') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    try {
      const raw = readFileSync(absPath, 'utf-8');
      const parsed = parseTsConfigText(raw);
      if (parsed) out.set(dirOf(posix), parsed);
    } catch {
      // skip unreadable tsconfig
    }
  }
  return out;
}

function loadGoModules(projectRoot: string, filePaths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of filePaths) {
    const posix = toPosix(p);
    const base = posix.includes('/') ? posix.slice(posix.lastIndexOf('/') + 1) : posix;
    if (base !== 'go.mod') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    try {
      const raw = readFileSync(absPath, 'utf-8');
      let moduleName = '';
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.replace(/\/\/.*$/, '').trim();
        if (!trimmed.startsWith('module ')) continue;
        moduleName = trimmed.slice('module '.length).trim();
        break;
      }
      if (moduleName) out.set(dirOf(posix), moduleName);
    } catch {
      // skip unreadable go.mod
    }
  }
  return out;
}

function buildSuffixIndex(
  filePaths: string[],
  extPredicate: (p: string) => boolean,
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const p of filePaths) {
    const posix = toPosix(p);
    if (!extPredicate(posix)) continue;
    const parts = posix.split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      if (!idx.has(suffix)) idx.set(suffix, []);
      idx.get(suffix)!.push(posix);
    }
  }
  for (const arr of idx.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }
  return idx;
}

export interface ResolutionContext {
  fileSet: Set<string>;
  tsConfigs: Map<string, TsConfig>;
  goModules: Map<string, string>;
  goFilesByDir: Map<string, string[]>;
  csSuffixIndex: Map<string, string[]>;
  findNearestConfigDir: (startDir: string, configMap: Map<string, unknown>) => string | undefined;
}

export function buildResolutionContext(
  projectRoot: string,
  filePaths: string[],
): ResolutionContext {
  const fileSet = new Set(filePaths.map((p) => toPosix(p)));
  const tsConfigs = loadTsConfigs(projectRoot, filePaths);
  const goModules = loadGoModules(projectRoot, filePaths);

  const goFilesByDir = new Map<string, string[]>();
  for (const p of filePaths) {
    if (!p.endsWith('.go')) continue;
    const posix = toPosix(p);
    const d = dirOf(posix);
    if (!goFilesByDir.has(d)) goFilesByDir.set(d, []);
    goFilesByDir.get(d)!.push(posix);
  }
  for (const arr of goFilesByDir.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  const csSuffixIndex = buildSuffixIndex(filePaths, (p) => p.endsWith('.cs'));

  return {
    fileSet,
    tsConfigs,
    goModules,
    goFilesByDir,
    csSuffixIndex,
    findNearestConfigDir,
  };
}

export { toPosix, dirOf, resolveRelative, findNearestConfigDir };
```

- [x] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 10: Implement TS/JS Resolver

**Files:**
- Create: `packages/utils/src/cache/resolvers/ts-resolver.ts`

- [x] **Step 1: Create TS resolver**

Write `packages/utils/src/cache/resolvers/ts-resolver.ts`:

```typescript
import { posix } from 'path';
import { toPosix, dirOf, resolveRelative, findNearestConfigDir } from './context.js';
import type { ResolutionContext } from './context.js';

const TS_EXT_PROBES = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
];

function probeWithExtensions(basePath: string, fileSet: Set<string>): string | null {
  if (!basePath) return null;
  if (fileSet.has(basePath)) return basePath;
  for (const ext of TS_EXT_PROBES) {
    const candidate = basePath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function matchTsAlias(alias: string, src: string): string | null {
  const starIdx = alias.indexOf('*');
  if (starIdx === -1) {
    return src === alias ? '' : null;
  }
  const prefix = alias.slice(0, starIdx);
  const suffix = alias.slice(starIdx + 1);
  if (!src.startsWith(prefix)) return null;
  if (!src.endsWith(suffix)) return null;
  if (src.length < prefix.length + suffix.length) return null;
  return src.slice(prefix.length, src.length - suffix.length);
}

function applyTsAlias(target: string, wildcard: string): string {
  const starIdx = target.indexOf('*');
  if (starIdx === -1) return target;
  return target.slice(0, starIdx) + wildcard + target.slice(starIdx + 1);
}

export function resolveTsJsImport(
  source: string,
  filePath: string,
  ctx: ResolutionContext,
): string | null {
  if (!source || typeof source !== 'string') return null;
  const src = source.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(filePath));

  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  const tsConfigDir = ctx.findNearestConfigDir(importerDir, ctx.tsConfigs as unknown as Map<string, unknown>);
  if (tsConfigDir !== undefined) {
    const tsConfig = ctx.tsConfigs.get(tsConfigDir);
    if (tsConfig && tsConfig.paths && tsConfig.paths.size > 0) {
      const { baseUrl, paths } = tsConfig;
      for (const [alias, targets] of paths) {
        const aliasMatch = matchTsAlias(alias, src);
        if (aliasMatch === null) continue;
        for (const target of targets) {
          const mapped = applyTsAlias(target, aliasMatch);
          const normalizedBase = baseUrl === '.' || baseUrl === '' ? '' : toPosix(baseUrl);
          const relativeToConfig = normalizedBase ? posix.join(normalizedBase, mapped) : mapped;
          const candidate = posix.normalize(
            tsConfigDir ? posix.join(tsConfigDir, relativeToConfig) : relativeToConfig,
          );
          if (candidate.startsWith('..')) continue;
          const probed = probeWithExtensions(candidate, ctx.fileSet);
          if (probed) return probed;
        }
      }
    }
  }

  return null;
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 11: Implement Go Resolver

**Files:**
- Create: `packages/utils/src/cache/resolvers/go-resolver.ts`

- [x] **Step 1: Create Go resolver**

Write `packages/utils/src/cache/resolvers/go-resolver.ts`:

```typescript
import { toPosix, dirOf, findNearestConfigDir } from './context.js';
import type { ResolutionContext } from './context.js';

export function resolveGoImport(
  source: string,
  filePath: string,
  ctx: ResolutionContext,
): string[] {
  if (!source || typeof source !== 'string') return [];
  const src = source.trim();
  if (!src) return [];

  const importerDir = dirOf(toPosix(filePath));

  const nearestModuleDir = ctx.findNearestConfigDir(
    importerDir,
    ctx.goModules as unknown as Map<string, unknown>,
  );
  if (nearestModuleDir === undefined) return [];

  const moduleName = ctx.goModules.get(nearestModuleDir);

  let remainder: string;
  if (src === moduleName) {
    remainder = '';
  } else if (src.startsWith(moduleName + '/')) {
    remainder = src.slice(moduleName.length + 1);
  } else {
    return [];
  }

  const subDir = toPosix(remainder);
  const targetDir = nearestModuleDir
    ? subDir ? `${nearestModuleDir}/${subDir}` : nearestModuleDir
    : subDir;
  const files = ctx.goFilesByDir.get(targetDir);
  return files ? [...files] : [];
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 12: Implement Python Resolver

**Files:**
- Create: `packages/utils/src/cache/resolvers/python-resolver.ts`

- [x] **Step 1: Create Python resolver**

Write `packages/utils/src/cache/resolvers/python-resolver.ts`:

```typescript
import { toPosix, dirOf } from './context.js';
import type { ResolutionContext } from './context.js';

function resolvePythonProbe(
  moduleParts: string[],
  specifiers: string[],
  ctx: ResolutionContext,
): string[] {
  if (moduleParts.length === 0) return [];
  const base = moduleParts.join('/');
  const matches: string[] = [];

  const moduleFile = `${base}.py`;
  const packageInit = `${base}/__init__.py`;

  if (ctx.fileSet.has(moduleFile)) {
    matches.push(moduleFile);
    return matches;
  }
  if (ctx.fileSet.has(packageInit)) {
    matches.push(packageInit);
    if (Array.isArray(specifiers)) {
      for (const spec of specifiers) {
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = `${base}/${spec}.py`;
        const subInit = `${base}/${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
    }
    return matches;
  }
  return [];
}

export function resolvePythonImport(
  source: string,
  specifiers: string[],
  filePath: string,
  ctx: ResolutionContext,
): string[] {
  if (typeof source !== 'string') return [];
  const src = source;
  const importerDir = dirOf(toPosix(filePath));

  let dots = 0;
  while (dots < src.length && src.charCodeAt(dots) === 0x2e) dots++;
  const tail = src.slice(dots);
  const tailSegments = tail ? tail.split('.').filter(Boolean) : [];

  if (dots > 0) {
    const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
    const dropLevels = dots - 1;
    if (dropLevels > importerParts.length) return [];
    const baseParts = importerParts.slice(0, importerParts.length - dropLevels);

    if (tailSegments.length === 0) {
      if (!Array.isArray(specifiers) || specifiers.length === 0) return [];
      const base = baseParts.join('/');
      const matches: string[] = [];
      for (const spec of specifiers) {
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = base ? `${base}/${spec}.py` : `${spec}.py`;
        const subInit = base ? `${base}/${spec}/__init__.py` : `${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
      return matches;
    }

    const moduleParts = baseParts.concat(tailSegments);
    return resolvePythonProbe(moduleParts, specifiers, ctx);
  }

  if (tailSegments.length === 0) return [];

  const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
  for (let i = importerParts.length; i >= 0; i--) {
    const rootParts = importerParts.slice(0, i);
    const candidateModule = rootParts.concat(tailSegments);
    const matches = resolvePythonProbe(candidateModule, specifiers, ctx);
    if (matches.length > 0) return matches;
  }
  return [];
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 13: Implement CSharp Resolver

**Files:**
- Create: `packages/utils/src/cache/resolvers/csharp-resolver.ts`

- [x] **Step 1: Create C# resolver**

Write `packages/utils/src/cache/resolvers/csharp-resolver.ts`:

```typescript
import type { ResolutionContext } from './context.js';

function resolveDottedFqn(
  fqn: string,
  ext: string,
  suffixIndex: Map<string, string[]>,
): string[] {
  if (!fqn || typeof fqn !== 'string') return [];
  const trimmed = fqn.replace(/\.\*$/, '');
  if (!trimmed) return [];
  const filePart = trimmed.replace(/\./g, '/') + ext;
  const matches = suffixIndex.get(filePart);
  return matches ? [...matches] : [];
}

export function resolveCSharpImport(
  source: string,
  _filePath: string,
  ctx: ResolutionContext,
): string[] {
  return resolveDottedFqn(source, '.cs', ctx.csSuffixIndex);
}
```

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 14: Create resolver dispatch and barrel export

**Files:**
- Create: `packages/utils/src/cache/resolvers/dispatch.ts`
- Create: `packages/utils/src/cache/resolvers/index.ts`

- [x] **Step 1: Create dispatch.ts**

Write `packages/utils/src/cache/resolvers/dispatch.ts`:

```typescript
import type { ImportInfo } from '@open-zread/types';
import type { ResolutionContext } from './context.js';
import { resolveTsJsImport } from './ts-resolver.js';
import { resolveGoImport } from './go-resolver.js';
import { resolvePythonImport } from './python-resolver.js';
import { resolveCSharpImport } from './csharp-resolver.js';

const TS_JS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'vue']);

export function resolveImport(
  importInfo: ImportInfo,
  filePath: string,
  language: string,
  ctx: ResolutionContext,
): string[] {
  const src = importInfo.source;
  if (TS_JS_LANGS.has(language)) {
    const out = resolveTsJsImport(src, filePath, ctx);
    return out ? [out] : [];
  }
  if (language === 'python') {
    return resolvePythonImport(src, importInfo.specifiers, filePath, ctx);
  }
  if (language === 'go') {
    return resolveGoImport(src, filePath, ctx);
  }
  if (language === 'csharp') {
    return resolveCSharpImport(src, filePath, ctx);
  }
  return [];
}
```

- [x] **Step 2: Create index.ts barrel export**

Write `packages/utils/src/cache/resolvers/index.ts`:

```typescript
export { buildResolutionContext } from './context.js';
export type { ResolutionContext } from './context.js';
export { resolveImport } from './dispatch.js';
```

- [x] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 15: Integrate resolvers into buildDependencyGraph

**Files:**
- Modify: `packages/utils/src/cache/dependency-graph.ts`

- [x] **Step 1: Add resolver imports and rewrite buildDependencyGraph**

Add imports at top of `packages/utils/src/cache/dependency-graph.ts` (after existing imports):

```typescript
import { buildResolutionContext, resolveImport } from './resolvers/index.js';
import { dirname } from 'path';
```

Then replace the `buildDependencyGraph` function (lines 38-70) with:

```typescript
export function buildDependencyGraph(
  symbols: SymbolManifest,
  packageAliases?: Record<string, string>,
): DependencyGraph {
  const forward: Record<string, string[]> = {};
  const reverse: Record<string, string[]> = {};
  const edges: DependencyEdge[] = [];

  const filePaths = symbols.symbols.map((s) => s.file);
  const projectRoot = getProjectRoot();
  let ctx: ReturnType<typeof buildResolutionContext> | undefined;
  try {
    ctx = buildResolutionContext(projectRoot, filePaths);
  } catch {
    // If context building fails (e.g. no filesystem access), fall through to regex
  }

  for (const symbol of symbols.symbols) {
    if (!forward[symbol.file]) forward[symbol.file] = [];
    if (!reverse[symbol.file]) reverse[symbol.file] = [];

    const hasStructured = symbol.structuredImports && symbol.structuredImports.length > 0;
    if (hasStructured && ctx) {
      const language = symbol.language || 'unknown';
      for (const imp of symbol.structuredImports!) {
        const resolvedPaths = resolveImport(imp, symbol.file, language, ctx);
        for (const resolved of resolvedPaths) {
          if (!forward[symbol.file].includes(resolved)) {
            forward[symbol.file].push(resolved);
          }
          if (!reverse[resolved]) reverse[resolved] = [];
          if (!reverse[resolved].includes(symbol.file)) {
            reverse[resolved].push(symbol.file);
          }
          edges.push({ source: symbol.file, target: resolved, kind: 'import' });
        }
      }
    }

    // Fallback: regex extraction for imports not covered by structuredImports
    const processedTargets = new Set(hasStructured && ctx ? forward[symbol.file] : []);
    for (const imp of symbol.imports) {
      const importPath = extractImportPath(imp);
      if (!importPath) continue;
      const resolved = resolveImportPath(importPath, symbol.file, packageAliases);
      if (!resolved) continue;
      if (processedTargets.has(resolved)) continue;
      if (!forward[symbol.file].includes(resolved)) {
        forward[symbol.file].push(resolved);
      }
      if (!reverse[resolved]) reverse[resolved] = [];
      if (!reverse[resolved].includes(symbol.file)) {
        reverse[resolved].push(symbol.file);
      }
      edges.push({ source: symbol.file, target: resolved, kind: 'import' });
    }
  }

  return { forward, reverse, edges };
}
```

Also add the `getProjectRoot` import (it's already imported from `../file-io.js` — check line 3). If not already there, add it.

- [x] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

---

### Task 16: Update downstream consumers

**Files:**
- Modify: `packages/repo-analyzer/src/repo-map/reference-counter.ts`

- [x] **Step 1: Update reference-counter to prefer structuredImports**

In `packages/repo-analyzer/src/repo-map/reference-counter.ts`, replace the counting loop (lines 27-39) with:

```typescript
  for (const symbol of symbols.symbols) {
    if (symbol.structuredImports && symbol.structuredImports.length > 0) {
      for (const imp of symbol.structuredImports) {
        const importName = imp.source.split('/').pop() || '';
        const targetFile = fileIndex.get(importName);
        if (targetFile) {
          referenceMap[targetFile]++;
        }
      }
    } else {
      for (const importStatement of symbol.imports) {
        const importPath = extractImportPath(importStatement);
        if (importPath?.startsWith('.')) {
          const importName = importPath.split('/').pop() || '';
          const targetFile = fileIndex.get(importName);
          if (targetFile) {
            referenceMap[targetFile]++;
          }
        }
      }
    }
  }
```

- [x] **Step 2: Run typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

---

### Task 17: Full verification

**Files:** none (verification only)

- [x] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS, zero errors

- [x] **Step 2: Run lint**

Run: `bun run lint`
Expected: PASS (if errors, run `bun run lint:fix`)

- [x] **Step 3: Run existing tests**

Run: `bun test packages/repo-analyzer/src/parser/__tests__/` and `bun test packages/repo-analyzer/src/repo-map/__tests__/`
Expected: All existing tests PASS

- [x] **Step 4: Manual verification — TypeScript project**

Run: `bun run dev` against a TypeScript project (e.g. open-zread itself)
Expected: Relationship graph still shows edges between files

- [x] **Step 5: Manual verification — Go project**

Run: `bun run dev` against a Go project
Expected: Relationship graph shows edges between .go files (no more isolated nodes)

- [x] **Step 6: Manual verification — Python project**

Run: `bun run dev` against a Python project
Expected: Relationship graph shows edges between .py files

- [x] **Step 7: Manual verification — C# project**

Run: `bun run dev` against a C# project
Expected: Relationship graph shows edges between .cs files (no more isolated nodes)
