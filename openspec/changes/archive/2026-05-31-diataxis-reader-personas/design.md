## Context

Wiki 生成管线现状（grounded 自实际代码）：

- `generateWikiCatalog()`（`orchestrator.ts`）运行 Blueprint Agent，通过 `GenerateBlueprintTool` 调用 `generateWikiJson(pages, config, ...)` 写出 `WikiOutput`。`WikiPage` 字段：`slug, title, file, section, group?, level, associatedFiles`，**无 docType**。
- `generateWikiContent()`（`generate-wiki.ts`）按 `level` 路由：`Advanced` 走 `generatePageDualPass()`（Architect→Reviewer，均 Explanation 风格），其余走 `buildPagePrompt()`（单轮）。两条路径最终都用同一个 `page-agent.ts`（maintainer/Explanation 画像）。
- `extractPageFacts(page, symbols)` 已产出 `PageFacts`：`exports[]`（name/kind/signature/file/line/**doc**）、`fileSummaries`、deps。doc 注释来自已归档的 `doc-comment-injection-facts`。
- `finalizeWiki()`（`finalize.ts`）的 `generateSidebar()` 按 `section`→`group` 的 Map 插入顺序生成 `_sidebar.md`，无排序语义。
- Glossary、覆盖率审计、重生环、dual-pass 均已落地（前两个 change）。

两个参考项目的编排范式：**nium-wiki** 用固定类型化骨架（`getting-started.md`/`architecture.md` + `modules/`/`api/`/`guides/`/`design/` 固定排序）；**docusaurus-skill** 提供 Diátaxis 四象限模型 + "不混用象限""不死胡同"写作戒律。两者都按**文档类型**而非**功能域**组织顶层。

本设计采用用户敲定的 **C 混合方案 + Facts 驱动 Reference**：保留功能域 Explanation 深潜，旁加三条跨域象限轨。

## Goals / Non-Goals

**Goals:**

- 一份 wiki 同时覆盖 Diátaxis 四象限：Tutorial（学习）、How-to（操作）、Reference（查阅）、Explanation（理解）
- 保留 `page-agent.ts` 作为 Explanation 模板与现有功能域 section 结构不变
- Reference 由已有 Facts 确定性生成 API 表格，LLM 仅填描述与示例
- 侧边栏按读者旅程排序（Learn→Do→Understand→Look up），跨象限互链不死胡同
- 全部能力可选、向后兼容：不产出新轨道时退化为当前功能域 wiki

**Non-Goals:**

- 不做全 Diátaxis 重构（不抛弃功能域 section；用户已否决方案 B）
- 不做多语言/多受众的并行版本（同一象限只生成一份）
- 不改 `createAgent` 核心实现，只在 orchestrator 层增加按 docType 的路由分支
- Reference 不做交互式 API playground，只做静态表格 + 示例
- 不强制每个项目都生成 How-to——若代码库无可识别的常见任务，How-to 轨可为空

## Decisions

### D1: docType 作为 Diátaxis 象限的唯一标识，与 level 正交

新增 `DocType = 'tutorial' | 'howto' | 'reference' | 'explanation'`，`WikiPage.docType?: DocType`，缺省 `explanation`。

`docType` 决定**写作象限与 Prompt 模板**；`level`（Beginner/Intermediate/Advanced）继续决定**深度与 dual-pass 触发**。两者正交：一篇 Advanced Explanation 走 dual-pass，一篇 Advanced Reference 走 Facts 模板（不 dual-pass）。

**替代方案**：复用 `level` 表达象限 → 语义冲突，level 是深度不是类型。新增独立字段语义最清晰。

### D2: 混合编排 —— docType 决定 section 归属

- `explanation` 页：保持现有功能域 `section`/`group`（不变）
- `tutorial` 页：固定 `section: "上手教程"`
- `howto` 页：固定 `section: "操作指南"`
- `reference` 页：固定 `section: "API 参考"`

这样既保留功能域深潜，又让三条新轨在侧边栏自然聚合。`section` 字段无需新增——复用现有字段 + 约定的固定轨道名。

**理由**：最小化类型改动，复用现有 `section`-based 侧边栏机制；轨道名固定便于 D6 的排序识别。

### D3: Catalog 双轴编排，单 Agent 一次产出

扩展 `generate-catalog.ts` 的 Prompt，要求 Blueprint Agent 在现有功能域 Explanation 页之外，额外识别并产出：

1. **上手教程轨**（1 条序列）：从"环境准备→跑起来第一个可见结果"的渐进步骤，docType=tutorial
2. **How-to 指南轨**（N 篇）：从代码库的入口/脚本/测试中发现的常见任务（"如何新增一个 X""如何接入 Y"），docType=howto
3. **Reference 轨**（按主要导出模块）：docType=reference，associatedFiles 指向有丰富 exports 的核心模块

`GenerateBlueprintTool` inputSchema 增加 `docType` 属性。

**替代方案**：跑独立 Agent 分别生成各轨 → 多次 LLM 往返、重复读 Repo Map、轨间不一致。单 Agent 复用同一上下文最经济、最一致（与 Glossary 的 D1 决策一致）。

### D4: 三套象限 Prompt，严守 docusaurus 写作戒律

| docType | 新模板 | 核心戒律（源自 docusaurus-skill） |
|---------|--------|----------------------------------|
| tutorial | `tutorial-page.ts` | 开篇说"你将构建什么"而非"你将学什么"；单一路径无"或者也可以"；每步有可见输出；链接到 Explanation 而非内嵌 |
| howto | `howto-page.ts` | 标题"如何[动词][对象]"；假设读者有能力跳过基础；先目标后工具；"你需要什么"前置；含验证与排错 |
| reference | `reference-page.ts` | 镜像代码结构；表格优先；每个导出都有条目与示例；禁止叙述/教程混入 |
| explanation | `page-agent.ts`（保留） | 现有架构散文/设计哲学 |

每套模板末尾都包含**跨象限互链指令**（D7）。所有模板复用现有 Facts 段落与 Glossary 注入。

### D5: Reference 由 Facts 渲染骨架 + LLM 填充

新增 `packages/orchestrator/src/wiki/reference-skeleton.ts`：

```
buildReferenceSkeleton(facts: PageFacts): string
  → 渲染 markdown API 表格：每个 export 一行
    | API | 签名 | 说明 | 源 |
    含 doc 注释作为"说明"初值、source link
```

`buildReferencePrompt(page, facts)` 把骨架嵌入 Prompt，指令 LLM：**保持表格结构与 API 列表不变**，补全"说明"列描述、为每个 API 增加最小可运行示例、不得增删 Facts 之外的 API。

**理由**：结构确定性来自 Facts（零幻觉、完整覆盖），描述质量来自 LLM。这是 open-zread 相对 nium-wiki/docusaurus 的独有结构优势（它们无 Facts 层）。Reference 页不走 dual-pass（骨架已保完整性）。

### D6: 侧边栏 Diátaxis 读者旅程排序

`generateSidebar()` 引入轨道优先级：

```
上手教程 (Learn)        order 0
操作指南 (Do)           order 1
[功能域 sections] (Understand)  order 2..N（按现有顺序）
API 参考 (Look up)      order 99（置底）
```

固定轨道名匹配到固定 order，功能域 section 居中，未知 section 维持插入序。

**理由**：直接对齐 docusaurus 的"Learn→Do→Understand→Look up"旅程与 nium-wiki 的 `KNOWN_DIR_ORDER` 思路。

### D7: 跨象限互链，杜绝死胡同

每套 Prompt 模板末尾注入互链指令（源自 docusaurus "Connecting the Quadrants"）：

- Tutorial → "深入原理见 [Explanation]"、"完整 API 见 [Reference]"
- How-to → "前置：先完成 [Tutorial]"、"全部选项见 [Reference]"
- Reference → "实操见 [How-to]"
- Explanation → "动手试见 [Tutorial]"

借助已落地的 Glossary `canonicalPage` 与侧边栏 slug 提供互链目标。

### D8: 生成路由分发

`generateWikiContent()` 的 page task 内：

```
switch (page.docType ?? 'explanation') {
  case 'tutorial':   → buildTutorialPrompt(page, facts, glossary) [单轮]
  case 'howto':      → buildHowToPrompt(page, facts, glossary)    [单轮]
  case 'reference':  → buildReferencePrompt(page, facts)          [单轮, Facts 骨架]
  case 'explanation':→ 现有逻辑（Advanced 走 dual-pass，否则单轮）
}
```

重生环（上个 change 的 P0-3）对所有 docType 一视同仁：低质量页用 `buildRegeneratePrompt` 单轮补救，不按 docType 重选模板（保持重生成本可预测）。

## Risks / Trade-offs

**[How-to 任务识别不准]** Agent 可能编造不存在的"常见任务"或遗漏真实工作流。 → **缓解**：Prompt 要求 How-to 必须锚定真实入口文件/脚本/测试（associatedFiles 必填），无法锚定的任务不生成。How-to 轨允许为空。

**[象限混用回潮]** LLM 习惯性在 Tutorial 里堆架构、在 Reference 里写叙述。 → **缓解**：每套模板显式列出 docusaurus 的"反模式"清单（如 Tutorial 禁"首先理解 X 如何工作"）；质量审计可未来增加象限纯度检查。

**[Reference 骨架与源码漂移]** Facts 基于上次解析，源码变更后表格可能过时。 → **接受**：与增量管线同生命周期，重新生成即刷新；Facts 本就是权威快照。

**[token 成本上升]** 新增三条轨 = 更多页面。 → **缓解**：Reference 走 Facts 骨架（LLM 仅填充，token 低于自由生成）；Tutorial/How-to 单轮不 dual-pass；轨道数量由 Catalog 按项目规模自适应，小项目可只加教程轨。

**[改动集中在 generate-wiki.ts]** 路由分支 + 三模板。 → **缓解**：每个 `buildXxxPrompt` 独立纯函数可单测；路由是单一 switch，主循环只做分发。

## Migration Plan

无破坏性迁移，分阶段灰度：

1. 合入类型 + 三模板 + 路由（不改 Catalog）：手动给个别页面标 docType 验证模板效果
2. 开启 Catalog 双轴编排：新增教程轨（风险最低、价值最直观）
3. 开启 How-to 轨与 Facts 驱动 Reference 轨
4. 切换侧边栏 Diátaxis 排序

**回滚**：Catalog 不产出 docType / 不产出新轨道 → 所有页面按 `explanation` 处理，侧边栏未知 section 维持插入序，完全回到当前行为。

## Open Questions

- How-to 轨的篇数是否需要上限（防止 Agent 过度拆分常见任务）？首版交由 Catalog 自适应，观察后再定阈值。
- Reference 是否需要按 export 数量阈值决定"哪些模块值得独立 Reference 页"？首版由 Catalog 判断（关联模块 exports 丰富者才建 Reference）。
