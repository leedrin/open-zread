## ADDED Requirements

### Requirement: LanguageExtractor interface
The system SHALL define a `LanguageExtractor` interface with the following contract:
- `languageIds: string[]` — the language IDs this extractor handles
- `extractStructure(rootNode: TreeSitterNode): { imports: ImportInfo[] }` — extract structured imports from the AST root node

Each ImportInfo SHALL contain:
- `source: string` — the module path (e.g., `"./utils"`, `"fmt"`, `"System.Collections"`)
- `specifiers: string[]` — the imported symbol names
- `lineNumber?: number` — optional line number

#### Scenario: TypeScript import extraction
- **WHEN** a TypeScript file contains `import { foo, bar } from './utils'`
- **THEN** the extractor SHALL produce `{ source: "./utils", specifiers: ["foo", "bar"] }`

#### Scenario: Go grouped import extraction
- **WHEN** a Go file contains `import (\n"fmt"\n"net/http"\n)`
- **THEN** the extractor SHALL produce two separate ImportInfo entries: `{ source: "fmt", specifiers: ["fmt"] }` and `{ source: "net/http", specifiers: ["http"] }`

#### Scenario: Python from-import extraction
- **WHEN** a Python file contains `from typing import List, Optional`
- **THEN** the extractor SHALL produce `{ source: "typing", specifiers: ["List", "Optional"] }`

#### Scenario: Python relative import extraction
- **WHEN** a Python file contains `from ..utils.parser import parse_csv`
- **THEN** the extractor SHALL produce `{ source: "..utils.parser", specifiers: ["parse_csv"] }`

#### Scenario: C# using directive extraction
- **WHEN** a C# file contains `using System.Collections.Generic;`
- **THEN** the extractor SHALL produce `{ source: "System.Collections.Generic", specifiers: ["Generic"] }`

#### Scenario: C# aliased using extraction
- **WHEN** a C# file contains `using List = System.Collections.Generic.List;`
- **THEN** the extractor SHALL produce `{ source: "System.Collections.Generic.List", specifiers: ["List"] }`

### Requirement: TypeScript Extractor
The system SHALL provide a `TypeScriptExtractor` implementing `LanguageExtractor` for `languageIds: ["typescript", "javascript"]`.

It SHALL extract imports from the following AST node types:
- `import_statement` — the `string` child node (source path), using `childForFieldName()` to navigate the AST, with `getStringValue()` to strip quotes
- Import specifiers SHALL be extracted from `import_clause` → `named_imports` → `import_specifier` nodes

#### Scenario: Default import
- **WHEN** source contains `import React from 'react'`
- **THEN** extractor produces `{ source: "react", specifiers: ["React"] }`

#### Scenario: Namespace import
- **WHEN** source contains `import * as fs from 'fs'`
- **THEN** extractor produces `{ source: "fs", specifiers: ["* as fs"] }`

#### Scenario: Re-export
- **WHEN** source contains `export { foo } from './bar'`
- **THEN** extractor produces `{ source: "./bar", specifiers: ["foo"] }`

### Requirement: Go Extractor
The system SHALL provide a `GoExtractor` implementing `LanguageExtractor` for `languageIds: ["go"]`.

It SHALL handle both single imports and grouped imports:
- Single: `import "fmt"` — find `import_spec` child, extract `path` field
- Grouped: `import ( ... )` — find `import_spec_list`, iterate all `import_spec` children

The source path SHALL be extracted from the `path` field's `interpreted_string_literal_content` child (unquoted).

The specifier SHALL be the import alias (if present) or the last path component (e.g., `"net/http"` → `"http"`).

#### Scenario: Import with alias
- **WHEN** source contains `import http "net/http"`
- **THEN** extractor produces `{ source: "net/http", specifiers: ["http"] }`

#### Scenario: Import without alias
- **WHEN** source contains `import "fmt"`
- **THEN** extractor produces `{ source: "fmt", specifiers: ["fmt"] }`

### Requirement: Python Extractor
The system SHALL provide a `PythonExtractor` implementing `LanguageExtractor` for `languageIds: ["python"]`.

It SHALL handle:
- `import_statement` — extract `dotted_name` children as source
- `import_from_statement` — extract `module_name` field as source, remaining `dotted_name` / `aliased_import` / `wildcard_import` as specifiers

#### Scenario: Plain import
- **WHEN** source contains `import os.path`
- **THEN** extractor produces `{ source: "os.path", specifiers: ["os.path"] }`

#### Scenario: Star import
- **WHEN** source contains `from os import *`
- **THEN** extractor produces `{ source: "os", specifiers: ["*"] }`

### Requirement: CSharp Extractor
The system SHALL provide a `CSharpExtractor` implementing `LanguageExtractor` for `languageIds: ["csharp"]`.

It SHALL handle `using_directive` nodes:
- Simple: `using System;` — extract `identifier` child
- Qualified: `using System.Collections.Generic;` — extract `qualified_name` child text
- Aliased: `using X = Some.Namespace;` — extract the target `qualified_name` after `=`

The specifier SHALL be the last dotted component of the source.

#### Scenario: File-scoped namespace context
- **WHEN** a C# file uses file-scoped namespace `namespace MyApp.Services;`
- **THEN** the extractor SHALL still extract all `using_directive` imports from the top-level nodes

### Requirement: Base Extractor utilities
The system SHALL provide shared utility functions in a base module:
- `findChild(node, type)` — find first child matching a type
- `findChildren(node, type)` — find all children matching a type
- `getStringValue(node)` — extract unquoted string from a string literal node
- `hasChildOfType(node, type)` — check if a child of given type exists

#### Scenario: getStringValue strips quotes
- **WHEN** a `string` AST node has text `"'./utils'"`
- **THEN** `getStringValue` SHALL return `"./utils"`

### Requirement: Parser integration
The parser (`parseFile`) SHALL populate both `imports: string[]` (backward compatible, raw text) and `structuredImports: ImportInfo[]` (new, structured data) on `SymbolInfo`.

The parser SHALL also populate `language: string` on `SymbolInfo` from the `file.language` input.

#### Scenario: Structured imports populated alongside raw imports
- **WHEN** a TypeScript file is parsed with `import { foo } from './bar'`
- **THEN** `symbol.imports` SHALL contain `"import { foo } from './bar'"` AND `symbol.structuredImports` SHALL contain `{ source: "./bar", specifiers: ["foo"] }`

#### Scenario: Language field populated
- **WHEN** a Go file is parsed
- **THEN** `symbol.language` SHALL be `"go"`
