## MODIFIED Requirements

### Requirement: ExportFact 携带作者注释
`ExportFact` SHALL include an optional `doc?: string` field carrying the source's original documentation comment.

When the underlying `SymbolInfo.functions[].doc` is present, `extractPageFacts()` SHALL copy that value into the corresponding `ExportFact.doc`. When absent, `ExportFact.doc` SHALL remain `undefined`.

For exports derived from `SymbolInfo.exports[]` (raw export names without an associated function declaration), `ExportFact.doc` SHALL be `undefined` (no AST node available to extract from).

#### Scenario: Function export with JSDoc
- **GIVEN** a SymbolInfo where `functions[0]` has `doc: "Builds the repo map."`
- **WHEN** `extractPageFacts(page, symbols)` is called and that function matches the page's associated files
- **THEN** the resulting `PageFacts.exports[]` contains an entry with `doc: "Builds the repo map."`

#### Scenario: Function export without doc
- **GIVEN** a SymbolInfo where `functions[0].doc` is `undefined`
- **WHEN** `extractPageFacts()` is called
- **THEN** the resulting ExportFact's `doc` is `undefined`

#### Scenario: Raw export without function declaration
- **GIVEN** a SymbolInfo where `exports[]` contains `"MyType"` (a re-exported type with no captured function)
- **WHEN** `extractPageFacts()` is called
- **THEN** the resulting ExportFact for `MyType` has `doc` undefined

### Requirement: Page Agent Prompt 渲染作者注释
The `buildPagePrompt()` function SHALL render the `doc` field of each `ExportFact` in the Facts section.

When `ExportFact.doc` is present, the rendered line SHALL be:

```
- `{signature}` → {file}#L{line}
  📝 作者注释：{formatted doc}
```

where the formatted doc has continuation lines indented to align with the first line of the comment (e.g., 14-space indent after the leading bullet).

When `ExportFact.doc` is absent, the single-line format SHALL be preserved unchanged:

```
- `{signature}` → {file}#L{line}
```

#### Scenario: Render export with single-line doc
- **GIVEN** an ExportFact `{ signature: "foo()", file: "a.ts", line: 1, doc: "Compute foo." }`
- **WHEN** rendered in Facts
- **THEN** output contains two lines: the signature line and `  📝 作者注释：Compute foo.`

#### Scenario: Render export with multi-line doc
- **GIVEN** an ExportFact whose doc is `"First line.\nSecond line."`
- **WHEN** rendered in Facts
- **THEN** the second line of the doc is prefixed with 14 spaces to align with `作者注释：`

#### Scenario: Render export without doc
- **GIVEN** an ExportFact with `doc: undefined`
- **WHEN** rendered in Facts
- **THEN** output contains only the signature line, with no 📝 line

### Requirement: Facts 规则强制使用作者注释
The Facts section SHALL include a fourth rule explicitly instructing the LLM to prefer the author's documentation comments over invented prose:

```
4. 描述 API 用途时，**优先**使用作者注释中的措辞和角度，避免重新发挥
```

This rule SHALL appear in the existing "⚠️ Facts 规则" list, after the three pre-existing rules from the `facts-first` capability.

#### Scenario: Rule appears in Prompt
- **WHEN** `buildPagePrompt()` is called with non-empty Facts
- **THEN** the rendered Prompt contains all four rules in the `⚠️ Facts 规则` list

#### Scenario: Rule omitted when Facts empty
- **WHEN** `buildPagePrompt()` is called with no Facts (e.g., no SymbolManifest provided)
- **THEN** the Facts section (including rules) is entirely omitted, consistent with current behavior

### Requirement: 向后兼容性
The Facts payload format SHALL remain backward-compatible. Consumers of `PageFacts` that do not recognize the `doc` field SHALL continue to function correctly by ignoring the field.

Cached `PageFacts` produced by older versions of `extractPageFacts()` (without `doc`) SHALL be readable by the new Prompt renderer, which SHALL treat missing `doc` as `undefined`.

#### Scenario: Older cached facts loaded
- **GIVEN** a cached PageFacts JSON file produced before this change (no `doc` fields)
- **WHEN** the new `buildPagePrompt()` renders it
- **THEN** rendering succeeds with no 📝 lines (matching current pre-change behavior)
