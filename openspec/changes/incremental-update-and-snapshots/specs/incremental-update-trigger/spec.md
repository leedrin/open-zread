## ADDED Requirements

### Requirement: 生成前构建 IncrementalPlan
The incremental update flow SHALL, before content generation, build an `IncrementalPlan` by calling `buildIncrementalPlan({ cached, current, symbols, wikiPath, pages })` where `cached` is the previously saved manifest (`loadCachedManifest()`), `current` is a fresh scan, `symbols` is the parsed/cached symbol manifest, and `pages` come from the existing `wiki.json`.

The resulting plan SHALL be passed to `generateWikiContent({ pages, symbols, incrementalPlan })`.

#### Scenario: Plan built and passed
- **GIVEN** an existing wiki.json and a prior cached manifest
- **WHEN** the incremental flow runs after some source files changed
- **THEN** `buildIncrementalPlan` is invoked and the returned plan is passed to `generateWikiContent`

#### Scenario: Only affected docs regenerated
- **GIVEN** a plan whose `affectedDocs` contains 3 pages out of 26
- **WHEN** `generateWikiContent` runs with that plan
- **THEN** only those 3 pages are regenerated (the existing incremental consumer branch is exercised)

### Requirement: symbols 接线
All call sites of `generateWikiContent(...)` in the CLI SHALL pass `symbols` (from `loadCachedSymbols()` or `parseFiles()`), enabling Facts-First extraction and supplying the symbol input the incremental plan requires.

#### Scenario: Facts-First enabled in full generation
- **WHEN** a full content generation runs from the CLI
- **THEN** `generateWikiContent` receives a non-empty `symbols` and per-page Facts are extracted

#### Scenario: Symbols available to incremental plan
- **WHEN** the incremental flow builds a plan
- **THEN** the symbols passed to `buildIncrementalPlan` reflect the current source (parsed or freshness-checked cache)

### Requirement: 缓存基线成功后保存
`saveCachedManifest(current)` SHALL be called only after a successful generation (full or incremental), not at scan time, so that a failed or aborted run does not advance the baseline.

#### Scenario: Baseline advances on success
- **GIVEN** a generation that completes successfully
- **WHEN** it finishes
- **THEN** the cached manifest is updated to the current scan

#### Scenario: Baseline preserved on failure
- **GIVEN** a generation that fails midway
- **WHEN** it aborts
- **THEN** the cached manifest retains the previous baseline, so the next run re-diffs the same changes

### Requirement: 增量降级与无变更处理
When no prior cached manifest exists, the incremental flow SHALL degrade gracefully (fall back to full generation or prompt the user). When the plan's `affectedDocs` is empty, the flow SHALL inform the user that there are no source changes since the last generation and SHALL NOT run generation.

#### Scenario: No baseline degrades to full
- **GIVEN** no cached manifest (first run or cache lost)
- **WHEN** the incremental flow starts
- **THEN** it degrades to full generation or prompts the user, without crashing

#### Scenario: No changes short-circuits
- **GIVEN** a valid baseline and zero changed source files
- **WHEN** the incremental flow builds the plan
- **THEN** the user is told there are no changes and no pages are regenerated
