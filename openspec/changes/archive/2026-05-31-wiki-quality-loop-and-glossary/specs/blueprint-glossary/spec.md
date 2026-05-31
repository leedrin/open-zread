## ADDED Requirements

### Requirement: GlossaryTerm 类型定义
The system SHALL define a `GlossaryTerm` interface in `packages/types/src/wiki.ts`:

- `term: string` — the canonical name of the concept
- `aliases?: string[]` — alternative names or legacy terms
- `definition: string` — a one-sentence definition
- `canonicalPage?: string` — the slug of the page that authoritatively documents this concept

`WikiOutput` SHALL include an optional `glossary?: GlossaryTerm[]` field.

#### Scenario: WikiOutput carries glossary
- **WHEN** a blueprint is generated with glossary terms
- **THEN** `WikiOutput.glossary` contains an array of `GlossaryTerm` entries

#### Scenario: WikiOutput without glossary remains valid
- **WHEN** a blueprint is generated without glossary
- **THEN** `WikiOutput.glossary` is `undefined` and the blueprint is still valid

### Requirement: Catalog Agent 产出术语表
The catalog generation prompt (`generate-catalog.ts`) SHALL instruct the Blueprint Agent to produce a glossary of the project's core concepts alongside the pages, capturing canonical names, aliases, and one-sentence definitions.

#### Scenario: Glossary produced during catalog generation
- **WHEN** the Blueprint Agent analyzes a project and produces the blueprint
- **THEN** it SHALL identify the project's core domain concepts and emit them as glossary terms

### Requirement: GenerateBlueprintTool 接受并持久化 glossary
The `GenerateBlueprintTool` inputSchema SHALL accept an optional `glossary` array, each item having `term`, `definition`, optional `aliases`, and optional `canonicalPage`.

`generateWikiJson()` SHALL accept the glossary and persist it into the `WikiOutput` written to `wiki.json`.

#### Scenario: Tool accepts glossary
- **WHEN** the agent calls `generate_blueprint` with `{ pages, glossary }`
- **THEN** the saved `wiki.json` contains the `glossary` array

#### Scenario: Tool omits glossary
- **WHEN** the agent calls `generate_blueprint` with only `{ pages }`
- **THEN** the saved `wiki.json` has no `glossary` field and the call succeeds

### Requirement: Glossary 注入 Page Agent Prompt
`buildPagePrompt()` SHALL inject a `## 📖 项目术语表（统一命名）` section **before** the Facts section when a non-empty glossary is available.

The section SHALL list each term with its aliases and definition, and SHALL include a rule instructing the Page Agent to use the canonical term name when referring to these concepts.

When no glossary is available, the section SHALL be omitted entirely, preserving current behavior.

#### Scenario: Glossary injected when present
- **GIVEN** a glossary with term "Repo Map" (aliases: "代码库地图")
- **WHEN** `buildPagePrompt(page, facts, glossary)` is called
- **THEN** the prompt contains the term, its alias, definition, and the canonical-naming rule, positioned before the Facts section

#### Scenario: Glossary omitted when absent
- **WHEN** `buildPagePrompt(page, facts)` is called with no glossary
- **THEN** the prompt contains no 术语表 section and is otherwise unchanged
