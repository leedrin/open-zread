# open-zread 向 nium-wiki 学习改进方案

> 基于对 nium-wiki 和 open-zread 的深度架构对比分析，提炼出十大可落地的改进方向。
>
> 分析日期：2026-05-24

---

## 目录

1. [Mermaid 图质量体系](#一mermaid-图质量体系)
2. [文档质量审计层](#二文档质量审计层)
3. [Facts-First 事实前置提取](#三facts-first-事实前置提取)
4. [精细增量更新管道](#四精细增量更新管道)
5. [源文件溯源增强](#五源文件溯源增强)
6. [复杂度自适应质量目标](#六复杂度自适应质量目标)
7. [密钥自动脱敏](#七密钥自动脱敏)
8. [交互式关系图](#八交互式关系图)
9. [增量修补模式](#九增量修补模式)
10. [生成后收尾管道](#十生成后收尾管道)

---

## 一、Mermaid 图质量体系

**影响力：高 · 难度：中**

### 问题

当前 `page-agent.ts` 只有一句话："**必须**使用 Mermaid 绘制详尽的架构图"。Agent 不知该用什么类型、如何处理复杂模块、生成的图是否有语法错误——全部靠猜。

### nium-wiki 的做法

完整的三层体系：

1. **类型映射表**：系统架构 → `flowchart TB` + subgraph，数据流 → `sequenceDiagram`，状态机 → `stateDiagram-v2`，依赖 → `flowchart LR`，数据模型 → `erDiagram`
2. **复杂度自适应分组**：≤6 节点线形 / 7-12 subgraph / 13-20 分层 / >20 拆分多图
3. **语法安全规则**：subgraph ID 不冲突、双引号转义、保留字禁止

### 落地方案

**第一步：增强 `page-agent.ts` Prompt，注入 Mermaid 规则**

文件：`packages/orchestrator/src/prompts/page-agent.ts`

当前内容：

```
2. **架构设计与模块划分** (Architecture & Modules)
   - **必须**使用 Mermaid 绘制详尽的架构图或模块依赖图。
```

应改为注入完整的图表选择规则和语法安全规则（类似 nium-wiki SKILL.md 的 Diagram Requirements 表）。

**第二步：在 `repo-analyzer` 添加 Mermaid 语法校验工具**

新增文件：`packages/repo-analyzer/src/repo-map/mermaid-validator.ts`

功能：
- 解析 `.md` 文件中的 mermaid 代码块，检查常见语法错误
- subgraph ID 与 node ID 冲突检测
- 未转义双引号检测
- 保留字作为 ID 检测

返回值：`{ errors: MermaidIssue[], warnings: MermaidIssue[] }`

**第三步：为 `utils` 添加文档审计命令**

新增文件：`packages/utils/src/output/audit-docs.ts`

功能：
- 扫描 `wiki/` 目录所有 `.md`，检测 Mermaid 语法错误
- 统计每个文档的 diagram 数量和类型
- 统计代码示例数量
- 检查源文件溯源链接完整性
- 检测空章节

输出：`QualityReport` JSON

---

## 二、文档质量审计层

**影响力：高 · 难度：中**

### 问题

open-zread 生成完文档就结束了，没有任何质量反馈循环。

### nium-wiki 的做法

- 按角色分层阈值（core 要求 3+ 图、5+ 示例；utility 要求 1 图、1-2 示例）
- 评分系统：3pt / 2pt / 1pt 三级（professional / standard / basic）
- `--mermaid-strict` 模式在 CI 中阻断语法错误
- 输出 `QualityReport` JSON 供自动化消费

### 落地方案

在 `packages/utils/src/output/` 下新增审计模块：

```
packages/utils/src/output/audit-docs.ts
  - analyzeDoc(filePath): QualityMetrics
  - analyzeWiki(wikiPath): QualityReport
  - scoreByComplexity(metrics, moduleRole): qualityLevel

packages/cli/src/views/ 中的 TUI 增加审计入口
  或在 open-zread browse 的 Web 预览中展示审计报告
```

**关键设计**：阈值应与 Catalog 生成时的 `level` 字段（Beginner / Intermediate / Advanced）挂钩，这样无需事后推断模块角色。

---

## 三、Facts-First 事实前置提取

**影响力：高 · 难度：中高**

### 问题

open-zread 的 Page Agent 通过 FileRead 工具直接读源文件，然后凭 LLM 记忆生成 API 文档。这容易造成：

- API 签名与源码不一致（LLM 幻觉）
- 遗漏关键导出
- 编造不存在的函数

### nium-wiki 的做法

"Facts-First Rule"：在生成任何文档前，先运行 `analyze-batch` 将每个模块的导出符号预提取为 `facts/{module}.json`，AI 生成时**必须以 facts.json 为权威数据源**，不允许凭空编造 API。

```json
{
  "modulePath": "src/core",
  "exports": [
    { "name": "analyzeProject", "kind": "function", "signature": "export async function analyzeProject(...)", "file": "src/core/analyzeProject.ts", "line": 123 }
  ],
  "internalDeps": ["src/core/buildDeps.ts"],
  "externalDeps": ["src/utils/config.ts"],
  "confidence": 0.85
}
```

### 落地方案

open-zread **已经有这个能力的基础设施**——`repo-analyzer` 的 Parser 已经提取了每个文件的 exports、functions、imports。只需编排管线。

**第一步：在 Catalog 生成后、Page 生成前，新增 `extractModuleFacts` 步骤**

新增文件：`packages/repo-analyzer/src/repo-map/module-facts.ts`

```typescript
export function extractPageFacts(
  page: WikiPage,
  symbols: SymbolManifest
): PageFacts {
  // 1. 按 associatedFiles 过滤符号
  // 2. 汇总 exports（去重）
  // 3. 统计 fileSummaries
  // 4. 计算 confidence
}
```

**第二步：修改 `generate-wiki.ts` 中的 `buildPagePrompt`**

在构建每个 page 的 prompt 时，注入 facts 数据：

```typescript
function buildPagePrompt(page: WikiPage, facts: PageFacts): string {
  return `${PageAgentPrompt}

## 🔴 Facts — 权威数据源（API 签名必须以这里为准）

**导出符号** (共 ${facts.exports.length} 个):
${facts.exports.map(e => `- \`${e.signature}\` → ${e.file}#L${e.line}`).join('\n')}

**关联文件**:
${facts.fileSummaries.map(f => `- ${f.file} (${f.lineCount} 行, ${f.symbols.length} 个符号)`).join('\n')}

## ⚠️ 规则
1. 所有 API 描述必须以 Facts 中的符号列表为准
2. 如果某个符号在 Facts 中不存在，不要擅自添加到文档中
3. 如果 Facts 中有某个符号但你不理解，可以忽略但不要篡改其签名
```
}
```

**第三步：在 Catalog Agent 的 `generate_blueprint` 工具中也注入 Facts 引用**

---

## 四、精细增量更新管道

**影响力：高 · 难度：高**

### 问题

open-zread 的 ROADMAP 中写了 "Fine-grained Incremental Updates ☐"。目前只有符号级缓存（跳过未变文件的 AST 解析），但没有 Wiki 内容级的增量更新。

### nium-wiki 的做法

四级增量传播管道：

```
SHA256 文件哈希 diff
  → dep-graph BFS 传递影响（maxDepth=3）
    → doc-index 源文件 → 文档映射
      → doc-to-doc 文档间引用依赖传播
        → 输出精确的 affectedDocs 列表
```

每条 affected doc 带有：
- `reason`: `source_changed` / `dep_changed` / `doc_dep_changed` / `inferred`
- `updateStrength`: `full`（签名变更）/ `incremental`（传递性影响）
- `triggeredBy`: 触发变更的源文件列表

### 落地方案

open-zread 已有 Repo Map 的符号级缓存（AST hash），需要向上延伸：

```
packages/repo-analyzer/src/scanner/      — 已有文件哈希
packages/repo-analyzer/src/parser/        — 已有符号提取

需要新增:
packages/utils/src/cache/incremental-pipeline.ts
  - buildDependencyGraph()         — 从 SymbolManifest.imports 构建双向依赖图
  - computeTransitiveImpact()      — BFS 传递影响
  - buildDocIndex()                — 解析 wiki/ 中 Source 链接，构建源文件 ↔ 文档映射
  - buildDocToDocDeps()            — 解析 wiki/ 中跨文档链接
  - buildIncrementalPlan()         — 组合以上四层
```

这个工作量大但价值极高——是 open-zread 从"能用"到"生产级"的关键一步。

---

## 五、源文件溯源增强

**影响力：中 · 难度：低**

### 问题

open-zread 的 `page-agent.ts` 要求每段末尾加 `Sources: [file](path#L1-L50)`，但：

- 没有强制要求每个代码块溯源
- 没有检查溯源链接是否有效
- 没有代码块前溯源格式（nium-wiki 要求在 \`\`\` 上方写 `[Source: file](/path#L1-L50)`）

### nium-wiki 的做法

- 🔴 强制：每个章节尾部 + **每个代码块上方**都要有溯源
- 代码块溯源放在 fence 外面（纯文本），这样链接可点击
- `sanitize-links` 命令修复 `file://` 绝对路径
- `build-index` 命令扫描溯源链接构建双向映射

### 落地方案

在 `page-agent.ts` Prompt 中强化溯源要求，增加代码块溯源规则：

在现有 "绝对纪律：精准溯源" 段落中增加：

```markdown
🔴 **代码块溯源（强制）**
任何从源文件摘抄的代码块，必须在 ``` 上方添加溯源行：

[Source: foo.ts](/packages/core/src/foo.ts#L42-L67)
```typescript
const result = foo.bar();
```

⚠️ 溯源行必须在代码块**外面**（纯文本），不要在代码块内部用注释！
❌ 错误：```typescript\n// Source: foo.ts\n...
✅ 正确：[Source: foo.ts](/...)\n```typescript\n...
```

---

## 六、复杂度自适应质量目标

**影响力：中 · 难度：低**

### 问题

open-zread 的所有 Page Agent 使用同一个 Prompt，不管模块是核心引擎还是简单工具——导致简单模块过度生成、核心模块深度不够。

### nium-wiki 的做法

按 `docScope` 分级：

| docScope | 模板 | 行数 | 图数 | 示例数 |
|----------|------|------|------|--------|
| core | module.md (11 节) | 400+ | 2+ 不同类型 | 5+ |
| overview | overview.md (5 节) | 80-150 | 可选 | 1-2 |
| \_index | \_index.md | 30-50 | 无 | 无 |

### 落地方案

open-zread 的 wiki.json 已经有 `level` 字段（Beginner / Intermediate / Advanced），只需在 `buildPagePrompt` 中利用它：

```typescript
function buildPagePrompt(page: WikiPage, facts?: PageFacts): string {
  const targets = getQualityTargets(page);

  return `${PageAgentPrompt}

## 🎯 本文档质量目标

| 指标 | 目标 |
|------|------|
| 推荐行数 | ${targets.minLines}+ |
| 图表数量 | ${targets.minDiagrams} 个（至少 ${targets.minDiagramTypes} 种不同类型）|
| 代码示例 | ${targets.minExamples} 个 |
| 溯源链接 | 每个章节 + 每个代码块 |

根据页面难度等级（${page.level}）和关联文件数自动计算。
`;
}

function getQualityTargets(page: WikiPage) {
  const fileCount = page.associatedFiles?.length || 0;
  const isCore = page.level === 'Advanced' || fileCount >= 5;
  const isSimple = page.level === 'Beginner' && fileCount <= 2;

  if (isCore)
    return { minLines: 400, minDiagrams: 2, minDiagramTypes: 2, minExamples: 5 };
  if (isSimple)
    return { minLines: 80, minDiagrams: 1, minDiagramTypes: 1, minExamples: 1 };
  return { minLines: 200, minDiagrams: 1, minDiagramTypes: 1, minExamples: 2 };
}
```

---

## 七、密钥自动脱敏

**影响力：中 · 难度：低**

### 问题

open-zread 生成的文档代码示例中可能包含硬编码的 API Key、密码、Token——严重安全隐患。

### nium-wiki 的做法

在 SKILL.md 中定义脱敏规则，AI 生成时强制执行：

| 场景 | 脱敏示例 |
|------|----------|
| API Key | `sk_live_abc123` → `sk_live_XXXXXXXXXXXX` |
| 密码 | `password: "mysecret123"` → `password: "***REDACTED***"` |
| Token | `TOKEN=abc123` → `TOKEN=<your-token-here>` |

共 6 种脱敏模式 + 样本库。

### 落地方案

**第一步：在 `page-agent.ts` Prompt 中增加脱敏要求（低成本）**

```markdown
🔴 **密钥与凭证脱敏（强制）**
在代码示例中，绝对不要包含真实的密钥、密码或 Token！
替换规则：
- API Key: sk_live_abc123 → sk_live_XXXXXXXX
- Password: password: "secret" → password: "***REDACTED***"
- Token: TOKEN=abc123 → TOKEN=<your-token-here>
```

**第二步：在审计模块中增加脱敏检查**

```typescript
const SECRET_PATTERNS = [
  /(?:sk-|pk-|ghp_)[A-Za-z0-9]{10,}/g,
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /password\s*[:=]\s*['"][^'"]{4,}['"]/gi,
];

function checkSecretLeaks(content: string): SecretIssue[] { /* ... */ }
```

---

## 八、交互式关系图

**影响力：中 · 难度：中高**

### 问题

open-zread 目前没有代码/文档之间的关系可视化。

### nium-wiki 的做法

`graphRender.ts` 从 dep-graph + doc-index 构建三类边（import / refers / links）的图数据，用 Sigma.js 渲染为独立 HTML 页面：

- 节点拖拽、滚轮缩放、点击查看详情
- 按类型筛选（source / doc）
- 展开隐藏的关联节点
- 渐入式加载（大项目先显示 doc 节点 + 一级 source）

### 落地方案

open-zread 的 `open-zread browse` 已经有一个本地 Web 预览服务器。可以在此增加一个 `/graph` 路由。

新增文件：`packages/utils/src/output/graph-render.ts`

```
- buildGraphData(wikiPath, depGraph): GraphData
  - 从 SymbolManifest.imports 构建 source import 边
  - 从 wiki/ markdown 中的 Source 链接构建 source ↔ doc refers 边
  - 从 wiki/ markdown 中的跨文档链接构建 doc → doc links 边
  - 生成自包含的 Sigma.js HTML
```

在 `packages/cli` 的 browse 服务器中增加 `/graph` 路由。

> open-zread 的 Parser 已经提取了每个文件的 imports——这就是构建 import 边所需的原始数据。

---

## 九、增量修补模式

**影响力：中 · 难度：中**

### 问题

当只有 1-2 个源文件变更时，重新生成整个文档是浪费 Token 和时间。

### nium-wiki 的做法

"Surgical Edit" 模式：区分 `updateStrength: full`（签名变更）vs `updateStrength: incremental`（传递影响），后者只修补受影响段落：

- **不重新生成任何 Mermaid 图**
- 不套用 Quality Gate
- 只更新与触发变更源文件相关的段落

### 落地方案

在增量更新管道（改进四）的基础上，修改 `generate-wiki.ts`：

```typescript
function buildPagePrompt(page: WikiPage, plan?: IncrementalPlan): string {
  const affected = plan?.affectedDocs.find(d => d.docPath.endsWith(page.file));

  if (affected?.updateStrength === 'incremental') {
    // 外科手术模式：只修补 affected 段落
    return `${SurgicalEditPrompt}

## 🔴 增量修补规则
- 只更新与 ${affected.triggeredBy.join(', ')} 相关的段落
- 绝对不要修改 Mermaid 图
- 绝对不要重写未受影响的代码示例
- 保留现有章节结构不变
`;
  }

  // 全量生成模式
  return standardPagePrompt;
}
```

---

## 十、生成后收尾管道

**影响力：中 · 难度：低**

### 问题

open-zread 生成完 wiki/ 文件后没有收尾步骤——没有 sidebar 生成、没有链接修复、没有索引构建。

### nium-wiki 的做法

强制 Finalization Checklist（每次生成后必须执行）：

1. `generate-sidebar --all` → 生成 sidebar.json
2. `i18n sync-memory` → 翻译记忆同步
3. `audit-docs --mermaid-strict` → 质量审计

### 落地方案

在 `packages/orchestrator/src/wiki/generate-wiki.ts` 的 `generateWikiContent` 末尾增加收尾步骤：

```typescript
// 在 Promise.all(tasks) 之后增加：

async function finalize(outputDir: string, options: FinalizeOptions) {
  // 1. 修复 file:// 绝对路径为相对路径
  await sanitizeLinks(outputDir);

  // 2. 构建源文件 ↔ 文档双向索引
  await buildDocIndex(outputDir);

  // 3. 生成侧边栏配置
  await generateSidebar(outputDir);

  // 4. 可选：运行质量审计
  if (options.audit) {
    const report = await auditDocs(outputDir);
    logger.info(
      `Quality: ${report.professionalCount}/${report.totalDocs} professional`
    );
  }
}

await finalize(wikiDir, { audit: true });
```

---

## 优先级总览

| 优先级 | 改进项 | 预估改动量 | 理由 |
|--------|--------|-----------|------|
| **P0** | 一、Mermaid 质量体系 | ~100 行 Prompt + 新模块 200 行 | 最直接的文档质量提升 |
| **P0** | 六、复杂度自适应目标 | ~50 行 | 一行 Prompt 改动，效果立竿见影 |
| **P0** | 七、密钥脱敏 | ~30 行 Prompt + 审计模块 50 行 | 安全隐患，Prompt + 审计双重保障 |
| **P1** | 三、Facts-First 前置 | 新模块 ~200 行 + 管线编排 | 解决 LLM 幻觉，基础设施已有 |
| **P1** | 五、溯源增强 | ~30 行 Prompt | Prompt 改动为主，低难度 |
| **P1** | 二、质量审计层 | 新模块 ~300 行 | 需要新增模块但逻辑清晰 |
| **P1** | 十、生成后收尾 | ~100 行 | 补齐流程闭环 |
| **P2** | 四、精细增量更新 | 新模块 ~500 行 + 管线编排 | 工作量大但价值极高，已在 Roadmap |
| **P2** | 八、交互式关系图 | 新模块 ~400 行 + 前端模板 | 需要前端工作，但数据层已有 |
| **P2** | 九、增量修补模式 | ~100 行 + 依赖改进四 | 依赖改进四的增量管道 |

> **P0 三项改动加起来不超过 400 行代码**，主要是 Prompt 增强和轻量新模块，可以立即提升生成质量。P1 四项是下一个迭代的推荐目标。P2 是长期工程方向。

---

*基于 [nium-wiki](https://github.com/niuma996/nium-wiki) 与 open-zread 的深度架构对比分析 · 2026-05-24*
