# Implementation Plan: diataxis-reader-personas

## Source
- Proposal: openspec/changes/diataxis-reader-personas/proposal.md
- Design: openspec/changes/diataxis-reader-personas/design.md
- Specs: openspec/changes/diataxis-reader-personas/specs/
  - diataxis-page-types/spec.md
  - tutorial-howto-tracks/spec.md
  - facts-driven-reference/spec.md
  - diataxis-sidebar-ordering/spec.md
- Tasks: openspec/changes/diataxis-reader-personas/tasks.md

## Execution Order

### Task 1: DocType 类型定义与导出
- Goal: 在 types 包中新增 `DocType` 联合类型和 `WikiPage.docType` 可选字段，确保 monorepo 类型检查通过
- Source tasks: tasks.md §1 (1.1–1.4)
- Design anchors: D1 (docType 与 level 正交)
- Changed files:
  - `packages/types/src/wiki.ts` — 新增 `DocType` 类型、`WikiPage.docType?: DocType`
  - `packages/types/src/index.ts` — 导出 `DocType`
- Validation: `bun run typecheck` 全仓库通过
- Depends on: none
- Notes: `DocType` 缺省为 `explanation`，缺省行为在消费侧（`page.docType ?? 'explanation'`）而非类型层强制

### Task 2: GenerateBlueprintTool 接受 docType
- Goal: 扩展 `GenerateBlueprintTool` inputSchema 使 Agent 可传 `docType`，并在 result summary 中报告 docType 分布
- Source tasks: tasks.md §2 (2.1–2.4)
- Design anchors: D2 (docType 决定 section 归属)、D3 (Catalog 双轴编排)
- Changed files:
  - `packages/orchestrator/src/tools/output-tools.ts` — inputSchema 增加 `docType` 属性、call() summary 增加 docType 分布统计
- Validation: `bun run typecheck && bun run lint` 通过
- Depends on: Task 1
- Notes: `generateWikiJson()` 已直接透传 `pages` 不做字段裁剪，docType 无需特殊处理；`docType` 在 inputSchema 中 optional

### Task 3: Reference 骨架渲染器
- Goal: 新增 `buildReferenceSkeleton(facts)` 从 PageFacts 确定性渲染 Markdown API 表格；新增 `buildReferencePrompt(page, facts)` 嵌入骨架并约束 LLM
- Source tasks: tasks.md §4 (4.1–4.4)
- Design anchors: D5 (Reference 由 Facts 渲染骨架 + LLM 填充)
- Changed files:
  - `packages/orchestrator/src/wiki/reference-skeleton.ts` (新建) — `buildReferenceSkeleton()` + `buildReferencePrompt()`
- Validation: `bun run typecheck` 通过；导出函数签名与后续 Task 6 路由一致
- Depends on: Task 1
- Notes: 空 exports 时无行；source link 格式 `file#Lline`（line 缺省时不带锚点）；`buildReferencePrompt` 内嵌入 reference-quadrant 戒律（禁止叙述、禁止增删 API）

### Task 4: 三套象限 Prompt 模板
- Goal: 新增 `tutorial-page.ts`、`howto-page.ts`、`reference-page.ts` 三套写作模板，遵循 docusaurus 象限戒律；每套模板包含跨象限互链指令
- Source tasks: tasks.md §3 (3.1–3.5)
- Design anchors: D4 (三套象限 Prompt)、D7 (跨象限互链)
- Changed files:
  - `packages/orchestrator/src/prompts/tutorial-page.ts` (新建) — Tutorial 戒律 + 互链指令
  - `packages/orchestrator/src/prompts/howto-page.ts` (新建) — How-to 戒律 + 互链指令
  - `packages/orchestrator/src/prompts/reference-page.ts` (新建) — Reference 戒律 + 互链指令
  - `packages/orchestrator/src/prompts/page-agent.ts` — 不修改（保持 Explanation 模板），但需确认末尾有链接到 Tutorial 的互链指令（D7 要求 Explanation → Tutorial）
- Validation: `bun run typecheck && bun run lint` 通过；模板导出为 string（与 `page-agent.ts` 的 `export default string` 一致）
- Depends on: none
- Notes: 每套模板复用现有 Facts/Glossary 段落格式（在 Task 5 的 builder 中注入，模板本身只负责象限戒律和互链指令）

