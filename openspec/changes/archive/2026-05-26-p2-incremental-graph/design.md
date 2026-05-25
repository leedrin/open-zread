# Design: P2 — 精细增量更新管道 + 交互式关系图 + 增量修补模式

## Architecture Overview

三项改进共享一个核心数据流：

```
SymbolManifest.imports
  → DependencyGraph (双向依赖图)
    → IncrementalPipeline (变更传播)
      → IncrementalPlan (affectedDocs 列表)
        → SurgicalEditPrompt (增量修补)
    → GraphData (图可视化数据)
      → /api/wiki/graph (Browse API)
```

依赖图是三项功能的基础设施，必须最先实现。

---

## 1. 依赖图 (DependencyGraph)

### 数据结构

```typescript
// packages/types/src/incremental.ts

interface DependencyEdge {
  source: string;       // 源文件路径
  target: string;       // 目标文件路径
  kind: 'import' | 'dynamic_import' | 'reexport';
  symbols?: string[];   // 具体导入的符号名
}

interface DependencyGraph {
  forward: Map<string, Set<string>>;   // file → 它依赖了谁
  reverse: Map<string, Set<string>>;   // file → 谁依赖了它
  edges: DependencyEdge[];
}
```

### 构建算法

从 `SymbolManifest.imports`（当前为原始 import 语句文本）解析：

1. 对每条 import 语句用正则 `from\s+['"]([^'"]+)['"]` 提取路径
2. 相对路径 (`./`, `../`) → 解析为项目相对路径（需配合 `SymbolInfo.file` 的目录）
3. 包别名 (`@open-zread/types`) → 通过 `packages/*/package.json` 的映射表解析为实际路径
4. 外部包 (`react`, `fs`) → 跳过，不加入图

### 设计决策

- **D1: import 解析策略** — 使用正则提取而非 AST 重新解析。当前 `reference-counter.ts` 已有此模式，复用其 `extractImportPath()` 逻辑。
- **D2: 包别名解析** — 维护一个静态映射表 `{ '@open-zread/types': 'packages/types/src', ... }`，从 monorepo 的 workspace 配置自动生成。不做完整的 node_modules 解析。
- **D3: 图存储** — 使用 Map 而非邻接矩阵，因为依赖图是稀疏的。序列化时转为 JSON。
- **D4: 缓存** — `DependencyGraph` 随 `SymbolManifest` 一起缓存到 `.open-zread/cache/dependency-graph.json`。

---

## 2. 增量更新管道 (IncrementalPipeline)

### 四级传播

```
Level 1: FileHashDiff — 对比 CacheManifest.files 的 MD5 hash
  → addedFiles[], modifiedFiles[], removedFiles[]

Level 2: DepGraphBFS — 从变更文件出发 BFS (maxDepth=3)
  → affectedSourceFiles: { file, depth, reason }

Level 3: DocIndex — sourceToDocs 映射（已有，在 finalize.ts）
  → affectedDocs by source_changed

Level 4: DocToDocDeps — 文档间相互链接
  → affectedDocs by doc_dep_changed
```

### 数据结构

```typescript
interface AffectedDoc {
  docPath: string;           // wiki 相对路径，如 "core/repo-analyzer.md"
  page: WikiPage;            // 对应的 WikiPage 定义
  reason: 'source_changed' | 'dep_changed' | 'doc_dep_changed';
  updateStrength: 'full' | 'incremental';
  triggeredBy: string[];     // 触发变更的源文件列表
  signatureChanged: boolean; // 导出签名是否变更
}

interface IncrementalPlan {
  changedFiles: { added: string[]; modified: string[]; removed: string[] };
  affectedDocs: AffectedDoc[];
  unaffectedDocs: string[];  // 无需更新的文档
  depGraph: DependencyGraph;
}
```

### updateStrength 判定逻辑

```
full:
  - modified 文件的 exports 列表发生变化（签名变更）
  - removed 文件（整个模块消失）

incremental:
  - BFS 传递影响的文件（dep_changed）
  - 文档间引用传播（doc_dep_changed）
  - modified 但 exports 未变的文件（内部实现变更）
```

### 签名变更检测

对比 `PageFacts.exports` 的 `signature` 字段（P1 已实现 Facts-First）。如果任何导出符号的签名发生变化，标记为 `full`。

### 设计决策

- **D5: BFS maxDepth** — 默认 3 层。经验上 3 层覆盖了绝大多数有意义的传播路径，更深的影响通常太弱不值得更新。
- **D6: 文档间依赖** — 通过解析 markdown 中的 `[...]({{< relref "..." >}})` 和 `[...](./path.md)` 模式检测。当前 `buildDocIndex()` 只解析源文件链接，需要扩展。
- **D7: 缓存策略** — `IncrementalPlan` 不缓存，每次实时计算（因为依赖当前文件状态）。`DependencyGraph` 缓存。
- **D8: 与现有管线集成** — `generateWikiContent()` 新增 `incrementalPlan` 参数。如果传入，只生成 `affectedDocs` 中的页面；如果为空或未传入，全量生成。

---

## 3. 增量修补模式 (Surgical Edit)

### Prompt 设计

当 `updateStrength === 'incremental'` 时，使用 `SurgicalEditPrompt` 替代标准 `PageAgentPrompt`：

```typescript
const SurgicalEditPrompt = `
你是一个文档增量修补专家。你的任务是**精准修补**现有文档中受影响的部分，而不是重写整个文档。

