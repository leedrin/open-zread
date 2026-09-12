## ADDED Requirements

### Requirement: 重新生成产出提案而非覆盖
A "regenerate (merge)" action SHALL run the Catalog Agent to produce a fresh catalog proposal (REMOTE) and SHALL NOT overwrite the live `wiki.json` directly. The proposal SHALL be fed into a three-way merge.

#### Scenario: Regenerate does not clobber
- **GIVEN** a live catalog with user edits
- **WHEN** the user runs regenerate (merge)
- **THEN** the live `wiki.json` is not overwritten before the merge is reviewed and accepted

### Requirement: 三方合并身份对齐
The system SHALL compute a `CatalogMergePlan` from BASE × LOCAL × REMOTE, aligning nodes in the following priority order:

1. exact `id` match (native between LOCAL and BASE)
2. **concept-set match** — when a REMOTE page's `concepts` overlaps an existing page's `concepts` (shared primary term or Jaccard ≥ threshold), they SHALL be treated as the same node (REMOTE inherits the existing `id`)
3. `associatedFiles` fingerprint fallback (weak signal) when concepts are absent or do not match
4. otherwise the REMOTE page SHALL be treated as an addition

The concept channel SHALL take precedence over the file-fingerprint fallback. When neither concept nor fingerprint matches, the node SHALL degrade to an ADD/REMOVE proposal for review (never a silent overwrite).

- BASE = the `wiki.json` inside the most recent version snapshot (`versions/<...>/`)
- LOCAL = the current `wiki.json` (including user edits)
- REMOTE = the freshly generated proposal

#### Scenario: Renamed page aligned by concept
- **GIVEN** a BASE page owning concept "技能系统" and a REMOTE page owning the same concept but with a different title
- **WHEN** alignment runs
- **THEN** the REMOTE page is mapped to the existing `id` via the concept channel (an update, not add+remove)

#### Scenario: Concept channel beats fingerprint
- **GIVEN** a REMOTE page whose `concepts` match an existing page but whose `associatedFiles` drifted below the file threshold
- **WHEN** alignment runs
- **THEN** the pages are still matched by the concept channel

#### Scenario: Fingerprint fallback when concepts absent
- **GIVEN** a REMOTE page with no `concepts` but the same associatedFiles as an existing page
- **WHEN** alignment runs
- **THEN** the REMOTE page is mapped to the existing `id` via the fingerprint fallback

#### Scenario: No snapshot falls back to current as BASE
- **GIVEN** no version snapshot exists
- **WHEN** reconciliation runs
- **THEN** the current catalog is used as BASE (degrading to "full proposal under lock protection")

### Requirement: 术语锚定命名
The Catalog Agent SHALL generate page titles/slugs anchored to the Glossary's canonical terms (collapsing aliases to the canonical name) and SHALL record each page's owned canonical terms in `concepts`. This minimizes title drift across regenerations.

#### Scenario: Canonical term used for title
- **GIVEN** a glossary with canonical term "技能系统" and alias "技能与战斗系统"
- **WHEN** the Catalog Agent names the corresponding page
- **THEN** it uses the canonical "技能系统" and records `concepts` including "技能系统"

### Requirement: 合并矩阵
The merge SHALL classify each aligned node per the matrix: AI-new → ADD; human-only (not in BASE) → KEEP; clean AI update (LOCAL=BASE, REMOTE differs) → APPLY; both changed (LOCAL≠BASE and REMOTE differs) → CONFLICT; user tombstoned + REMOTE present → RESPECT DELETE; AI dropped (missing in REMOTE) → propose REMOVE.

#### Scenario: Clean AI update applies
- **GIVEN** a page unchanged locally since BASE, changed in REMOTE, not locked
- **WHEN** the plan is computed
- **THEN** the node is classified APPLY

#### Scenario: User-edited + AI-changed conflicts
- **GIVEN** a page edited locally and also changed in REMOTE
- **WHEN** the plan is computed
- **THEN** the node is classified CONFLICT

#### Scenario: Human page preserved
- **GIVEN** a page with `origin: 'human'` not present in BASE/REMOTE
- **WHEN** the plan is computed
- **THEN** the node is classified KEEP (never removed by the merge)

#### Scenario: User deletion respected
- **GIVEN** a BASE page the user tombstoned, re-proposed in REMOTE
- **WHEN** the plan is computed
- **THEN** the deletion is respected unless the user re-accepts it in review

### Requirement: locked 是硬保证
Any page with `locked: true` SHALL be completely immutable during reconciliation: its content file, metadata, and position SHALL be preserved verbatim, any REMOTE changes targeting it SHALL be discarded, and it SHALL NOT be sent to content generation.

#### Scenario: Locked page ignores REMOTE
- **GIVEN** a locked page and a REMOTE proposal that changes its title and associatedFiles
- **WHEN** reconciliation runs
- **THEN** the locked page is unchanged and the REMOTE changes for it are discarded

#### Scenario: Locked page skipped by generation
- **WHEN** the merge result is generated
- **THEN** locked pages are not regenerated

### Requirement: TUI 冲突 review
The merge plan SHALL be presented in a TUI review view where the user accepts/rejects per node. Clean (non-conflict) updates MAY be batch-accepted; conflicts MUST be resolved individually. On confirmation, the system SHALL write the merged catalog to `wiki.json`, re-run finalize, and generate content only for added/accepted-updated pages (skipping locked and unchanged pages).

#### Scenario: Conflicts require explicit decision
- **GIVEN** a merge plan with 2 conflicts and 5 clean updates
- **WHEN** the user opens review
- **THEN** the 5 clean updates can be accepted in batch and the 2 conflicts must be decided individually

#### Scenario: Only affected pages regenerate
- **GIVEN** an accepted merge with 3 new pages and 1 accepted update
- **WHEN** generation runs after merge
- **THEN** only those 4 pages are generated; locked and unchanged pages are skipped

### Requirement: 修复 diataxis 迁移缺口
When REMOTE contains new structural tracks (e.g., Diátaxis tutorial/howto/reference pages) absent from an older LOCAL catalog, reconciliation SHALL surface them as ADD proposals so they can be merged in without discarding existing user content.

#### Scenario: New tracks merged into old wiki
- **GIVEN** an old catalog with only explanation pages and a REMOTE proposal that includes tutorial/howto/reference tracks
- **WHEN** reconciliation runs
- **THEN** the new track pages appear as ADD proposals and existing pages are preserved
