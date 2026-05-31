## Context

当前 Wiki 生成管线（grounded 自实际代码）：

- `generateWikiCatalog(onEvent)`（`orchestrator.ts`）使用 `BLUEPRINT_TOOLS` 运行单个 Blueprint Agent，最终通过 `GenerateBlueprintTool` 调用 `generateWikiJson(pages, config, techStackSummary)`（`wiki-content.ts`）写出 `WikiOutput`。
- `loadWikiBlueprint()` 读回 `WikiOutput`，其 `pages` 进入 `generateWikiContent()`（`generate-wiki.ts`）。
- `generateWikiContent()` 用 `pLimit` 并发跑 N 个 Page Agent。每页通过 `extractPageFacts(page, symbols)` 得到 `PageFacts`，由 `buildPagePrompt(page, facts)` 注入。
- 全部页面完成后调用 `finalizeWiki(wikiDir, { pages, audit: true })`（`finalize.ts`），内部调用 `analyzeWiki(wikiPath, pages)`（`quality-audit.ts`）产出 `QualityReport`，目前**只 log，不回流**。
- `createAgent(options)`（`create-agent.ts`）是唯一的 Agent 执行入口，返回 `{ durationMs, tokenUsage }`。

四项改进都挂在这条主链上，互相耦合：覆盖率（P1-5）扩展 `QualityReport`，重生环（P0-3）消费 `QualityReport`，双轮（P1-6）替换单页生成分支，Glossary（P0-2）从 Catalog 流向每页 Prompt。

## Goals / Non-Goals

**Goals:**

- Catalog 产出术语表并强制注入每个 Page Agent，消除跨页命名漂移
- 把现有被动的 `QualityReport` 变成主动反馈环：低质量页面自动重生（有限轮次）
- Facts 覆盖率成为可量化、可触发重生的一等质量指标
- 核心（Advanced）页面通过 Architect→Reviewer 双轮提升深度
- 全部能力可选、可关闭、向后兼容

**Non-Goals:**

- 不做跨页 Verifier 的语义级一致性检查（"A 页引用的概念在 B 页是否有定义"）—— 仅做 Glossary 注入这种轻量共识
- 不做 Glossary 的增量更新（每次全量重建，与 wiki.json 同生命周期）
- 不把双轮模式应用到 Beginner/Intermediate 页面（成本不划算）
- 不做无限重生（必须有 `maxRegenRounds` 上限防止 token 失控）
- 不改 `createAgent` 的核心实现，只在 orchestrator 层组合调用

## Decisions

### D1: Glossary 由 Catalog Agent 一次性产出，而非独立 Agent

**选择**：在 `generate-catalog.ts` 的 Prompt 增加 glossary 产出要求，`GenerateBlueprintTool` 的 inputSchema 增加 `glossary` 字段，与 `pages` 一起提交。

**替代方案**：生成完 wiki.json 后跑一个独立的 Glossary Agent → 多一次 LLM 往返、多读一遍 Repo Map，成本翻倍且 Agent 间又产生新的不一致。

**理由**：Catalog Agent 已经通读了三层 Repo Map，对项目核心概念的认知最完整。术语表是其分析的自然副产物，复用同一上下文最经济、最一致。

### D2: GlossaryTerm 结构

```typescript
interface GlossaryTerm {
  term: string;            // 规范名称，如 "Repo Map"
  aliases?: string[];      // 别名/旧称，如 ["代码库地图", "项目骨架"]
  definition: string;      // 一句话定义
  canonicalPage?: string;  // 该概念的权威页面 slug
}
```

`WikiOutput.glossary?: GlossaryTerm[]`，可选，持久化在 wiki.json 内（不单独建 glossary.json，避免双份生命周期管理）。

**理由**：放进 wiki.json 让 glossary 与 pages 同读同写，`loadWikiBlueprint()` 天然带回，无需新增加载逻辑。

### D3: Glossary 注入位置 —— Facts 段落之前

**选择**：`buildPagePrompt()` 在 `## 🔴 Facts` 段落**之前**注入 `## 📖 项目术语表（统一命名）`，列出 term + 别名 + 定义，附规则"提到这些概念时必须使用术语表中的规范名称"。

