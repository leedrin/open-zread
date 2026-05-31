## Why

`doc-comment-injection-facts` 已落地，Page Agent 现在能看到原作者注释。但 [`docs/next-phase-improvements.md`](../../../docs/next-phase-improvements.md) 指出的另外几个结构性盲点仍未解决：

1. **盲点 1（信息孤岛）**：N 个 Page Agent 并发生成，互不知道对方写了什么，导致术语漂移、职责重叠、引用断链。缺少一份项目级共识。
2. **盲点 4（无自审与反馈环）**：每个页面一个 Agent 一次成型即写盘。`quality-audit.ts` 已能算出 `basic/standard/professional` 分级，但只 log 数字，没有反馈到生成管线；Facts 覆盖率也没有被纳入质量判定。
3. 核心模块（占 20% 数量、80% 价值）和简单模块共用单 Agent 单轮流程，深度不足。

本 change 将这四项改进（对应 next-phase 文档的 P0-2、P0-3、P1-5、P1-6）合并实施，因为它们共享同一个"质量反馈环 + 跨页共识"主题且改动点高度耦合：覆盖率校验（P1-5）产出的指标正是自动重生（P0-3）的触发依据。

## What Changes

### 1. Blueprint 副产出 Glossary（next-phase P0-2）

- Catalog Agent 在产出 wiki.json 时同时产出 `glossary[]`（术语、别名、定义、规范页面）
- `GenerateBlueprintTool` 接受并持久化 `glossary` 到 `WikiOutput`
- `buildPagePrompt()` 注入项目术语表，强制 Page Agent 使用统一命名

### 2. Coverage Verifier 事后校验（next-phase P1-5）

- `quality-audit.ts` 新增 `analyzeFactsCoverage()`：统计每篇文档对其 Facts 中导出符号的提及率
- `DocMetrics` 增加 `exportsCovered / exportsTotal / uncoveredExports`
- `analyzeWiki()` 接受可选 `factsMap`，将覆盖率纳入评分

### 3. Quality Audit → 自动重生反馈环（next-phase P0-3）

- `generateWikiContent()` 在 finalize 跑完 audit 后，对 `level === 'basic'` 或覆盖率低于阈值的页面触发**有限次**重生
- 新增 `regenerate-with-feedback.ts` Prompt：把 `DocMetrics` 的不足点（缺图、缺溯源、行数不足、未覆盖的 export）作为反馈注入

### 4. 角色化 Page Agent 双轮模式（next-phase P1-6）

- 仅对 `level === 'Advanced'` 的核心页面启用双轮：Architect Agent 写骨架 → Reviewer Agent 对照 Facts 校验补全
- 非核心页面维持现有单轮流程

## Capabilities

### New Capabilities

- `blueprint-glossary`: Catalog 阶段产出项目术语表并注入每个 Page Agent，建立跨页命名共识
- `quality-regeneration-loop`: 基于审计结果对低质量页面进行有限次自动重生的反馈环
- `dual-pass-page-agent`: 核心页面的 Architect → Reviewer 双轮生成模式

### Modified Capabilities

- `quality-audit`（隶属已归档的 `nium-wiki-p1-improvements`）：新增 Facts 覆盖率指标 `coverage-verifier`，纳入评分体系

## Impact

**类型变更：**

- `packages/types/src/wiki.ts` — 新增 `GlossaryTerm` 接口；`WikiOutput.glossary?: GlossaryTerm[]`

**Glossary（P0-2）：**

- `packages/orchestrator/src/prompts/generate-catalog.ts` — 要求 Agent 产出 glossary
- `packages/orchestrator/src/tools/output-tools.ts` — `GenerateBlueprintTool` 接受 glossary
- `packages/utils/src/output/wiki-content.ts` — `generateWikiJson()` 持久化 glossary
- `packages/orchestrator/src/wiki/generate-wiki.ts` — `buildPagePrompt()` 注入 glossary

**Coverage Verifier（P1-5）：**

- `packages/utils/src/output/quality-audit.ts` — 新增 `analyzeFactsCoverage()`，扩展 `DocMetrics`、`analyzeDoc()`、`analyzeWiki()`、`scoreByComplexity()`
- `packages/utils/src/output/finalize.ts` — `finalizeWiki()` 接受并透传 `factsMap`

**Regeneration Loop（P0-3）：**

- `packages/orchestrator/src/prompts/regenerate-with-feedback.ts` — 新增反馈 Prompt 构造器
- `packages/orchestrator/src/wiki/generate-wiki.ts` — finalize 后的重生循环
- `packages/orchestrator/src/wiki/types.ts` — `GenerateWikiOptions` 新增 `maxRegenRounds?`、`regenThreshold?`

**Dual-pass（P1-6）：**

- `packages/orchestrator/src/prompts/architect-page.ts`、`reviewer-page.ts` — 新增双轮 Prompt
- `packages/orchestrator/src/wiki/generate-wiki.ts` — Advanced 页面走双轮分支

**向后兼容：** `glossary`、`factsMap`、`maxRegenRounds` 全部可选；不传时行为与当前完全一致。双轮模式仅对 Advanced 页面启用，可通过配置关闭。

## 来源

完整反思：[`docs/next-phase-improvements.md`](../../../docs/next-phase-improvements.md) 改进项 P0-2、P0-3、P1-5、P1-6
