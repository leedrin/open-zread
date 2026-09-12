## ADDED Requirements

### Requirement: TUI catalog 编辑器视图
The system SHALL provide an interactive Ink TUI catalog editor that displays the catalog as a tree of section → group → page and allows the user to edit it in place. The editor SHALL be reachable from the wiki home menu when a `wiki.json` exists.

#### Scenario: Editor lists the catalog tree
- **GIVEN** an existing catalog with multiple sections and pages
- **WHEN** the user opens the catalog editor
- **THEN** the sections, groups, and pages are shown as a navigable tree

### Requirement: 页面与章节的增改删
The editor SHALL support: adding a new page, renaming a page/section, moving a page to another section/group, and deleting a page (soft-delete → `status: 'tombstone'`). Newly added pages SHALL have `origin: 'human'` and a fresh `id`.

#### Scenario: Add a human page
- **WHEN** the user adds a new page in the editor
- **THEN** the page has `origin: 'human'`, a unique `id`, `status: 'active'`

#### Scenario: Delete is soft
- **WHEN** the user deletes a page
- **THEN** the page's `status` becomes `'tombstone'` (it remains in `wiki.json`)

#### Scenario: Rename keeps identity
- **WHEN** the user renames a page
- **THEN** the page `id` is unchanged and only the title (and optionally slug) updates

### Requirement: 锁定切换（收藏保留）
The editor SHALL allow toggling a page's `locked` flag. The locked state SHALL be persisted in `wiki.json`.

#### Scenario: Lock a page
- **WHEN** the user toggles lock on a page
- **THEN** the page's `locked` becomes `true` and is persisted

### Requirement: depth 设置
The editor SHALL allow setting a page's `depth` to `'standard'` or `'deep'`.

#### Scenario: Mark a page deep
- **WHEN** the user sets a page to deep
- **THEN** the page's `depth` becomes `'deep'`

### Requirement: 保存后重跑 finalize
On saving edits, the editor SHALL write the updated catalog to `wiki.json` and re-run finalize so derived artifacts (`_sidebar.md`, `source-files-index.json`) reflect the edits.

#### Scenario: Edits reflected in sidebar
- **GIVEN** the user moved a page to a new section and saved
- **WHEN** finalize re-runs
- **THEN** `_sidebar.md` shows the page under the new section

#### Scenario: Editor reuses node operations
- **WHEN** the editor adds/updates/removes a node
- **THEN** it does so through the shared catalog node operations module (same ops used by reconciliation)