**理由**：术语表是全局共识，应优先于页面级 Facts 建立认知。放在最前面让 Agent 在阅读具体符号前先校准命名。

### D4: 覆盖率提及判定 —— 标识符级文本匹配

**选择**：`analyzeFactsCoverage(content, facts)` 判定一个 export 是否"被提及"：在文档正文中以**单词边界**搜索该 export 的 `name`（区分大小写，因为代码标识符大小写敏感）。命中即视为覆盖。

```typescript
function isMentioned(name: string, content: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
  return re.test(content);
}
```

**替代方案**：

- 要求出现在代码块/溯源链接中 → 过严，叙述性提及（"`buildRepoMap` 负责……"）会漏判
- 语义相似度匹配 → 过重，需要 embedding，得不偿失

**理由**：API 文档若真正描述了某符号，几乎必然出现其标识符原文。单词边界匹配在 95% 情况下准确，假阳性（碰巧同名）远少于假阴性。

### D5: DocMetrics 与评分扩展

`DocMetrics` 新增：

```typescript
exportsTotal: number;        // Facts 中导出符号总数
exportsCovered: number;      // 被提及的数量
uncoveredExports: string[];  // 未提及的符号名（用于反馈 Prompt）
```

`scoreByComplexity()` 新增一个 `coverageScore`（满分纳入总分）：

| 覆盖率 | 分数 |
|--------|------|
| ≥ 80% 或 无 Facts | 3 |
| 60%–80% | 2 |
| < 60% | 1 |

**理由**：无 Facts（如纯 overview 页）不应被覆盖率惩罚，给满分。覆盖率作为新维度加入总分，自然影响 professional/standard/basic 分级。

### D6: factsMap 透传链路

覆盖率计算需要每页的 Facts，但 `analyzeWiki()/finalizeWiki()` 当前不持有 Facts。

**选择**：`generateWikiContent()` 在并发生成时已为每页算出 `facts`，将其收集为 `Map<file, PageFacts>`（key 用 `page.file`，与 `analyzeWiki` 内部 `pageMap` 一致），透传给 `finalizeWiki(wikiDir, { pages, audit, factsMap })` → `analyzeWiki(wikiPath, pages, factsMap)`。

**理由**：复用已计算的 Facts，零额外提取成本。key 选 `page.file` 与现有 `pageMap.get(relativeFile)` 对齐。

### D7: 重生触发条件与轮次控制

**选择**：finalize audit 完成后：

1. 收集满足重生条件的页面：`level === 'basic'` **或** `exportsTotal > 0 && coverage < regenThreshold`（默认 0.6）
2. 若这类页面占比 > 某下限或存在即触发（默认存在即触发，但受 `maxRegenRounds` 限制）
3. 对每个待重生页面用 `buildRegeneratePrompt(page, metrics, facts)` 重新生成
4. 重生后再次 audit 这些页面；最多重复 `maxRegenRounds`（默认 1 轮）
5. 即使重生后仍为 basic，也停止（防止无限循环 / token 失控）

`GenerateWikiOptions` 新增：

```typescript
maxRegenRounds?: number;   // 默认 1；0 表示关闭重生
regenThreshold?: number;   // 覆盖率阈值，默认 0.6
```

**理由**：有限轮次是 token 安全的硬约束。默认 1 轮在质量提升和成本间平衡。设 0 可完全关闭，保证向后兼容。

### D8: 重生反馈 Prompt 内容

`buildRegeneratePrompt(page, metrics, facts)` 在标准 `buildPagePrompt` 基础上前置一段反馈：

```markdown
## ⚠️ 上一次生成评分为 basic，请针对性补全：

- [缺图] 当前 1 个 Mermaid 图，要求 ≥ 2 个不同类型
- [缺溯源] 5 个代码块中 0 个有 [Source:] 溯源行
- [行数不足] 当前 120 行，目标 ≥ 200 行
- [未覆盖 API] 以下 Facts 中的导出未被文档提及，请补充说明：
  buildDependencyGraph, computeTransitiveImpact

请基于现有内容补全上述缺失，保持已正确的部分不变。
```

