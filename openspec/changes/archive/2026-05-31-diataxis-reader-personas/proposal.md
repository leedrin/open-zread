## Why

当前生成的 wiki（实测 `H:\Work\U3D_起航阿拉德\Client\Assets\.open-zread\wiki`，26 篇文档）全部按功能域分 section，但**内容形态高度单一——全是 Explanation（架构散文）**：连本应是 Tutorial 的"快速上手"开篇也是"项目定位与核心价值"+痛点叙述+架构图。这正是 [`docs/next-phase-improvements.md`](../../../docs/next-phase-improvements.md) 盲点 5 所述：所有页面共用 `page-agent.ts` 单一读者画像。已落地的 dual-pass 只是把同一个 Explanation 象限做得更深，无法补齐缺失的另外三个认知象限——这解释了"质量升了点但整体变化不大"的体感。

参考 `F:\nium-wiki\src\generation`（按文档类型 modules/api/guides/design 编排）与 `F:\docusaurus-skill`（Diátaxis 四象限 + 写作戒律），本 change 引入**读者画像分支生成**：保留功能域 section 作 Explanation 深潜（现有强项），额外新增上手教程轨、How-to 指南轨、Facts 驱动的 API 参考轨，让一份 wiki 同时服务"学习/操作/查阅/理解"四类读者。

## What Changes

- **WikiPage 新增 `docType` 字段**（`tutorial` | `howto` | `reference` | `explanation`），映射 Diátaxis 四象限；缺省为 `explanation`，保持向后兼容
- **Catalog 双轴编排**：在现有功能域 Explanation 页面之外，Catalog Agent 额外产出一条上手教程轨（getting-started 序列）、若干 How-to 指南（针对代码库中发现的常见任务），以及按主要模块划分的 Reference 页
- **保留 `page-agent.ts` 作为 Explanation（maintainer）模板**，新增三套象限专用 Prompt：`tutorial-page.ts`、`howto-page.ts`、`reference-page.ts`，各自遵循 docusaurus 的象限写作戒律（不混用象限）
- **Reference 由 Facts 确定性生成**：从已提取的 `PageFacts`（签名 + doc 注释 + 符号）渲染 API 表格骨架，LLM 仅填描述与示例，消除幻觉、保证完整覆盖
- **生成路由按 docType 分发**：tutorial/howto/reference 走各自模板，explanation 沿用现有单轮/dual-pass 逻辑
- **侧边栏按 Diátaxis 读者旅程排序**：上手教程(Learn) → 操作指南(Do) → 功能域深潜(Understand) → API 参考(Look up)；每页末尾跨象限互链，杜绝"死胡同"

## Capabilities

### New Capabilities
- `diataxis-page-types`: WikiPage 的 `docType` 字段、四象限模型定义，以及生成阶段按 docType 分发到对应 Prompt 模板的路由
- `tutorial-howto-tracks`: Catalog Agent 在功能域页面之外额外产出上手教程轨与 How-to 指南轨，及其专用写作模板
- `facts-driven-reference`: 从 PageFacts 确定性渲染 API 参考骨架、LLM 填充描述的 Reference 生成机制
- `diataxis-sidebar-ordering`: 侧边栏按 Diátaxis 读者旅程排序（教程→指南→域深潜→参考），并支持跨象限互链

### Modified Capabilities
<!-- 无：finalize-pipeline 等先前 spec 未提升到 openspec/specs/，侧边栏改动以新能力 diataxis-sidebar-ordering 表达 -->

## Impact

- **类型**：`packages/types/src/wiki.ts` — `WikiPage` 新增 `docType?`，新增 `DocType` 联合类型
- **Catalog**：`packages/orchestrator/src/prompts/generate-catalog.ts`（双轴编排指令）、`packages/orchestrator/src/tools/output-tools.ts`（`GenerateBlueprintTool` 接受 `docType`）
- **Prompt 模板**：新增 `tutorial-page.ts` / `howto-page.ts` / `reference-page.ts`，保留 `page-agent.ts`
- **生成路由**：`packages/orchestrator/src/wiki/generate-wiki.ts` — 按 docType 分发；新增 `reference-skeleton.ts` 从 Facts 渲染 API 表格
- **侧边栏**：`packages/utils/src/output/finalize.ts` — `generateSidebar()` Diátaxis 排序
- **向后兼容**：`docType` 可选，旧 wiki.json 无此字段时全部按 `explanation` 处理，行为与当前一致；不新增轨道时退化为现有功能域 wiki
