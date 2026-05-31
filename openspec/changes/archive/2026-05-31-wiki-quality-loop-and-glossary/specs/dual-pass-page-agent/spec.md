## ADDED Requirements

### Requirement: Architect Prompt
The system SHALL provide an architect-phase prompt (`packages/orchestrator/src/prompts/architect-page.ts`) for the first pass of dual-pass generation.

The architect prompt SHALL focus on: architectural prose, Mermaid diagrams, module decomposition, and design philosophy. It SHALL receive the page's Facts and Glossary, and SHALL write the initial document skeleton.

#### Scenario: Architect produces skeleton
- **WHEN** the Architect Agent runs for an Advanced page
- **THEN** it writes a document with architecture narrative and diagrams, using `write_page`

### Requirement: Reviewer Prompt
The system SHALL provide a reviewer-phase prompt (`packages/orchestrator/src/prompts/reviewer-page.ts`) for the second pass.

The reviewer prompt SHALL receive the architect's output document and the page's Facts (emphasizing completeness), and SHALL: verify API coverage against Facts, add missing code examples and source links, and correct naming consistency against the Glossary.

The reviewer SHALL be instructed to augment and correct rather than rewrite already-correct content, and SHALL have access to `read_page` to read the existing document first.

#### Scenario: Reviewer fills coverage gaps
- **GIVEN** an architect output missing several Facts exports
- **WHEN** the Reviewer Agent runs
- **THEN** it adds documentation for the missing exports and overwrites the final document

#### Scenario: Reviewer preserves correct content
- **WHEN** the Reviewer Agent runs on a mostly-complete document
- **THEN** it preserves the correct sections and only augments gaps

### Requirement: 双轮模式仅对 Advanced 页面启用
`generateWikiContent()` SHALL route pages with `level === 'Advanced'` through dual-pass generation (Architect then Reviewer). Pages with other levels SHALL use the existing single-pass generation.

The Architect Agent SHALL run with `maxTurns: 30`; the Reviewer Agent SHALL run with `maxTurns: 20`. The Reviewer SHALL use the tool set `[FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool]`.

#### Scenario: Advanced page uses dual-pass
- **GIVEN** a page with `level: 'Advanced'`
- **WHEN** it is generated
- **THEN** an Architect Agent runs first, followed by a Reviewer Agent

#### Scenario: Intermediate page uses single-pass
- **GIVEN** a page with `level: 'Intermediate'`
- **WHEN** it is generated
- **THEN** a single standard Page Agent runs (no Reviewer)

#### Scenario: Beginner page uses single-pass
- **GIVEN** a page with `level: 'Beginner'`
- **WHEN** it is generated
- **THEN** a single standard Page Agent runs

### Requirement: 双轮与重生环正交
Dual-pass SHALL be an initial-generation strategy and the regeneration loop SHALL be a post-audit remediation strategy. An Advanced page that remains `basic` after dual-pass SHALL still be eligible for the regeneration loop, but regeneration SHALL use the single-agent `buildRegeneratePrompt()` and SHALL NOT re-run dual-pass.

#### Scenario: Advanced page dual-pass then regen
- **GIVEN** an Advanced page that is still `basic` after dual-pass generation
- **WHEN** the regeneration loop runs
- **THEN** the page is regenerated with the single-agent feedback prompt, not another dual-pass

#### Scenario: Regeneration never triggers dual-pass
- **WHEN** any page enters the regeneration loop
- **THEN** it is processed by a single feedback-driven agent regardless of its level
