## ADDED Requirements

### Requirement: Facts 覆盖率分析
The system SHALL provide `analyzeFactsCoverage(content: string, facts: PageFacts): { exportsTotal: number; exportsCovered: number; uncoveredExports: string[] }` in `quality-audit.ts`.

An export SHALL be considered "covered" when its `name` appears in the document content matched on a word boundary, case-sensitively.

When `facts` has no exports, `exportsTotal` SHALL be 0 and the document SHALL NOT be penalized for coverage.

#### Scenario: Export mentioned in prose
- **GIVEN** a doc containing "函数 `buildRepoMap` 负责构建地图"
- **WHEN** coverage is analyzed against a Facts containing export `buildRepoMap`
- **THEN** `buildRepoMap` is counted as covered

#### Scenario: Export not mentioned
- **GIVEN** a doc that never contains the string `computeTransitiveImpact`
- **WHEN** coverage is analyzed against a Facts containing that export
- **THEN** `computeTransitiveImpact` appears in `uncoveredExports`

#### Scenario: Word-boundary precision
- **GIVEN** a doc containing only `buildRepoMapInternal`
- **WHEN** coverage is analyzed for export `buildRepoMap`
- **THEN** `buildRepoMap` is NOT counted as covered (no word-boundary match)

#### Scenario: No facts means no penalty
- **GIVEN** a doc and a PageFacts with empty `exports`
- **WHEN** coverage is analyzed
- **THEN** `exportsTotal` is 0 and `exportsCovered` is 0

## MODIFIED Requirements

### Requirement: DocMetrics 携带覆盖率
`DocMetrics` SHALL include three new fields:

- `exportsTotal: number`
- `exportsCovered: number`
- `uncoveredExports: string[]`

`analyzeDoc(filePath, facts?)` SHALL accept an optional `facts` parameter and populate these fields. When `facts` is absent, `exportsTotal` SHALL be 0, `exportsCovered` SHALL be 0, and `uncoveredExports` SHALL be empty.

#### Scenario: analyzeDoc with facts
- **WHEN** `analyzeDoc(path, facts)` is called with a Facts of 10 exports, 7 mentioned
- **THEN** the metrics report `exportsTotal: 10`, `exportsCovered: 7`, and 3 names in `uncoveredExports`

#### Scenario: analyzeDoc without facts (backward compatible)
- **WHEN** `analyzeDoc(path)` is called with no facts
- **THEN** `exportsTotal` is 0 and existing metrics are unchanged

### Requirement: 覆盖率纳入质量评分
`scoreByComplexity()` SHALL incorporate a `coverageScore` into the total score:

- coverage ≥ 80% OR `exportsTotal === 0` → 3 points
- 60% ≤ coverage < 80% → 2 points
- coverage < 60% → 1 point

The coverage score SHALL be added to the existing dimensions (diagram, code block, source link, security, mermaid, length) before determining the `professional/standard/basic` level.

#### Scenario: High coverage boosts score
- **GIVEN** a doc covering 9/10 exports
- **WHEN** scored
- **THEN** the coverage dimension contributes 3 points

#### Scenario: Low coverage reduces score
- **GIVEN** a doc covering 4/10 exports
- **WHEN** scored
- **THEN** the coverage dimension contributes 1 point

#### Scenario: No-facts page not penalized
- **GIVEN** an overview page with no Facts exports
- **WHEN** scored
- **THEN** the coverage dimension contributes 3 points (full)

### Requirement: factsMap 透传到审计
`analyzeWiki(wikiPath, pages?, factsMap?)` SHALL accept an optional `factsMap: Map<string, PageFacts>` keyed by `page.file`. For each doc, it SHALL look up the corresponding Facts (via the same relative-file key used for `pageMap`) and pass it to `analyzeDoc()`.

`finalizeWiki(wikiPath, { pages, audit, factsMap })` SHALL accept and forward `factsMap` to `analyzeWiki()`.

`QualityReport.summary` SHALL include `totalExportsCovered` and `totalExports` aggregate counts.

#### Scenario: factsMap forwarded through finalize
- **WHEN** `finalizeWiki(dir, { pages, audit: true, factsMap })` is called
- **THEN** each doc's coverage metrics are computed using its matching Facts

#### Scenario: finalize without factsMap (backward compatible)
- **WHEN** `finalizeWiki(dir, { pages, audit: true })` is called with no factsMap
- **THEN** coverage metrics default to zero/full-score and existing audit behavior is preserved
