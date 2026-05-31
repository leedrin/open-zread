## ADDED Requirements

### Requirement: 重生反馈 Prompt 构造器
The system SHALL provide `buildRegeneratePrompt(page: WikiPage, metrics: DocMetrics, facts?: PageFacts): string` in `packages/orchestrator/src/prompts/regenerate-with-feedback.ts`.

The prompt SHALL be based on the standard page prompt and SHALL prepend a feedback section listing ONLY the dimensions that failed to meet targets, derived dynamically from `metrics`:

- insufficient diagrams (count vs. target)
- missing code-block source links (`codeBlockSourceLinks` vs. `codeBlockCount`)
- insufficient line count (`lineCount` vs. target)
- uncovered exports (`uncoveredExports` list)
- mermaid syntax errors (`mermaidIssues` with severity error)

The prompt SHALL instruct the agent to augment the existing content and preserve already-correct parts rather than rewriting the whole document.

#### Scenario: Feedback lists only failing dimensions
- **GIVEN** metrics with 1 diagram (target 2), full source links, sufficient lines
- **WHEN** `buildRegeneratePrompt()` is called
- **THEN** the feedback section mentions the diagram shortfall but NOT source links or line count

#### Scenario: Uncovered exports listed
- **GIVEN** metrics with `uncoveredExports: ["foo", "bar"]`
- **WHEN** `buildRegeneratePrompt()` is called
- **THEN** the feedback section lists `foo` and `bar` as APIs requiring documentation

#### Scenario: Preserve-correct instruction present
- **WHEN** `buildRegeneratePrompt()` is called
- **THEN** the prompt instructs the agent to keep already-correct content unchanged

### Requirement: 自动重生触发条件
After the finalize audit completes, `generateWikiContent()` SHALL identify pages eligible for regeneration where either:

- the doc's quality level is `basic`, OR
- `exportsTotal > 0` AND coverage (`exportsCovered / exportsTotal`) `< regenThreshold`

`regenThreshold` SHALL default to 0.6.

#### Scenario: Basic page eligible
- **GIVEN** a page audited as `basic`
- **WHEN** regeneration eligibility is evaluated
- **THEN** the page is selected for regeneration

#### Scenario: Low-coverage page eligible
- **GIVEN** a page with coverage 0.4 and `regenThreshold` 0.6
- **WHEN** eligibility is evaluated
- **THEN** the page is selected for regeneration

#### Scenario: Professional page skipped
- **GIVEN** a page audited as `professional` with coverage 0.9
- **WHEN** eligibility is evaluated
- **THEN** the page is NOT regenerated

### Requirement: 重生轮次上限
`GenerateWikiOptions` SHALL include optional `maxRegenRounds?: number` (default 1) and `regenThreshold?: number` (default 0.6).

The regeneration loop SHALL run at most `maxRegenRounds` rounds. When `maxRegenRounds` is 0, regeneration SHALL be disabled entirely and behavior SHALL match the pre-change pipeline.

Within each round, eligible pages SHALL be regenerated using `buildRegeneratePrompt()` and then re-audited. The loop SHALL stop early when no eligible pages remain.

#### Scenario: Default single round
- **GIVEN** `maxRegenRounds` unset (default 1)
- **WHEN** there are basic pages after initial generation
- **THEN** those pages are regenerated exactly once, then re-audited

#### Scenario: Regeneration disabled
- **GIVEN** `maxRegenRounds: 0`
- **WHEN** generation completes
- **THEN** no regeneration occurs and the result matches current behavior

#### Scenario: Early stop when none eligible
- **GIVEN** `maxRegenRounds: 3` but all pages are professional after round 1
- **WHEN** the loop evaluates round 2
- **THEN** it stops without further regeneration

#### Scenario: Bounded despite persistent low quality
- **GIVEN** `maxRegenRounds: 1` and a page still `basic` after regeneration
- **WHEN** the round completes
- **THEN** the loop stops and does not regenerate the page again

### Requirement: 重生结果反馈到 WikiResult
The regeneration activity SHALL be reflected in the final result and logs, reporting how many pages were regenerated and the final quality distribution.

#### Scenario: Regeneration reported
- **WHEN** 3 pages are regenerated
- **THEN** the audit log reports the regenerated count and the post-regeneration professional/standard/basic distribution
