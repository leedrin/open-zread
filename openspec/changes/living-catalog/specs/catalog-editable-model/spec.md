## ADDED Requirements

### Requirement: WikiPage 稳定身份与策展元数据
`WikiPage` SHALL include the following fields:

- `id: string` — a stable identifier independent of title/slug, used as the merge key
- `origin: 'ai' | 'human'` — provenance of the page
- `locked: boolean` — hard protection flag (see catalog-reconciliation)
- `status: 'active' | 'tombstone'` — soft-delete state
- `depth?: 'standard' | 'deep'` — depth directive
- `concepts?: string[]` — the canonical glossary terms this page is the authoritative home for (the terms whose `GlossaryTerm.canonicalPage` points to this page)

`slug` SHALL remain for URL/file naming only and SHALL NOT be used as the identity key. A page MAY own multiple concepts (page→term is one-to-many; e.g., "技能与战斗" owns `["技能", "战斗"]`).

#### Scenario: New AI page carries provenance
- **WHEN** the Catalog Agent produces a page
- **THEN** the page has a unique `id`, `origin: 'ai'`, `locked: false`, `status: 'active'`

#### Scenario: Identity survives title change
- **GIVEN** a page with `id: X` and title "技能系统"
- **WHEN** the title is changed to "技能与战斗系统"
- **THEN** the page's `id` remains `X`

#### Scenario: A page owns multiple concepts
- **GIVEN** a page titled "技能与战斗"
- **WHEN** the Catalog Agent assigns its concepts
- **THEN** `concepts` may contain multiple terms such as `["技能", "战斗"]`

### Requirement: 旧 catalog 迁移补 id
When loading a `wiki.json` whose pages lack `id`/`origin`/`locked`/`status`, the system SHALL migrate them by assigning a stable `id` (derived deterministically from the existing `slug`), defaulting `origin: 'ai'`, `locked: false`, `status: 'active'`. Migration SHALL be idempotent.

#### Scenario: Legacy catalog gets ids
- **GIVEN** a `wiki.json` produced before this change (no `id` fields)
- **WHEN** it is loaded
- **THEN** every page receives a deterministic `id` and the defaulted metadata

#### Scenario: Migration is idempotent
- **WHEN** an already-migrated catalog is loaded again
- **THEN** ids and metadata are unchanged

### Requirement: finalize 尊重 tombstone
`finalize` SHALL exclude pages with `status: 'tombstone'` from generated artifacts: they SHALL NOT appear in `_sidebar.md`, SHALL NOT contribute to `source-files-index.json`, and SHALL NOT trigger content generation. Tombstoned pages SHALL remain recorded in `wiki.json`.

#### Scenario: Tombstoned page hidden from sidebar
- **GIVEN** a page with `status: 'tombstone'`
- **WHEN** `finalize` runs
- **THEN** the page is absent from `_sidebar.md` but still present in `wiki.json`

#### Scenario: Active pages unaffected
- **GIVEN** a mix of active and tombstoned pages
- **WHEN** `finalize` runs
- **THEN** only active pages appear in the derived artifacts

### Requirement: 持久化新字段
`generateWikiJson()` and the blueprint load path SHALL persist and round-trip `id`, `origin`, `locked`, `status`, and `depth` without loss.

#### Scenario: Round-trip preserves metadata
- **GIVEN** a catalog with a `locked: true`, `origin: 'human'` page
- **WHEN** it is written to `wiki.json` and read back
- **THEN** that page still has `locked: true` and `origin: 'human'`