### Task 5: Prompt Builder 函数（Tutorial / How-to / Reference）
- Goal: 在 generate-wiki.ts 或独立模块中新增 `buildTutorialPrompt()`、`buildHowToPrompt()`、确认 `buildReferencePrompt()`（已在 Task 3），复用 `buildGlossarySection()` 和 Facts 段落渲染
- Source tasks: tasks.md §5 (5.1–5.3)
- Design anchors: D4、D5、D7
- Changed files:
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — 新增 `buildTutorialPrompt()`、`buildHowToPrompt()`（或在新建的 `packages/orchestrator/src/wiki/prompt-builders.ts` 中）
- Validation: `bun run typecheck && bun run lint` 通过
- Depends on: Task 3, Task 4
- Notes: 所有 builder 共享 `buildGlossarySection()` 和 Facts 段落渲染（复用现有 `buildPagePrompt` 中的逻辑，可提取为共享 helper）；Tutorial/How-to 的 facts 参数可选

### Task 6: 生成路由分发（docType switch）
- Goal: 在 `generateWikiContent()` 的 page task 中按 `page.docType ?? 'explanation'` 分发到对应 prompt builder；Reference 不走 dual-pass
- Source tasks: tasks.md §6 (6.1–6.6)
- Design anchors: D8 (生成路由分发)
- Changed files:
  - `packages/orchestrator/src/wiki/generate-wiki.ts` — 在 `limit(async () => { ... })` 内新增 `switch (page.docType ?? 'explanation')` 分发逻辑；原 `isIncremental` / `page.level === 'Advanced'` 分支仅在 `explanation` case 下触发
- Validation: `bun run typecheck && bun run lint` 通过
- Depends on: Task 5
- Notes: 重生环（regeneration loop）使用 `buildRegeneratePrompt` 对所有 docType 一视同仁，不按 docType 重选模板（D8 明确要求）；Reference 即使 level=Advanced 也不走 dual-pass

### Task 7: Catalog 双轴编排 Prompt
- Goal: 更新 `generate-catalog.ts` Prompt，要求 Blueprint Agent 在功能域 Explanation 页之外额外产出 Tutorial 轨、How-to 轨、Reference 轨，使用固定 section 名
- Source tasks: tasks.md §7 (7.1–7.4)
- Design anchors: D2 (混合编排)、D3 (Catalog 双轴编排)
- Changed files:
  - `packages/orchestrator/src/prompts/generate-catalog.ts` — 新增双轴编排指令、固定 section 名（`上手教程`/`操作指南`/`API 参考`）、JSON 示例含 docType、How-to 必须锚定真实文件
- Validation: `bun run typecheck && bun run lint` 通过
- Depends on: Task 2
- Notes: How-to 轨允许为空（无可识别工作流时不产出）；Tutorial 通常 1 条序列；Reference 按导出丰富的模块划分

### Task 8: Diátaxis 侧边栏排序
- Goal: `generateSidebar()` 按读者旅程排序 section：上手教程=0、操作指南=1、功能域=2..N（保持原序）、API 参考=99
- Source tasks: tasks.md §8 (8.1–8.3)
- Design anchors: D6 (侧边栏 Diátaxis 读者旅程排序)
- Changed files:
  - `packages/utils/src/output/finalize.ts` — `generateSidebar()` 函数修改：排序 sections Map 的迭代顺序
- Validation: `bun run typecheck && bun run lint` 通过
- Depends on: none
- Notes: 纯功能域 wiki（无 track sections）行为不变；未知 section 维持插入序（居 2..N 区间）

### Task 9: 单元测试
- Goal: 覆盖核心新增逻辑：reference-skeleton、prompt builders、路由分发、sidebar 排序、blueprint tool docType 持久化
- Source tasks: tasks.md §9 (9.1–9.7)
- Design anchors: D5、D6、D8
- Changed files:
  - `packages/orchestrator/src/wiki/__tests__/reference-skeleton.test.ts` (新建，to confirm)
  - `packages/orchestrator/src/wiki/__tests__/routing.test.ts` (新建，to confirm)
  - `packages/utils/src/output/__tests__/finalize.test.ts` (新建或追加，to confirm)
  - `packages/orchestrator/src/tools/__tests__/output-tools.test.ts` (新建或追加，to confirm)
- Validation: 现有测试框架执行通过（bun test）
- Depends on: Task 3, Task 5, Task 6, Task 8
- Notes: 测试文件路径需确认现有 __tests__ 目录结构；参考 `packages/orchestrator/src/prompts/__tests__/` 的现有模式

### Task 10: 全量验证
- Goal: monorepo 类型检查、lint、现有测试全部通过
- Source tasks: tasks.md §10 (10.1–10.3)
- Design anchors: 全局
- Changed files: 无（验证性任务）
- Validation: `bun run typecheck && bun run lint && bun test`（按 packages 逐包）
- Depends on: Task 1–9
- Notes: 手动验证项（10.4–10.7）由用户执行 `bun run dev` 确认
