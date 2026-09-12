## ADDED Requirements

### Requirement: 主题集合数据结构
The system SHALL define a `TopicScope` with `name: string`, `description?: string`, `pageIds: string[]`, and `createdAt: string`. A scope references pages by `id` and SHALL NOT copy page content.

#### Scenario: Scope references by id
- **WHEN** a scope is created from a selection of pages
- **THEN** it stores their `id` values, not their content

### Requirement: 保存主题集合
The editor SHALL allow saving the current selection of pages as a named `TopicScope` persisted to `.open-zread/wiki/scopes/<name>.json`.

#### Scenario: Save a themed collection
- **GIVEN** the user selected several combat-related pages
- **WHEN** the user saves them as scope "战斗系统深潜"
- **THEN** `.open-zread/wiki/scopes/战斗系统深潜.json` is written with those page ids

### Requirement: 读取与回放主题集合
The system SHALL list saved scopes and allow loading one to restore the corresponding page selection. Page ids in a scope that no longer exist SHALL be ignored gracefully.

#### Scenario: Load restores selection
- **GIVEN** a saved scope "战斗系统深潜"
- **WHEN** the user loads it
- **THEN** the referenced existing pages become the active selection

#### Scenario: Stale ids ignored
- **GIVEN** a scope referencing a page that was since deleted
- **WHEN** the scope is loaded
- **THEN** the missing page is skipped and the rest load without error

### Requirement: 集合驱动聚焦操作
A loaded scope SHALL be usable as the target of focused operations: regenerate-merge limited to the scope, or deep-dive entry (see catalog-deep-dive). Operations restricted to a scope SHALL NOT affect pages outside it.

#### Scenario: Scoped regeneration stays in scope
- **GIVEN** a loaded scope of 4 pages
- **WHEN** the user runs a scoped regenerate-merge
- **THEN** only those 4 pages participate; pages outside the scope are untouched