## 🔴 增量修补规则（强制）
1. 只更新与 ${triggeredBy} 相关的段落
2. **绝对不要**修改任何 Mermaid 图表
3. **绝对不要**重写未受影响的代码示例
4. 保留现有章节结构不变
5. 如果只需更新一段话，就只更新那段话
6. 修改后确保文档的连贯性

## 工作流
1. 先读取现有文档内容
2. 定位与变更文件相关的段落
3. 精准修改受影响内容
4. 输出完整文档（包含未修改部分）
`;
```

### 工具链变化

增量修补模式下，Agent 需要额外的 `ReadPageTool` 来读取现有文档：

- 标准模式：Agent 工具 = `[FileRead, FileEdit, Glob, Grep, WritePage]`
- 增量模式：Agent 工具 = `[FileRead, FileEdit, Glob, Grep, ReadPage, WritePage]`

### 设计决策

- **D9: 输出方式** — 增量修补仍然使用 `WritePageTool` 输出完整文档，而不是输出 diff。因为 LLM 生成 diff 的可靠性不如生成完整内容。
- **D10: maxTurns** — 增量修补模式 `maxTurns: 15`（低于标准的 30），因为修补任务更轻量。
- **D11: full 模式** — `updateStrength === 'full'` 时仍然使用标准 Prompt 全量重新生成，但只对受影响的页面执行。

---

## 4. 交互式关系图 (Interactive Graph)

### API 设计

新增 Browse Server 端点：

```
GET /api/wiki/graph
  Response: {
    nodes: Array<{
      id: string;          // 文件路径或文档 slug
      label: string;       // 显示名称
      type: 'source' | 'doc';
      group?: string;      // 所属 section/package
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: 'import' | 'refers' | 'links';
    }>;
  }
```

### 图数据构建

```typescript
function buildGraphData(
  wikiPath: string,
  depGraph: DependencyGraph,
  pages: WikiPage[]
): GraphData
```

三类边的构建方式：

1. **import 边**：从 `DependencyGraph.forward` 提取，`source → target` 两个都是源文件
2. **refers 边**：从 `source-files-index.json` 的 `sourceToDocs` 提取，源文件 → 文档
3. **links 边**：解析 wiki markdown 中的 `[...](./other-page.md)` 链接，文档 → 文档

### 前端方案

在 `apps/browse/` 中新增 `GraphPage`：

- 使用 D3 force-layout（轻量，无需新增大依赖）
- 节点按类型着色（source = 蓝色，doc = 绿色）
- 支持拖拽、缩放、点击查看详情
- 左侧面板显示节点详情（关联文件、引用关系）
- 路由：`/graph`

### 设计决策

- **D12: 为什么不用 Sigma.js** — Sigma.js 约 200KB gzipped，对于中小型项目的图来说过重。D3 force-layout 约 70KB，且 browse 应用已有 TailwindCSS + React 生态，D3 集成更自然。
- **D13: 图数据缓存** — 图数据由 API 实时计算，不缓存。因为图数据相对轻量（通常 <1000 节点），计算耗时 <100ms。
- **D14: 前端依赖** — 安装 `d3-force` + `@types/d3-force`，不安装完整 `d3` 包以控制 bundle 大小。

---

## 5. 模块依赖关系

```
packages/types/src/incremental.ts     ← 新增类型定义
    ↑
packages/utils/src/cache/incremental-pipeline.ts  ← 增量管道核心
    ↑
packages/utils/src/cache/dependency-graph.ts       ← 依赖图构建
    ↑
packages/utils/src/output/graph-data.ts            ← 图数据构建
    ↑
packages/orchestrator/src/wiki/generate-wiki.ts    ← 管线编排修改
    ↑
apps/cli/src/commands/browse-server.ts             ← API 端点
    ↑
apps/browse/src/pages/graph-page/                  ← 前端页面
```

---

## 6. 受影响的现有文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/types/src/index.ts` | 修改 | 导出新增的 incremental 类型 |
| `packages/utils/src/cache/index.ts` | 修改 | 集成增量管道 |
| `packages/orchestrator/src/wiki/generate-wiki.ts` | 修改 | 支持增量模式 |
| `packages/orchestrator/src/wiki/types.ts` | 修改 | 新增 IncrementalPlan 参数 |
| `packages/orchestrator/src/tools/page-tools.ts` | 修改 | 新增 ReadPageTool |
| `apps/cli/src/commands/browse-server.ts` | 修改 | 新增 /graph 端点 |
| `apps/browse/src/App.tsx` | 修改 | 新增 /graph 路由 |
| `apps/browse/package.json` | 修改 | 添加 d3-force 依赖 |

---

## 7. 新增文件

| 文件 | 包 | 说明 |
|------|---|------|
| `packages/types/src/incremental.ts` | types | 增量管道类型定义 |
| `packages/utils/src/cache/dependency-graph.ts` | utils | 依赖图构建与 BFS |
| `packages/utils/src/cache/incremental-pipeline.ts` | utils | 四级增量传播管道 |
| `packages/utils/src/output/graph-data.ts` | utils | 图可视化数据构建 |
| `packages/orchestrator/src/prompts/surgical-edit.ts` | orchestrator | 增量修补 Prompt |
| `apps/browse/src/pages/graph-page/index.tsx` | browse | 图可视化页面 |
| `apps/browse/src/pages/graph-page/GraphView.tsx` | browse | D3 force 图组件 |
