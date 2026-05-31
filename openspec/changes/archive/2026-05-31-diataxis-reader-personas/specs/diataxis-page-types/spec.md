## ADDED Requirements

### Requirement: DocType 类型定义
The system SHALL define a `DocType` union type `'tutorial' | 'howto' | 'reference' | 'explanation'` in `packages/types/src/wiki.ts`, and SHALL add an optional `docType?: DocType` field to `WikiPage`.

When `docType` is absent, the page SHALL be treated as `'explanation'` (backward compatible default).

#### Scenario: Page with explicit docType
- **WHEN** a WikiPage has `docType: 'tutorial'`
- **THEN** the page is classified in the Tutorial quadrant

#### Scenario: Page without docType defaults to explanation
- **WHEN** a WikiPage has no `docType` field
- **THEN** the system treats it as `'explanation'`

### Requirement: docType 与 level 正交
`docType` SHALL determine the writing quadrant and prompt template, while `level` SHALL continue to determine depth and dual-pass eligibility. The two fields SHALL be independent.

#### Scenario: Advanced explanation uses dual-pass
- **GIVEN** a page with `docType: 'explanation'` and `level: 'Advanced'`
- **WHEN** it is generated
- **THEN** it runs through the existing Architect→Reviewer dual-pass

#### Scenario: Advanced reference does not use dual-pass
- **GIVEN** a page with `docType: 'reference'` and `level: 'Advanced'`
- **WHEN** it is generated
- **THEN** it uses the Facts-driven reference template (single pass), not dual-pass

### Requirement: 按 docType 分发生成路由
`generateWikiContent()` SHALL route each page by `docType ?? 'explanation'`:

- `tutorial` → tutorial prompt (single pass)
- `howto` → how-to prompt (single pass)
- `reference` → Facts-driven reference prompt (single pass)
- `explanation` → existing logic (Advanced → dual-pass, otherwise single pass)

#### Scenario: Tutorial routed to tutorial prompt
- **WHEN** a page with `docType: 'tutorial'` is generated
- **THEN** the tutorial prompt template is used

#### Scenario: How-to routed to how-to prompt
- **WHEN** a page with `docType: 'howto'` is generated
- **THEN** the how-to prompt template is used

#### Scenario: Reference routed to reference prompt
- **WHEN** a page with `docType: 'reference'` is generated
- **THEN** the Facts-driven reference prompt template is used

#### Scenario: Explanation preserves existing behavior
- **WHEN** a page with `docType: 'explanation'` (or absent) is generated
- **THEN** the existing `page-agent.ts`-based single/dual-pass logic runs unchanged

### Requirement: GenerateBlueprintTool 接受 docType
The `GenerateBlueprintTool` inputSchema SHALL accept an optional `docType` property on each page item, constrained to the four `DocType` values. `generateWikiJson()` SHALL persist `docType` into the saved `wiki.json`.

#### Scenario: docType persisted
- **WHEN** the agent calls `generate_blueprint` with a page having `docType: 'howto'`
- **THEN** the saved `wiki.json` page retains `docType: 'howto'`

#### Scenario: docType omitted is valid
- **WHEN** the agent calls `generate_blueprint` with a page lacking `docType`
- **THEN** the call succeeds and the page has no `docType` field

### Requirement: 重生环对所有 docType 一致处理
The regeneration loop SHALL remediate low-quality pages of any `docType` using the single-agent feedback prompt, and SHALL NOT re-select a quadrant-specific template during regeneration.

#### Scenario: Reference page regenerated with feedback prompt
- **GIVEN** a `reference` page audited as `basic`
- **WHEN** the regeneration loop runs
- **THEN** it uses the single-agent `buildRegeneratePrompt`, not the reference template
