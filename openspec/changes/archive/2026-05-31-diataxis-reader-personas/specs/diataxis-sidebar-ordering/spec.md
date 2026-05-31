## ADDED Requirements

### Requirement: 侧边栏按 Diátaxis 读者旅程排序
`generateSidebar()` in `packages/utils/src/output/finalize.ts` SHALL order top-level sections by the reader journey Learn → Do → Understand → Look up using fixed track priorities:

| Section | Priority |
|---------|----------|
| `上手教程` (Tutorial / Learn) | 0 |
| `操作指南` (How-to / Do) | 1 |
| functional-domain sections (Explanation / Understand) | 2..N, preserving their current order |
| `API 参考` (Reference / Look up) | 99 |

Sections not matching a known track SHALL keep their existing insertion order within the 2..N band.

#### Scenario: Tutorial section first
- **GIVEN** a wiki containing `上手教程`, a domain section, and `API 参考`
- **WHEN** the sidebar is generated
- **THEN** `上手教程` appears before the domain section, which appears before `API 参考`

#### Scenario: Reference section last
- **GIVEN** a wiki with multiple domain sections and an `API 参考` section
- **WHEN** the sidebar is generated
- **THEN** `API 参考` appears after all domain sections

#### Scenario: Unknown sections keep relative order
- **GIVEN** two domain sections in a specific order with no track sections
- **WHEN** the sidebar is generated
- **THEN** those two sections keep their relative insertion order

### Requirement: 跨象限互链指令
Each quadrant prompt template SHALL instruct the agent to link forward to other quadrants at the end of the page, never dead-ending the reader:

- Tutorial → Explanation (deeper理解) and Reference (full API)
- How-to → Tutorial (prerequisite) and Reference (all options)
- Reference → How-to (walkthrough)
- Explanation → Tutorial (try it)

Link targets MAY use the Glossary `canonicalPage` and page slugs.

#### Scenario: Tutorial links forward
- **WHEN** `buildTutorialPrompt()` is rendered
- **THEN** the prompt instructs adding forward links to Explanation and Reference pages

#### Scenario: Reference links to how-to
- **WHEN** `buildReferencePrompt()` is rendered
- **THEN** the prompt instructs adding a forward link to a related How-to page

### Requirement: 排序向后兼容
When a wiki contains none of the fixed track sections (only functional-domain sections), `generateSidebar()` SHALL preserve the current insertion-order behavior.

#### Scenario: Domain-only wiki unchanged
- **GIVEN** a wiki with only functional-domain sections and no track sections
- **WHEN** the sidebar is generated
- **THEN** the output ordering matches the pre-change behavior
