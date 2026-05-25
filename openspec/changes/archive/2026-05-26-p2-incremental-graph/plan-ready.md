# Implementation Plan: p2-incremental-graph

## Source
- Proposal: openspec/changes/p2-incremental-graph/proposal.md
- Design: openspec/changes/p2-incremental-graph/design.md
- Specs: openspec/changes/p2-incremental-graph/specs/
- Tasks: openspec/changes/p2-incremental-graph/tasks.md

## Execution Order

### Task 1: 新增增量管道类型定义
- Goal: 在 `@open-zread/types` 中定义所有增量管道和图数据相关的 TypeScript 类型
- Source tasks: T1
- Design anchors: Section 1 (DependencyGraph 数据结构), Section 2 (IncrementalPlan 数据结构), Section 4 (GraphData 数据结构)
- Changed files:
  - `packages/types/src/incremental.ts` (新建)
  - `packages/types/src/index.ts` (修改，新增 export)
- Validation: `bun run typecheck --filter=@open-zread/types`
- Depends on: none
- Notes: 类型文件是所有后续模块的基础，必须最先完成。注意 `AffectedDoc.page` 引用 `WikiPage` 时使用 `import('./wiki').WikiPage` 避免循环依赖。

### Task 2: 实现依赖图构建 — import 路径解析与双向图
- Goal: 实现 `buildDependencyGraph()` 和 `computeTransitiveImpact()` 核心函数
- Source tasks: T2
- Design anchors: Section 1 (依赖图), D1 (import 解析策略), D2 (包别名解析), D3 (Map 存储)
- Changed files:
  - `packages/utils/src/cache/dependency-graph.ts` (新建)
- Validation: `bun run typecheck --filter=@open-zread/utils`；编写单元测试验证: (1) 相对路径 import 正确解析 (2) 包别名映射工作 (3) BFS 深度限制 (4) 环形依赖不无限循环
- Depends on: Task 1
- Notes: 复用 `packages/repo-analyzer/src/repo-map/reference-counter.ts:44` 的 `extractImportPath()` 正则。包别名映射应从 monorepo 的 `packages/*/package.json` 的 `name` 字段自动构建。`computeTransitiveImpact` 使用 `reverse` 图做 BFS（从被依赖方反向查找所有依赖方）。

### Task 3: 依赖图缓存读写
- Goal: 依赖图可以序列化到缓存文件并加载
- Source tasks: T3
- Design anchors: D4 (缓存策略)
- Changed files:
  - `packages/utils/src/cache/dependency-graph.ts` (修改，新增序列化函数)
  - `packages/utils/src/cache/constants.ts` (修改，新增缓存文件名常量)
- Validation: `bun run typecheck --filter=@open-zread/utils`；测试 round-trip 序列化
- Depends on: Task 2
- Notes: 缓存路径 `.open-zread/cache/dependency-graph.json`。序列化时 Map → Record 反序列化时 Record → Map。与现有 `saveCachedManifest` 模式一致。

### Task 4: 实现文档间依赖映射
- Goal: 从 wiki markdown 文件中提取跨文档链接，构建 doc→doc 引用关系
- Source tasks: T4
- Design anchors: D6 (文档间依赖), Section 2 (四级传播)
- Changed files:
  - `packages/utils/src/cache/incremental-pipeline.ts` (新建)
- Validation: `bun run typecheck --filter=@open-zread/utils`；测试: (1) 内部链接 `[text](./page.md)` 正确提取 (2) 外部链接 `http://` 排除 (3) 源文件链接 `[Source: ...](...)` 排除
- Depends on: Task 1
- Notes: 检测正则 `/\[([^\]]+)\]\((?!http)([^)]+\.md)\)/g`。使用 `readdirSync` 递归扫描 wiki 目录，复用 `finalize.ts` 的 `collectMdFiles()` 模式。

### Task 5: 实现增量更新计划计算
- Goal: 四级传播管道：FileHashDiff → DepGraphBFS → SourceToDocs → DocToDoc，输出 `IncrementalPlan`
- Source tasks: T5
- Design anchors: Section 2 (四级传播), D5 (BFS maxDepth), D7 (缓存策略), D8 (管线集成)
- Changed files:
  - `packages/utils/src/cache/incremental-pipeline.ts` (修改，新增 `buildIncrementalPlan`)
- Validation: `bun run typecheck --filter=@open-zread/utils`；测试场景: (1) 单文件修改 → source_changed + dep_changed 传播 (2) export 签名变更 → full (3) 内部实现变更 exports 不变 → incremental (4) 新增文件 → affectedDocs 包含引用该文件路径的文档
- Depends on: Task 2, Task 4
- Notes: 签名变更检测对比 `PageFacts.exports[].signature`。SourceToDocs 映射读取 `source-files-index.json`（由 `finalize.ts` 生成）。`previousFacts` 为可选参数——如果不存在，所有 modified 文件视为 full。

### Task 6: 导出增量管道公共接口
- Goal: 从 utils 包的公共入口导出所有新增函数，确保外部包可以 import
- Source tasks: T6
- Design anchors: Section 5 (模块依赖关系)
- Changed files:
  - `packages/utils/src/cache/index.ts` (修改，新增 re-export)
  - `packages/utils/src/index.ts` (修改，新增 re-export)
- Validation: `bun run typecheck && bun run lint` 全局通过
- Depends on: Task 5
- Notes: 导出 `buildDependencyGraph`, `computeTransitiveImpact`, `buildIncrementalPlan`, `buildDocToDocDeps`。遵循现有的 barrel export 模式。

