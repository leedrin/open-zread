## ADDED Requirements

### Requirement: 快照源路径修复
`createVersionSnapshot()` SHALL copy from the real wiki content directory (`getWikiDir()` = `.open-zread/wiki`) rather than the never-populated `.open-zread/wiki/current/`. The copy SHALL preserve the `<section>/` subdirectory structure and SHALL exclude the `versions/` subdirectory (to avoid recursive nesting) and the `cache/` directory.

#### Scenario: Snapshot copies real content
- **GIVEN** a generated wiki with section subdirectories under `.open-zread/wiki`
- **WHEN** `createVersionSnapshot()` runs
- **THEN** the snapshot contains the section subdirectories and their `.md` files

#### Scenario: versions excluded from snapshot
- **GIVEN** an existing `.open-zread/wiki/versions/` directory
- **WHEN** `createVersionSnapshot()` runs
- **THEN** the new snapshot does NOT contain a nested `versions/` directory

### Requirement: 生成成功后创建快照
After a successful generation (full or incremental), the orchestration SHALL invoke `createVersionSnapshot()`, producing `.open-zread/wiki/versions/<date>_<time>_<commit>/`. Snapshot creation SHALL NOT run for failed or aborted generations.

#### Scenario: Snapshot created on success
- **GIVEN** a generation that completes successfully
- **WHEN** it finishes
- **THEN** a new dated snapshot directory appears under `.open-zread/wiki/versions/`

#### Scenario: No snapshot on failure
- **GIVEN** a generation that fails
- **WHEN** it aborts
- **THEN** no new snapshot directory is created

### Requirement: 快照失败不阻断
A failure during `createVersionSnapshot()` SHALL be caught and logged as a warning, and SHALL NOT fail or roll back the completed generation.

#### Scenario: Snapshot error is non-blocking
- **GIVEN** a generation that succeeds but the snapshot copy throws (e.g., disk error)
- **WHEN** the snapshot step runs
- **THEN** the error is logged as a warning and the generation result is still reported as successful

### Requirement: 移除错配的 WikiStore 写盘路径
The orphaned `WikiStore` abstraction that writes to `.open-zread/wiki/current/<file>` SHALL be removed or reconciled so that no code writes wiki pages to a `current/` path inconsistent with the real `<section>/` write location used by `WritePageTool`.

#### Scenario: No current/ write path remains
- **WHEN** the codebase is searched for wiki page writes
- **THEN** there is no active write to `.open-zread/wiki/current/`, and `WikiStore` is either removed or delegates to the corrected snapshot logic
