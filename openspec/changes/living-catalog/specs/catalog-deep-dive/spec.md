## ADDED Requirements

### Requirement: 主题深挖生成子目录
The system SHALL provide a deep-dive operation that takes a selected topic (a page or a scope) and runs the Catalog Agent in a scoped mode to produce a focused sub-catalog of child pages for that topic. Child pages SHALL inherit the parent's section/group context, carry `origin: 'ai'`, and be mergeable back into the main catalog.

#### Scenario: Deep-dive produces child pages
- **GIVEN** the user selects the page "技能系统" for deep-dive
- **WHEN** deep-dive runs
- **THEN** the Catalog Agent proposes multiple focused child pages under that topic

#### Scenario: Child pages inherit context
- **WHEN** deep-dive produces child pages for a topic in section "战斗与技能系统"
- **THEN** the child pages are placed in that section's context with `origin: 'ai'`

### Requirement: 深挖结果经合并回主目录
Deep-dive output SHALL be merged into the main catalog through the same reconciliation engine (catalog-reconciliation), so additions are reviewable and locked pages are protected.

#### Scenario: Deep-dive additions reviewed
- **WHEN** deep-dive proposes new child pages
- **THEN** they enter the merge review as ADD proposals before being written

#### Scenario: Locked parent protected during deep-dive
- **GIVEN** a locked parent page selected for deep-dive
- **WHEN** deep-dive runs
- **THEN** the parent page itself is not modified (only new children may be proposed)

### Requirement: 深挖约束与递归
Deep-dive SHALL constrain the Catalog Agent to anchor every child page to real source files (non-empty `associatedFiles`) and SHALL bound the number of child pages produced per invocation. A child page produced by deep-dive MAY itself be deep-dived (recursive) and MAY be locked or deleted like any other page.

#### Scenario: Children anchored to real files
- **WHEN** deep-dive proposes child pages
- **THEN** each proposed child has non-empty `associatedFiles`

#### Scenario: Child count bounded
- **WHEN** deep-dive runs once
- **THEN** the number of proposed child pages does not exceed the configured upper bound

#### Scenario: Recursive deep-dive
- **GIVEN** a child page produced by a previous deep-dive
- **WHEN** the user deep-dives that child
- **THEN** a further sub-catalog is proposed for it
