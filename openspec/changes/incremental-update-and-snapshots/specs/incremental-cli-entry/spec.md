## ADDED Requirements

### Requirement: 首页"增量更新"菜单项
The wiki home menu (`wiki-home/index.tsx`) SHALL show an "增量更新" item with value `incremental` when an existing wiki is fully generated (`progress.generated === progress.total`). The item SHALL appear alongside `manage` and `browse`, and SHALL be distinct from `force` (full regeneration).

#### Scenario: Incremental shown when wiki complete
- **GIVEN** a wiki.json exists and all pages are generated
- **WHEN** the home menu renders
- **THEN** an "增量更新" item with value `incremental` is present

#### Scenario: Incremental hidden when incomplete
- **GIVEN** a wiki.json exists but some pages are missing
- **WHEN** the home menu renders
- **THEN** the "增量更新" item is NOT shown (continue is shown instead)

#### Scenario: Incremental hidden when no wiki
- **GIVEN** no wiki.json
- **WHEN** the home menu renders
- **THEN** only the generate/config/exit options apply (no incremental item)

### Requirement: incremental 生成模式
The wiki-generate view (`wiki-generate/index.tsx`) SHALL accept `mode=incremental` in its mode union and route it to the incremental orchestration (load existing pages → diff → regenerate affected), distinct from `generate`/`continue`/`force`/`manage`.

#### Scenario: Mode routed to incremental flow
- **WHEN** the view is navigated with `mode=incremental`
- **THEN** the incremental orchestration runs (not full generation)

### Requirement: 增量入口国际化文案
The i18n translation tables (zh-CN and en-US) SHALL include the keys used by the incremental entry (e.g., `wiki.incremental`, and any status/no-change messages).

#### Scenario: zh-CN label present
- **WHEN** the locale is zh-CN
- **THEN** `wiki.incremental` resolves to a Chinese label (e.g., "增量更新")

#### Scenario: en-US label present
- **WHEN** the locale is en-US
- **THEN** `wiki.incremental` resolves to an English label (e.g., "Incremental update")
