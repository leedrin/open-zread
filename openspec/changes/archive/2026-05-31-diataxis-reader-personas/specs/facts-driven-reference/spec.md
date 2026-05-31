## ADDED Requirements

### Requirement: Reference 骨架由 Facts 渲染
The system SHALL provide `buildReferenceSkeleton(facts: PageFacts): string` in `packages/orchestrator/src/wiki/reference-skeleton.ts` that deterministically renders a markdown API table from the page's Facts.

Each exported symbol in `facts.exports` SHALL produce one table row containing: the API name, its signature, its author doc comment (when present) as the initial description, and a source link (`file#Lline` when a line is present).

#### Scenario: One row per export
- **GIVEN** a PageFacts with 8 exports
- **WHEN** `buildReferenceSkeleton()` is called
- **THEN** the rendered table contains 8 API rows

#### Scenario: Doc comment used as description seed
- **GIVEN** an export with `doc: "构建三层 Repo Map"`
- **WHEN** the skeleton is rendered
- **THEN** that export's description cell starts from the doc text

#### Scenario: Source link rendered when line present
- **GIVEN** an export with `file: "a.ts"` and `line: 42`
- **WHEN** the skeleton is rendered
- **THEN** the row contains a source link to `a.ts#L42`

#### Scenario: Empty facts yields empty table
- **GIVEN** a PageFacts with no exports
- **WHEN** `buildReferenceSkeleton()` is called
- **THEN** the result contains no API rows

### Requirement: Reference Prompt 嵌入骨架并约束 LLM
The system SHALL provide `buildReferencePrompt(page, facts)` backed by `packages/orchestrator/src/prompts/reference-page.ts` that embeds the Facts-rendered skeleton and instructs the LLM to:

- preserve the table structure and the API list unchanged
- fill in the description column and add a minimal runnable example per API
- NOT add APIs absent from Facts, and NOT remove APIs present in Facts
- avoid narrative/tutorial prose (reference-quadrant rules)

#### Scenario: Skeleton embedded in prompt
- **WHEN** `buildReferencePrompt(page, facts)` is rendered
- **THEN** the prompt contains the rendered API table skeleton

#### Scenario: LLM constrained to Facts API set
- **WHEN** `buildReferencePrompt()` is rendered
- **THEN** the prompt forbids adding APIs not in Facts and forbids removing APIs in Facts

#### Scenario: Reference forbids narrative
- **WHEN** `buildReferencePrompt()` is rendered
- **THEN** the prompt instructs against tutorial/explanation prose in the reference page

### Requirement: Reference 单轮生成
Reference pages SHALL be generated in a single pass and SHALL NOT use the Architect→Reviewer dual-pass, since structural completeness is guaranteed by the Facts skeleton.

#### Scenario: Reference does not dual-pass
- **GIVEN** a page with `docType: 'reference'` regardless of `level`
- **WHEN** it is generated
- **THEN** only a single agent pass runs
