## ADDED Requirements

### Requirement: Catalog 双轴编排产出新轨道
The catalog generation prompt (`generate-catalog.ts`) SHALL instruct the Blueprint Agent to produce, in addition to the existing functional-domain Explanation pages:

1. one Tutorial track (a getting-started sequence) with `docType: 'tutorial'`
2. zero or more How-to guides with `docType: 'howto'`, each anchored to real entry files / scripts / tests
3. Reference pages with `docType: 'reference'` for modules with rich exported APIs

Domain Explanation pages SHALL keep their existing `section`/`group`; the new tracks SHALL use fixed section names.

#### Scenario: Tutorial track produced
- **WHEN** the Blueprint Agent analyzes a runnable project
- **THEN** it emits at least one page with `docType: 'tutorial'` describing how to get started

#### Scenario: How-to anchored to real tasks
- **WHEN** the Blueprint Agent emits a how-to page
- **THEN** the page has non-empty `associatedFiles` pointing to real entry points, scripts, or tests

#### Scenario: How-to track may be empty
- **WHEN** the project has no identifiable common workflows
- **THEN** the Blueprint Agent emits no how-to pages and the blueprint is still valid

### Requirement: 固定轨道 section 名
Tutorial pages SHALL use `section: "上手教程"`; How-to pages SHALL use `section: "操作指南"`; Reference pages SHALL use `section: "API 参考"`. Explanation pages SHALL retain their functional-domain section.

#### Scenario: Tutorial section fixed
- **WHEN** a tutorial page is produced
- **THEN** its `section` is `"上手教程"`

#### Scenario: Explanation section unchanged
- **WHEN** an explanation page is produced for the engine domain
- **THEN** its `section` remains the functional-domain name (e.g., `"引擎框架"`), not a fixed track name

### Requirement: Tutorial 写作模板
The system SHALL provide `buildTutorialPrompt(page, facts?, glossary?)` backed by `packages/orchestrator/src/prompts/tutorial-page.ts`, enforcing tutorial-quadrant rules:

- open with what the reader will BUILD, not what they will learn
- a single path with no "alternatively / you could also"
- every step produces visible output
- link to Explanation/Reference rather than embedding concepts

The template SHALL forbid tutorial anti-patterns (e.g., "首先理解 X 如何工作", "这很简单").

#### Scenario: Tutorial prompt enforces single path
- **WHEN** `buildTutorialPrompt()` is rendered
- **THEN** the prompt instructs a single path and forbids "alternatively" branches

#### Scenario: Tutorial prompt forbids embedded explanation
- **WHEN** `buildTutorialPrompt()` is rendered
- **THEN** the prompt instructs linking to Explanation instead of embedding "why it works"

### Requirement: How-to 写作模板
The system SHALL provide `buildHowToPrompt(page, facts?, glossary?)` backed by `packages/orchestrator/src/prompts/howto-page.ts`, enforcing how-to-quadrant rules:

- title in the form "如何[动词][对象]"
- assume reader competence, skip basics
- start from the goal, include a "你需要什么" prerequisites section
- include verification and troubleshooting sections

#### Scenario: How-to prompt enforces task title
- **WHEN** `buildHowToPrompt()` is rendered
- **THEN** the prompt instructs a "如何[动词][对象]" title format

#### Scenario: How-to prompt includes verification
- **WHEN** `buildHowToPrompt()` is rendered
- **THEN** the prompt requires a verification step and a troubleshooting section

### Requirement: 新模板复用 Facts 与 Glossary
The tutorial and how-to prompts SHALL inject the page's Facts section and the project Glossary section using the same mechanisms as the explanation prompt.

#### Scenario: Glossary injected into tutorial
- **GIVEN** a non-empty glossary
- **WHEN** `buildTutorialPrompt(page, facts, glossary)` is rendered
- **THEN** the prompt contains the glossary section and the canonical-naming rule
