## ADDED Requirements

### Requirement: DocExtractor interface
The system SHALL define a `DocExtractor` interface with the following contract:

- `languageIds: string[]` — the language IDs this extractor handles
- `extractDocForNode(node: TreeSitterNode, source: string): string | undefined` — extract the documentation comment attached to a symbol declaration node

The returned doc string SHALL be normalized (prefix stripped, trimmed, internal newlines preserved) and SHALL be truncated to 800 characters with `...（已截断）` suffix when exceeded.

#### Scenario: No doc attached
- **WHEN** a declaration has no documentation comment above it
- **THEN** `extractDocForNode` SHALL return `undefined`

#### Scenario: Doc length within limit
- **WHEN** a normalized doc is 500 characters
- **THEN** `extractDocForNode` SHALL return the full 500-character string

#### Scenario: Doc length exceeds limit
- **WHEN** a normalized doc is 1500 characters
- **THEN** `extractDocForNode` SHALL return a string of length 800 + length of `...（已截断）` suffix

### Requirement: TypeScript Doc Extractor
The system SHALL provide a `TypeScriptDocExtractor` implementing `DocExtractor` for `languageIds: ["typescript", "javascript"]`.

It SHALL walk the declaration's `previousSibling` chain, skipping whitespace-only nodes, and match the first `comment` type node whose text starts with `/**`. Line comments (`// ...`) and non-doc block comments (`/* ... */` without leading asterisk) SHALL NOT be matched.

Normalization SHALL strip `/**`, `*/`, and leading ` * ` from each line.

#### Scenario: Function with JSDoc
- **WHEN** source contains `/**\n * Build the repo map.\n */\nexport function buildRepoMap() { ... }`
- **THEN** extractor returns `"Build the repo map."`

#### Scenario: Function with inline comment only
- **WHEN** source contains `// fast path\nfunction foo() { ... }`
- **THEN** extractor returns `undefined`

#### Scenario: Function with non-doc block comment
- **WHEN** source contains `/* internal */\nfunction foo() { ... }`
- **THEN** extractor returns `undefined`

#### Scenario: Multi-line JSDoc preserves paragraphs
- **WHEN** JSDoc contains a blank `*` line between two paragraphs
- **THEN** normalized doc preserves the blank line as `\n\n`

#### Scenario: JSDoc tags retained as-is
- **WHEN** JSDoc contains `@param opts - Build options\n * @returns the map`
- **THEN** normalized doc retains these lines (no special parsing)

### Requirement: Python Doc Extractor
The system SHALL provide a `PythonDocExtractor` implementing `DocExtractor` for `languageIds: ["python"]`.

It SHALL navigate to the declaration's `body` field. If the body's first child is an `expression_statement` whose first child is a `string` node enclosed in triple quotes (`"""` or `'''`), the string content SHALL be extracted as the docstring.

Normalization SHALL strip triple-quote delimiters and trim leading/trailing whitespace.

#### Scenario: Function with triple-quoted docstring
- **WHEN** source contains `def foo():\n    """Compute foo."""\n    pass`
- **THEN** extractor returns `"Compute foo."`

#### Scenario: Function with no docstring
- **WHEN** source contains `def foo():\n    pass`
- **THEN** extractor returns `undefined`

#### Scenario: Function with non-string first statement
- **WHEN** source contains `def foo():\n    x = 1\n    return x`
- **THEN** extractor returns `undefined`

#### Scenario: Multi-line docstring
- **WHEN** docstring spans multiple lines with consistent indentation
- **THEN** extractor returns text with indentation preserved relative to the docstring's own structure

### Requirement: Go Doc Extractor
The system SHALL provide a `GoDocExtractor` implementing `DocExtractor` for `languageIds: ["go"]`.

It SHALL walk the declaration's `previousSibling` chain, collecting **consecutive** `comment` nodes where each starts with `// `. The collection SHALL stop at the first non-comment node OR at a gap with more than one newline between adjacent comment nodes (i.e., a blank line separates the doc from earlier code).

The collected comments SHALL be joined with `\n` and normalized by stripping the leading `// ` from each line.

#### Scenario: Function with single-line doc
- **WHEN** source contains `// Build builds something.\nfunc Build() {}`
- **THEN** extractor returns `"Build builds something."`

#### Scenario: Function with multi-line doc
- **WHEN** source contains `// Build does X.\n// It returns Y.\nfunc Build() {}`
- **THEN** extractor returns `"Build does X.\nIt returns Y."`

