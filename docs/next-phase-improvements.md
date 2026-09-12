# open-zread 下阶段 Wiki 生成改进指导

> 基于对 open-zread 已落地工程的深度分析与反思，提炼出下一阶段的核心改进方向。
>
> 分析日期：2026-05-30
>
> 前置阅读：[`nium-wiki-improvements.md`](./nium-wiki-improvements.md)（P0/P1/P2 改进方案，已全部落地）

---

## 目录

1. [现状盘点：能力地图](#一现状盘点能力地图)
2. [结构性盲点分析](#二结构性盲点分析)
   - [盲点 1：Page Agent 信息孤岛](#盲点-1page-agent-是信息孤岛无全局共识)
   - [盲点 2：Facts 缺失原作者意图](#盲点-2facts-中只有签名缺失原作者意图)
   - [盲点 3：测试金矿被忽视](#盲点-3测试文件是被忽视的金矿)
   - [盲点 4：缺少自审与交叉验证](#盲点-4单一作者视角缺少自审与交叉验证)
   - [盲点 5：缺乏读者画像](#盲点-5所有文档共享架构师视角缺乏读者画像)
3. [改进方向（按 ROI 排序）](#三改进方向按-roi-排序)
   - [P0 改进项](#p0高-roi改动量小约-300-行)
   - [P1 改进项](#p1中-roi约-500-行)
   - [P2 改进项](#p2探索性工程量大)
4. [优先级总览](#四优先级总览)
5. [总结](#五总结)

---

## 一、现状盘点：能力地图

nium-wiki 路线图上的十项改进**已经全部落地**——结构性硬骨头已经啃完。当前管线能力如下：

```
当前 5 步管线 (现状)
├── 1. Scan       glob + .gitignore                       ✅
├── 2. Parse      web-tree-sitter AST + Extractor 模式    ✅ (TS/JS/Go/Py/C#)
├── 3. Cache      AST 符号级哈希 + 增量传播管道           ✅ (P2)
├── 4. Blueprint  单 Agent + 3 层 Repo Map → wiki.json    ✅
└── 5. Pages      N 并发 Agent
       ├─ Facts-First 注入权威符号                         ✅ (P1)
       ├─ Mermaid 类型 + 复杂度 + 语法规则                 ✅ (P0)
       ├─ 复杂度自适应质量目标                             ✅ (P0)
       ├─ 代码块溯源 + 章节溯源                            ✅ (P1)
       ├─ 增量修补 (surgical edit, 15 turns)               ✅ (P2)
       └─ Finalize: 链接修复 / 索引 / 侧边栏 / 审计        ✅ (P1)
```

**下一阶段的瓶颈不再是"补功能"，而是"生成视角的局限"**。

---

## 二、结构性盲点分析

### 盲点 1：Page Agent 是"信息孤岛"，无全局共识

**位置**：`packages/orchestrator/src/wiki/generate-wiki.ts`

`generateWikiContent` 用 `p-limit` 并发跑 N 个独立 Agent，每个 Agent 只看：自己页面的 Facts + 关联文件 + 全局 Prompt。但 Page Agent A 和 B 之间**互不知道对方写了什么**，导致：

- **术语漂移**：同一概念在 A 页叫"调度器"，在 B 页叫"任务编排引擎"
- **职责重叠**：A 和 B 都各自从头解释"什么是 Repo Map"
- **引用断链**：A 说"详见 B 页的 X 节"，但 B 实际叫 Y
- **架构图断裂**：A 的 flowchart 把模块 M 划在"核心层"，B 的 flowchart 把同一个 M 划在"工具层"

**根因**：缺少一份**项目级 Glossary / Canonical Concepts** 作为 Blueprint 阶段的副产出，并强制注入到每个 Page Agent 的 Prompt。

---

### 盲点 2：Facts 中只有"签名"，缺失"原作者意图"

**位置**：`packages/repo-analyzer/src/repo-map/module-facts.ts`、`packages/repo-analyzer/src/parser/`

`extractPageFacts` 当前产出的是 **函数签名 + 文件路径**。但代码注释（JSDoc / TSDoc / docstring）才是 **原作者亲手留下的语义**——这是比 LLM 重新发挥更可信的真相。

```text
当前 Facts:  export function buildRepoMap(...) → file.ts#L12
缺失:        /** 构建三层 Repo Map: ... */ 上方的 JSDoc 原文
```

`web-tree-sitter` 完全可以提取这些 leading comment，但 parser 没做。结果就是 LLM 在"自己重新理解+复述"，错失了**最权威的人工标注语义**。

---

### 盲点 3：测试文件是被忽视的金矿

**位置**：`packages/orchestrator/src/prompts/page-agent.ts`、Catalog 蓝图阶段

测试代码包含两类强信号：

1. **断言** = API 的契约（"调用 X，应该返回 Y"）
2. **fixture / setup** = 最小可运行示例

当前 Page Agent 只通过通用 `GlobTool/GrepTool` 看测试，没有把 `*.test.ts` / `*_test.go` / `test_*.py` 作为**优先信息源**。结果：

- 文档里的代码示例是 LLM 编的，可能 import 错路径、漏了必填参数
- 测试里有现成的、能跑的、被维护着的示例，没被用上

---

### 盲点 4：单一作者视角，缺少自审与交叉验证

**位置**：`packages/orchestrator/src/wiki/generate-wiki.ts`、`packages/utils/src/output/quality-audit.ts`

每个页面只有 **一个 Agent 一次成型**，跑完就写盘。没有：

- **Self-critique**：Agent 自己回看 Facts 覆盖率（"我提到了 8/12 个 export，剩下 4 个真的不重要吗？"）
- **Cross-page Verifier**：所有页生成后跑一遍校验——"A 页提到的概念 X，是否在某页有正式定义？"
- **Quality audit 现在是被动产出报告**：它跑完只 log 数字，没有触发"质量低于阈值的页面自动重生"

`quality-audit.ts` 已经能算出 `basic / standard / professional` 分级，但**没有反馈到生成管线**。

---

### 盲点 5：所有文档共享"架构师视角"，缺乏读者画像

**位置**：`packages/orchestrator/src/prompts/page-agent.ts`

`page-agent.ts` 开头就定调："你的读者是准备接手或深入研究源码的开发者"。这是**唯一**的读者画像。

但同一个项目的 Wiki 读者实际有多类：

| 读者 | 想要 | 当前满足度 |
|------|------|----------|
| 第一次接触的新人 | 5 分钟全景 / 跑起来 | ⚠️ 项目概览页有，但风格也是架构散文 |
| 接手维护者 | 完整架构 + 历史决策 | ✅ 这是当前唯一画像 |
| API 集成者 | 输入输出 + 副作用 + 示例 | ⚠️ Facts 给了签名，但叙述偏重设计哲学 |
| 安全审计者 | 信任边界 / 输入校验 | ❌ 完全没有专门视角 |
| 性能调优者 | 热路径 / 复杂度 | ❌ 完全没有 |

Diátaxis（Tutorials / How-to / Reference / Explanation）四象限是个成熟的参考——当前 wiki 几乎全是 Explanation 一类。

---

## 三、改进方向（按 ROI 排序）

### P0（高 ROI，改动量小，约 300 行）

#### 1. JSDoc / docstring 注入 Facts

**影响力：极高 · 难度：低**

**目标**：消除"LLM 重新发明设计意图"的幻觉。

**改动**：

- `packages/repo-analyzer/src/parser/` — 提取 leading comment（tree-sitter 节点遍历的简单扩展），覆盖 TS/JS、Python、Go、Rust、Java、C#
- `packages/types/src/symbols.ts` — `SymbolInfo.functions[].doc?: string`
- `packages/types/src/wiki.ts` — `ExportFact.doc?: string`
- `packages/repo-analyzer/src/repo-map/module-facts.ts` — `extractPageFacts` 把 `doc` 透传到 `exports[]`
- `packages/orchestrator/src/wiki/generate-wiki.ts` — `buildPagePrompt` 的"权威数据源"块加上"作者原始注释"

**Prompt 注入示例**：

```markdown
**导出符号** (共 N 个):
- `export function buildRepoMap(opts: BuildOpts): RepoMap`
  → packages/repo-analyzer/src/repo-map/index.ts#L42
  📝 作者注释：构建三层 Repo Map：目录树、核心签名、模块详情。
              用于 Blueprint Agent 渐进式分析项目结构。
```

**预期效果**：API 描述准确率从约 70%（依赖 LLM 推理）提升到 95%+（基于原作者注释）。

---

#### 2. Blueprint 副产出 Glossary

**影响力：高 · 难度：中低**

**目标**：消除术语漂移，强化跨页面一致性。

**改动**：

- `packages/orchestrator/src/prompts/generate-catalog.ts` — 要求 Catalog Agent 同时产出 `glossary[]`
- `packages/orchestrator/src/tools/output-tools.ts` — `GenerateBlueprintTool` 接受 `{ pages, glossary }` 结构
- `packages/types/src/wiki.ts` — `GlossaryTerm { term, definition, aliases, canonicalPage }`
- `packages/utils/src/output/wiki-content.ts` — 持久化 `glossary.json`
- `packages/orchestrator/src/wiki/generate-wiki.ts` — `buildPagePrompt` 注入项目术语表（强制使用这些命名）

**示例 glossary 输出**：

```json
{
  "glossary": [
    {
      "term": "Repo Map",
      "aliases": ["代码库地图", "项目骨架"],
      "definition": "三层递进的项目结构表示：目录树 → 核心签名 → 模块详情",
      "canonicalPage": "3-core-architecture"
    },
    {
      "term": "Page Agent",
      "aliases": ["文档 Agent", "Page 生成器"],
      "definition": "为单个 Wiki 页面生成 Markdown 的独立 Agent 实例",
      "canonicalPage": "4-orchestrator-engine"
    }
  ]
}
```

**预期效果**：消除同一概念在不同页面的命名漂移；引用链接准确率显著提升。

---

#### 3. Quality Audit → 自动重生反馈环

**影响力：高 · 难度：低**

**目标**：把现有的被动评分变成主动反馈环。

**改动**：

- `packages/orchestrator/src/wiki/generate-wiki.ts` — finalize 跑完 audit 后，若 `level === 'basic'` 的页数 > 阈值（如 20%），对这些页面再跑一次
- 新增 `packages/orchestrator/src/prompts/regenerate-with-feedback.ts` — 把 `DocMetrics` 中的不足点（缺图、缺溯源、行数不够）作为反馈注入 Prompt

**反馈 Prompt 示例**：

```markdown
## ⚠️ 上一次生成评分为 basic，原因如下：

- 仅 1 个 Mermaid 图（要求 ≥ 2 个不同类型）
- 代码块溯源 0/5（每个代码块必须有 [Source: ...]）
- 文档行数 120/200（未达最低要求）

请基于现有内容补全上述缺失，并保持已有正确部分不变。
```

**预期效果**：消除"basic 文档"流入最终产物，整体质量分布向 professional 倾斜。

---

### P1（中 ROI，约 500 行）

#### 4. 测试优先信息源

**影响力：中高 · 难度：中**

**目标**：示例从"LLM 编的"升级为"能跑的"。

**改动**：

- `packages/repo-analyzer/src/scanner/` — 扫描时识别测试文件（`*.test.*` / `*_test.*` / `__tests__/` / `test/*.py`）
- `packages/types/src/wiki.ts` — `WikiPage.testFiles?: string[]`
- Catalog Agent 在划分 page 时为每个 page 标记关联测试
- `packages/orchestrator/src/prompts/page-agent.ts` — 增加约束："如该模块有测试，**优先**从测试中提取代码示例和契约说明"

**预期效果**：代码示例的可运行率从约 40%（LLM 猜测）提升到 85%+（来自真实测试）。

---

#### 5. Coverage Verifier（事后校验）

**影响力：中高 · 难度：低**

**目标**：把 Facts 覆盖率作为质量审计的核心指标。

**改动**：

- `packages/utils/src/output/quality-audit.ts` — 新增 `analyzeFactsCoverage(doc, facts): FactsCoverage`
- `DocMetrics` 增加 `exportsCovered: number`、`exportsTotal: number`、`uncoveredExports: string[]`
- 低于阈值（如 60%）触发重生（与 #3 同管线）

**预期效果**：消除"页面关联 12 个 export，只提及 5 个"的失衡情况。

---

#### 6. 角色化 Page Agent（双轮模式）

**影响力：中 · 难度：中**

**目标**：通过角色分工 + 自审提升核心模块质量。

**改动**：

- `packages/orchestrator/src/agents/` — 新增 `architect-agent.ts` 和 `reviewer-agent.ts`
- 仅对标记为 `level: 'Advanced'` 的核心模块启用双轮模式：
  - **Architect Agent**：先写骨架（架构图、模块划分、设计哲学）
  - **Reviewer Agent**：看 Facts 校验后补全（API 完整性、代码示例、溯源检查）

**成本估算**：核心模块 token 消耗增加约 30%，非核心模块不变。

**预期效果**：核心文档（占 20% 数量、80% 价值）的质量从 standard 普遍升至 professional。

---

### P2（探索性，工程量大）

#### 7. 读者画像分支生成

**影响力：高 · 难度：高**

**目标**：从"一种风格写给所有人"转向"分层适配"。

**改动**：

- `packages/types/src/wiki.ts` — `WikiPage.audience?: 'overview' | 'integrator' | 'maintainer'`
- `packages/orchestrator/src/prompts/` — 新增三套模板：
  - `tutorial-prompt.ts`（overview 风格，从"如何开始"切入）
  - `reference-prompt.ts`（integrator 风格，强调输入输出契约）
  - 保留现有 `page-agent.ts` 作为 maintainer 风格
- `packages/orchestrator/src/prompts/generate-catalog.ts` — Catalog Agent 为每个 page 标记 audience

**对应 Diátaxis 框架**：

| Audience | Diátaxis 象限 | 模板特征 |
|----------|--------------|----------|
| overview | Tutorial | 任务驱动 / 从零开始 / 渐进式 |
| integrator | Reference | API 表格 / 输入输出 / 错误码 |
| maintainer | Explanation | 架构散文 / 设计哲学（当前风格） |

**预期效果**：文档对不同读者的可用性大幅提升；用户留存时间预期翻倍。

---

#### 8. Git 历史注入设计意图

**影响力：中 · 难度：中**

**目标**：捕获"为什么这样设计"——commit message 里常常埋着比代码本身更值钱的信息。

**改动**：

- `packages/repo-analyzer/src/scanner/` — 新增 `git-history.ts`：对每个关联文件跑 `git log --follow --pretty=format:%H|%s --max-count=10`
- `packages/types/src/wiki.ts` — `FileInfo.commits?: CommitInfo[]`
- `packages/repo-analyzer/src/repo-map/module-facts.ts` — `PageFacts.designIntent?: string[]`（首次引入 + 重大变更的 commit messages）
- `packages/orchestrator/src/wiki/generate-wiki.ts` — buildPagePrompt 注入"设计意图来源"

**预期效果**："为什么这样设计"章节从 LLM 主观推测 → 引用真实 commit message 作为证据。

---

## 四、优先级总览

| 优先级 | 改进项 | 预估改动量 | 核心收益 |
|--------|--------|-----------|----------|
| **P0** | 1. JSDoc 注入 Facts | ~150 行 | 直接消除 API 描述幻觉 |
| **P0** | 2. Blueprint Glossary | ~100 行 | 消除术语漂移 |
| **P0** | 3. Audit → 自动重生 | ~80 行 | 把被动评分变成主动反馈环 |
| **P1** | 4. 测试优先信息源 | ~200 行 | 示例从猜测变为可运行 |
| **P1** | 5. Coverage Verifier | ~100 行 | Facts 覆盖率作为核心质量指标 |
| **P1** | 6. 角色化 Page Agent | ~250 行 | 核心模块从 standard → professional |
| **P2** | 7. 读者画像分支生成 | ~400 行 + 模板 | 多受众适配，覆盖 Diátaxis 四象限 |
| **P2** | 8. Git 历史注入 | ~200 行 | 设计意图有据可查 |

> **P0 三项合计 < 350 行代码**，全部聚焦于"已有基础设施的语义增强"，无需新增子系统。建议作为下一个迭代的首要目标。

---

## 五、总结

**已落地的工作把"产出能用文档"这个目标做到了 8/10。要做到 9.5/10，瓶颈不再是 Prompt 工程，而是：**

1. **让 Agent 看到更多原作者意图**（JSDoc、测试、commit message）
2. **让 N 个 Agent 之间共享共识**（Glossary、Verifier）
3. **让质量审计从被动报告变成主动反馈环**（Audit → 重生）

如果只挑一个最值得马上做的——**P0-1（JSDoc 注入 Facts）**：改动小、对幻觉的削弱直接、且和已有 Facts-First 基础设施完全契合。

---

*基于 open-zread 当前工程现实的反思 · 2026-05-30*