只列出**实际不达标**的项（从 `DocMetrics` 动态推导），不罗列全部规则。

**理由**：针对性反馈比"重写整篇"更省 token，也让 LLM 聚焦真正的缺口。复用 surgical-edit 的"保持已正确部分"理念。

### D9: 双轮模式的角色分工

**Architect Agent**（第一轮）：

- 输入：标准 page prompt + Facts + Glossary
- 职责：架构散文、Mermaid 图、模块划分、设计哲学
- 产出：写入 page 文件（骨架完整但 API 细节可能不全）

**Reviewer Agent**（第二轮）：

- 输入：Architect 产出的文档 + Facts（强调完整性）+ `read_page` 工具
- 职责：对照 Facts 校验 API 完整性、补全代码示例与溯源、修正命名一致性
- 工具：`FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool`（含读现有文档）
- 产出：覆写最终文档

**选择**：仅 `level === 'Advanced'` 启用。Architect `maxTurns: 30`，Reviewer `maxTurns: 20`。

**理由**：Advanced 页面是高价值核心，双轮约多 30% token 值得。Reviewer 复用增量修补的"读现有 + 补全"模式，与 surgical-edit 工具集一致。

### D10: 双轮与重生环的关系

**选择**：双轮是**初始生成**策略（按 level 选择单/双轮）；重生环是**事后补救**策略（按审计结果触发）。两者正交：

- Advanced 页面：双轮生成 → 若仍 basic → 进入重生环
- 非 Advanced 页面：单轮生成 → 若 basic → 进入重生环

重生环统一用 `buildRegeneratePrompt`（单 Agent），不在重生阶段再跑双轮（避免成本叠加）。

**理由**：职责清晰。双轮管"生得好"，重生管"补得齐"。重生不叠加双轮，控制 token 上界可预测。

## Risks / Trade-offs

**[Glossary 质量依赖 Catalog Agent]** 若 Catalog Agent 产出的术语表不准，会污染所有页面。 → **缓解**：glossary 是软约束（"提到时使用规范名称"），不阻断生成。即使术语表不完美，也好过完全无共识。

**[重生导致 token 翻倍]** 最坏情况所有页面都 basic → 全部重生一轮。 → **缓解**：`maxRegenRounds` 默认 1 且只重生 basic/低覆盖页面（通常是少数）。可设 0 关闭。审计日志会报告重生页数供监控。

**[覆盖率假阳性]** 文档里碰巧出现同名词但非指该 API。 → **接受**：单词边界 + 大小写敏感已大幅降低误判。覆盖率只是评分维度之一，非硬门禁，个别误判不影响整体。

**[双轮的 Reviewer 可能破坏 Architect 的好内容]** Reviewer 覆写时可能误删。 → **缓解**：Reviewer Prompt 明确"只补全/修正，不重写已正确部分"，并提供 `read_page` 让它先读全文再增量编辑（沿用 surgical-edit 约束）。

**[改动集中在 generate-wiki.ts]** 四项改进有三项touch `buildPagePrompt`/`generateWikiContent`。 → **缓解**：拆分函数——`buildGlossarySection()`、`buildRegeneratePrompt()`、`generatePageDualPass()` 各自独立，主循环只做分支调度。

**[多 change 合并的范围风险]** 一次引入 4 个能力。 → **缓解**：四者按 D10 正交分层，可分阶段验证（先 Glossary 独立可测，再 Coverage，再 Regen，最后 Dual-pass）。tasks.md 按此顺序编排。

## Migration / Rollout

无破坏性迁移：

- `WikiOutput.glossary` 可选；旧 wiki.json 无此字段时 `buildPagePrompt` 不注入术语表段落
- `factsMap` 可选；不传时 `analyzeFactsCoverage` 跳过，覆盖率给满分（不惩罚）
- `maxRegenRounds` 默认 1；设 0 完全关闭重生，回到当前行为
- 双轮仅 Advanced 触发；可加 `config` 开关（首版可硬编码按 level，后续接配置）

建议分阶段开启：先合入 Glossary + Coverage（纯增量、零风险），观察审计指标；再开启 Regen（`maxRegenRounds: 1`）；最后开启 Dual-pass。