#### Scenario: Function separated from comment by blank line
- **WHEN** source contains `// Build does X.\n\nfunc Build() {}`
- **THEN** extractor returns `undefined`

#### Scenario: Function with mixed comment styles
- **WHEN** comments before the function include both `//` and `/* */`
- **THEN** extractor includes only the contiguous `//` lines closest to the function

### Requirement: C# Doc Extractor
The system SHALL provide a `CSharpDocExtractor` implementing `DocExtractor` for `languageIds: ["csharp"]`.

It SHALL walk the declaration's `previousSibling` chain, collecting **consecutive** `comment` nodes where each starts with `///`. The collection SHALL stop at the first non-comment node OR at a blank-line gap.

The collected comments SHALL be joined with `\n` and normalized by stripping the leading `///` (and one optional space) from each line. XML tags such as `<summary>` SHALL be preserved as-is in the output.

#### Scenario: Method with XML doc
- **WHEN** source contains `/// <summary>Builds X.</summary>\npublic void Build() {}`
- **THEN** extractor returns `"<summary>Builds X.</summary>"`

#### Scenario: Method with multi-line XML doc
- **WHEN** source contains `/// <summary>\n/// Builds X.\n/// </summary>\npublic void Build() {}`
- **THEN** extractor returns `"<summary>\nBuilds X.\n</summary>"`

#### Scenario: Method with non-doc comment
- **WHEN** source contains `// just a note\npublic void Build() {}`
- **THEN** extractor returns `undefined` (only `///` is treated as doc)

### Requirement: Vue Component Doc Extraction
For Vue SFC files, the system SHALL reuse the TypeScript Doc Extractor on the AST extracted from the `<script>` block.

#### Scenario: Vue component with JSDoc on exported function
- **WHEN** a `.vue` file has `<script>` containing `/** Compute X. */ export function computeX() {}`
- **THEN** the function's `doc` is `"Compute X."`

### Requirement: Parser populates doc field
The parser (`parseFile`) SHALL populate `SymbolInfo.functions[].doc` when a doc comment is successfully extracted from the corresponding AST node.

When the language has no registered DocExtractor, OR no doc is attached to the node, the `doc` field SHALL be omitted (i.e., `undefined`, not empty string).

#### Scenario: TypeScript function with JSDoc
- **WHEN** a TypeScript file is parsed with `/** doc */ export function foo() {}`
- **THEN** `symbol.functions[0].doc` is `"doc"`

#### Scenario: TypeScript function without doc
- **WHEN** a TypeScript file is parsed with `export function foo() {}`
- **THEN** `symbol.functions[0].doc` is `undefined`

#### Scenario: Language without DocExtractor
- **WHEN** a file in an unsupported-for-docs language is parsed
- **THEN** all `symbol.functions[].doc` fields are `undefined` (backward-compatible)

### Requirement: Doc normalization
The system SHALL provide a `normalizeDoc(raw: string, style: 'jsdoc' | 'python' | 'go' | 'csharp'): string` function that:

- For `jsdoc`: strips `/**`, `*/`, and leading ` * ` (with one space) per line
- For `python`: strips triple quotes (`"""` or `'''`) from start and end
- For `go`: strips leading `// ` (with one space) per line; if a line starts with `//` without a following space, only `//` is stripped
- For `csharp`: strips leading `///` (with one optional space) per line
- Trims leading and trailing whitespace from the result
- Preserves internal newlines

#### Scenario: JSDoc normalization
- **WHEN** input is `/**\n * Hello\n * World\n */`
- **THEN** output is `"Hello\nWorld"`

#### Scenario: Go doc normalization
- **WHEN** input is `// First line\n// Second line`
- **THEN** output is `"First line\nSecond line"`

#### Scenario: Python triple-quote normalization
- **WHEN** input is `"""Hello"""`
- **THEN** output is `"Hello"`

### Requirement: Doc truncation
The system SHALL provide a `truncateDoc(doc: string, maxChars?: number): string` function with default `maxChars = 800`.

If `doc.length <= maxChars`, the original string is returned. Otherwise, the first `maxChars` characters are returned followed by `...（已截断）`.

#### Scenario: Doc within limit
- **WHEN** doc is 600 characters and limit is 800
- **THEN** function returns the original 600-character string

#### Scenario: Doc exceeds limit
- **WHEN** doc is 1000 characters and limit is 800
- **THEN** function returns first 800 characters concatenated with `...（已截断）`