### Task 7: 新增 ReadPageTool
- Goal: Agent 工具链新增读取现有 wiki 页面的工具，供增量修补模式使用
- Source tasks: T7
- Design anchors: Section 3 (工具链变化)
- Changed files:
  - `packages/orchestrator/src/tools/page-tools.ts` (修改，新增 ReadPageTool)
- Validation: `bun run typecheck --filter=@open-zread/orchestrator`
- Depends on: Task 1
- Notes: ReadPageTool 参数与 WritePageTool 一致 (`slug`, `section`, `file`)。读取路径: `.open-zread/wiki/{section}/{file}`。使用 `WikiStore.readPage()` 如果可用，否则直接 `readFileSync`。

### Task 8: 新增外科手术式修补 Prompt
- Goal: 创建增量修补模式的专用 Prompt 模板
- Source tasks: T8
- Design anchors: Section 3 (Prompt 设计), D9 (输出方式)
- Changed files:
  - `packages/orchestrator/src/prompts/surgical-edit.ts` (新建)
- Validation: `bun run typecheck --filter=@open-zread/orchestrator`
- Depends on: none (纯文本模板)
- Notes: Prompt 必须强调: (1) 只修补 triggeredBy 相关段落 (2) 不修改 Mermaid 图 (3) 不重写未受影响代码 (4) 输出完整文档。参考现有 `page-agent.ts` 的格式风格。

### Task 9: 修改 generateWikiContent 支持增量模式
- Goal: 主生成管线支持 `incrementalPlan` 参数，根据 AffectedDoc 列表决定生成策略
- Source tasks: T9
- Design anchors: D8 (管线集成), D10 (maxTurns), D11 (full 模式)
- Changed files:
  - `packages/orchestrator/src/wiki/types.ts` (修改，新增 `incrementalPlan` 字段)
  - `packages/orchestrator/src/wiki/generate-wiki.ts` (修改核心生成逻辑)
- Validation: `bun run typecheck --filter=@open-zread/orchestrator && bun run lint`；手动验证: 传入 incrementalPlan 后只生成 affectedDocs 页面
- Depends on: Task 6, Task 7, Task 8
- Notes: 关键修改点: (1) `pages` 过滤：`const pagesToGenerate = options.incrementalPlan ? options.incrementalPlan.affectedDocs.map(d => d.page) : pages` (2) Prompt 选择：根据 `updateStrength` 选择 `buildSurgicalEditPrompt` 或 `buildPagePrompt` (3) 工具列表：incremental 模式添加 `ReadPageTool` (4) maxTurns：incremental=15, full=30。**这是最关键的集成任务**。

### Task 10: 实现图数据构建
- Goal: 构建 GraphData（nodes + edges），供前端可视化消费
- Source tasks: T10
- Design anchors: Section 4 (图数据构建), D13 (图数据缓存)
- Changed files:
  - `packages/utils/src/output/graph-data.ts` (新建)
  - `packages/utils/src/index.ts` (修改，新增导出)
- Validation: `bun run typecheck --filter=@open-zread/utils`；测试: (1) import 边正确从 DependencyGraph 提取 (2) refers 边从 source-files-index.json 读取 (3) links 边从 markdown 解析 (4) 去重
- Depends on: Task 2
- Notes: `refers` 边依赖 `source-files-index.json`（finalize.ts 已生成）。`links` 边复用 Task 4 的 `buildDocToDocDeps` 逻辑。节点 group: source→包名, doc→section。合并重复边（同一 source→target+kind）。

### Task 11: Browse Server 新增 /graph API 端点
- Goal: Express 服务器新增 `/api/wiki/graph` 端点，返回 GraphData JSON
- Source tasks: T11
- Design anchors: Section 4 (API 设计)
- Changed files:
  - `apps/cli/src/commands/browse-server.ts` (修改)
- Validation: `bun run typecheck --filter=cli`；启动 browse 后 `curl http://localhost:3000/api/wiki/graph | jq '.nodes | length'` 返回数字
- Depends on: Task 10
- Notes: 端点逻辑: (1) 检查 `.open-zread/cache/dependency-graph.json` 是否存在 (2) 存在则加载，不存在则从 `last_symbols.json` 构建 (3) 加载 `wiki.json` 获取 pages (4) 调用 `buildGraphData()` (5) 返回 JSON。错误处理：如果缺少数据，返回空 `{ nodes: [], edges: [] }`。

### Task 12: 前端图可视化页面
- Goal: browse 前端新增 `/graph` 页面，用 D3 force-layout 渲染交互式关系图
- Source tasks: T12
- Design anchors: Section 4 (前端方案), D12 (为什么不用 Sigma.js), D14 (前端依赖)
- Changed files:
  - `apps/browse/package.json` (修改，新增 d3-force 依赖)
  - `apps/browse/src/pages/graph-page/index.tsx` (新建)
  - `apps/browse/src/pages/graph-page/GraphView.tsx` (新建)
  - `apps/browse/src/pages/index.ts` (修改，导出 GraphPage)
  - `apps/browse/src/App.tsx` (修改，新增 /graph 路由)
  - `apps/browse/src/layouts/MainLayout.tsx` 或导航组件 (修改，新增 Graph 链接) — to confirm
- Validation: `bun run typecheck --filter=browse`；`cd apps/browse && bun run dev` 后访问 `/graph` 页面能看到图
- Depends on: Task 11
- Notes: (1) 先 `cd apps/browse && bun add d3-force && bun add -d @types/d3-force` (2) GraphView 使用 SVG + `useRef` + `useEffect` 挂载 D3 (3) 参考 browse 现有组件风格（TailwindCSS + lucide-react）(4) 节点颜色: source=`#3B82F6`, doc=`#10B981` (5) 需要确认 MainLayout 中导航栏的位置以添加 Graph 链接。
