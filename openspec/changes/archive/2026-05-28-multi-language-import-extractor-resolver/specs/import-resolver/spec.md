## ADDED Requirements

### Requirement: Resolution Context
The system SHALL build a `ResolutionContext` once per analysis run, containing:
- `fileSet: Set<string>` — all project-relative POSIX file paths for O(1) membership checks
- `tsConfigs: Map<string, TsConfig>` — directory → parsed tsconfig (baseUrl + paths aliases), loaded from all `tsconfig.json` files in the project
- `goModules: Map<string, string>` — directory → Go module name, loaded from all `go.mod` files
- `goFilesByDir: Map<string, string[]>` — directory → sorted list of `.go` files in that directory
- `csSuffixIndex: Map<string, string[]>` — path suffix → matching file paths, for all `.cs` files

#### Scenario: Multi-module Go project
- **WHEN** the project has `services/auth/go.mod` (module `github.com/org/auth`) and `services/api/go.mod` (module `github.com/org/api`)
- **THEN** `goModules` SHALL contain entries for both directories

#### Scenario: Multi-package tsconfig
- **WHEN** the project has `packages/cli/tsconfig.json` and `packages/core/tsconfig.json` with different path aliases
- **THEN** `tsConfigs` SHALL contain entries for both directories

### Requirement: Import dispatch
The system SHALL provide a `resolveImport(importInfo, file, context)` function that routes to the correct language-specific resolver based on `file.language`.

Supported language mappings:
- `typescript`, `javascript`, `tsx`, `jsx`, `vue` → TS/JS resolver
- `go` → Go resolver
- `python` → Python resolver
- `csharp` → C# resolver

#### Scenario: Unknown language
- **WHEN** a file has an unrecognized language
- **THEN** `resolveImport` SHALL return an empty array

### Requirement: TS/JS Resolver
The TS/JS resolver SHALL handle three import forms:

1. **Relative imports** (`./foo`, `../bar`): resolve against importer's directory, then probe with extensions.
2. **tsconfig path aliases** (`@/foo`): find nearest tsconfig, match alias pattern, resolve target.
3. **Bare specifiers** (`react`): return empty array (external package).

Extension probe order: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`.

tsconfig alias matching SHALL support `*` wildcard (e.g., `"@/*"` matches `"@/utils/helper"` with wildcard `"utils/helper"`).

#### Scenario: Relative import with .ts extension
- **WHEN** file `src/index.ts` imports `'./utils'` and `src/utils.ts` exists
- **THEN** resolver SHALL return `["src/utils.ts"]`

#### Scenario: tsconfig alias resolution
- **WHEN** file `packages/cli/src/main.ts` imports `'@/utils'`, and nearest tsconfig has `"@/*": ["src/*"]`
- **THEN** resolver SHALL resolve to `packages/cli/src/utils.ts` (if it exists)

#### Scenario: External package
- **WHEN** a file imports `'react'`
- **THEN** resolver SHALL return `[]`

#### Scenario: Multi-extension probe
- **WHEN** file `src/app.ts` imports `'./config'` and only `src/config.js` exists (no `.ts`)
- **THEN** resolver SHALL return `["src/config.js"]`

### Requirement: Go Resolver
The Go resolver SHALL:
1. Find the nearest `go.mod` by walking up from the importer's directory
2. Extract the module name from that `go.mod`
3. Strip the module prefix from the import path
4. Map the remainder to a directory relative to the module's directory
5. Return ALL `.go` files in that directory (Go imports are package-level)

If the import path does not start with the module prefix, it SHALL return an empty array (external package or different module).

#### Scenario: Internal package import
- **WHEN** file `services/auth/handlers/user.go` imports `"github.com/org/auth/models"` and `services/auth/go.mod` declares `module github.com/org/auth`
- **THEN** resolver SHALL return all `.go` files in `services/auth/models/`

#### Scenario: Standard library import
- **WHEN** a Go file imports `"fmt"`
- **THEN** resolver SHALL return `[]` (not matching any module prefix)

#### Scenario: Cross-module import
- **WHEN** file under `services/auth/` imports `"github.com/org/api/models"` and the nearest go.mod is `services/auth/go.mod` with module `github.com/org/auth`
- **THEN** resolver SHALL return `[]` (different module = external)

### Requirement: Python Resolver
The Python resolver SHALL handle:

1. **Relative imports** (leading dots): count leading dots to determine walk-up levels. `from .` = 0 levels up, `from ..` = 1 level up, etc. Then resolve the remaining dotted segments as a module path.
2. **Absolute imports** (no leading dots): walk up from the importer's directory, trying each ancestor as a candidate Python root. First match wins (importer-scope precedence).

Module probing (`resolvePythonProbe`): for path `a/b/c`, check `a/b/c.py` (leaf module) then `a/b/c/__init__.py` (package). On package match, also probe each specifier as a submodule.

#### Scenario: Relative import with module probe
- **WHEN** file `src/services/email/server.py` contains `from ..utils.parser import parse_csv` and `src/services/utils/parser/__init__.py` exists
- **THEN** resolver SHALL return `["src/services/utils/parser/__init__.py", "src/services/utils/parser/parse_csv.py"]` (if parse_csv.py exists)

#### Scenario: Absolute import with walk-up
- **WHEN** file `src/email/service.py` imports `config` and `src/email/config.py` exists
- **THEN** resolver SHALL return `["src/email/config.py"]` (found by walking up from `src/email/`)

#### Scenario: External package
- **WHEN** a Python file imports `typing`
- **THEN** resolver SHALL return `[]`

### Requirement: CSharp Resolver
The C# resolver SHALL convert dotted namespace to file path:
1. Strip trailing `.*` wildcard
2. Replace `.` with `/`
3. Append `.cs`
4. Look up in the pre-built suffix index

The suffix index SHALL be built from all `.cs` files, indexing every path suffix (e.g., `src/Services/UserService.cs` generates entries for `UserService.cs`, `Services/UserService.cs`, `src/Services/UserService.cs`).

#### Scenario: Namespace matching file path
- **WHEN** a C# file has `using MyApp.Services;` and `src/MyApp/Services.cs` exists
- **THEN** resolver SHALL return `["src/MyApp/Services.cs"]`

#### Scenario: External namespace
- **WHEN** a C# file has `using System.Collections.Generic;`
- **THEN** resolver SHALL return `[]` (no `.cs` file matches `System/Collections/Generic.cs`)

#### Scenario: Multiple source roots
- **WHEN** both `src/Foo.cs` and `test/Foo.cs` exist, and a file has `using Foo;`
- **THEN** resolver SHALL return both files

### Requirement: DependencyGraph integration
`buildDependencyGraph()` SHALL use the Resolver layer instead of regex:
1. For each symbol, read `structuredImports` (preferred) or fall back to `imports`
2. Build `ResolutionContext` from `SymbolManifest`
3. For each import, dispatch through `resolveImport()`
4. Collect resolved paths into `forward`, `reverse`, `edges`

#### Scenario: All languages produce edges
- **WHEN** a project has both TypeScript and Go files with internal imports
- **THEN** `DependencyGraph.forward` SHALL contain edges for both languages

#### Scenario: Backward compatibility fallback
- **WHEN** a symbol has `structuredImports` as empty array but `imports` has entries
- **THEN** the function SHALL fall back to the existing regex extraction for those entries
