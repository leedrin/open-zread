# Tasks: P2 — 精细增量更新管道 + 交互式关系图 + 增量修补模式

## Phase 1: 类型与基础设施

### T1: 新增增量管道类型定义
- 在 `packages/types/src/incremental.ts` 中定义 `DependencyGraph`, `DependencyEdge`, `AffectedDoc`, `IncrementalPlan`, `GraphData`, `GraphNode`, `GraphEdge` 类型
- 在 `packages/types/src/index.ts` 中导出新模块
- **验证**: `bun run typecheck --filter=@open-zread/types` 通过

### T2: 实现依赖图构建模块
- 新建 `packages/utils/src/cache/dependency-graph.ts`
- 实现 `buildDependencyGraph(symbols, packageAliases)` — 解析 SymbolManifest.imports 构建双向依赖图
- 实现 `computeTransitiveImpact(sources, graph, maxDepth)` — BFS 遍历依赖图
- 复用 `reference-counter.ts` 的 `extractImportPath()` 正则模式
- 支持相对路径解析和包别名映射
- **验证**: 单元测试覆盖 import 路径解析、BFS 传播深度、环形依赖

### T3: 依赖图缓存
- 在 `packages/utils/src/cache/` 中新增依赖图序列化/反序列化
- 缓存路径: `.open-zread/cache/dependency-graph.json`
- 与 `saveCachedSymbols` / `loadCachedSymbols` 同级
- **验证**: `bun run typecheck --filter=@open-zread/utils` 通过

---

## Phase 2: 增量更新管道

### T4: 实现文档间依赖映射
- 在 `packages/utils/src/cache/incremental-pipeline.ts` 中实现 `buildDocToDocDeps(wikiPath)`
- 扫描 wiki 目录所有 `.md` 文件，提取跨文档链接
- 检测 `[text](./relative.md)` 和 `[text](/path/to/page)` 模式
- **验证**: 单元测试覆盖内部链接提取、外部链接排除

### T5: 实现增量更新计划计算
- 在 `packages/utils/src/cache/incremental-pipeline.ts` 中实现 `buildIncrementalPlan()`
- 四级传播: FileHashDiff → DepGraphBFS → SourceToDocs → DocToDoc
- 实现 `updateStrength` 判定逻辑（签名变更 → full，传递影响 → incremental）
- 签名变更检测：对比 `PageFacts.exports` 的 `signature` 字段
- **验证**: 单元测试覆盖 added/modified/removed 场景、BFS 传播、updateStrength 判定

### T6: 导出增量管道公共接口
- 从 `packages/utils/src/cache/index.ts` 导出 `buildDependencyGraph`, `computeTransitiveImpact`, `buildIncrementalPlan`, `buildDocToDocDeps`
- 从 `packages/utils/src/index.ts` 重新导出
- **验证**: `bun run typecheck && bun run lint` 通过

---

## Phase 3: 增量修补模式

### T7: 新增 ReadPageTool
- 在 `packages/orchestrator/src/tools/page-tools.ts` 中新增 `ReadPageTool`
- 从 `.open-zread/wiki/{section}/{file}` 读取现有文档内容
- 参数: `slug`, `section`, `file`（与 WritePageTool 一致）
- **验证**: `bun run typecheck --filter=@open-zread/orchestrator` 通过

### T8: 新增外科手术式修补 Prompt
- 新建 `packages/orchestrator/src/prompts/surgical-edit.ts`
- 实现 `buildSurgicalEditPrompt({ page, triggeredBy, existingContent })`
- Prompt 明确告知 Agent 只修补受影响段落，不重写文档
- **验证**: `bun run typecheck --filter=@open-zread/orchestrator` 通过

### T9: 修改 generateWikiContent 支持增量模式
- 修改 `packages/orchestrator/src/wiki/types.ts` — `GenerateWikiOptions` 新增 `incrementalPlan` 字段
- 修改 `packages/orchestrator/src/wiki/generate-wiki.ts`:
  - 如果有 `incrementalPlan`，只生成 `affectedDocs` 中的页面
  - `updateStrength === 'incremental'` 的页面使用 `buildSurgicalEditPrompt` + `ReadPageTool`
  - `updateStrength === 'full'` 的页面使用标准 `buildPagePrompt`
  - 增量修补模式 `maxTurns: 15`
- **验证**: `bun run typecheck && bun run lint` 通过

---

## Phase 4: 交互式关系图

### T10: 实现图数据构建
- 新建 `packages/utils/src/output/graph-data.ts`
- 实现 `buildGraphData(wikiPath, depGraph, pages)` — 构建三类边的 GraphData
- import 边: 从 DependencyGraph.forward 提取
- refers 边: 从 source-files-index.json 读取
- links 边: 解析 markdown 跨文档链接
- 从 `packages/utils/src/index.ts` 导出
- **验证**: `bun run typecheck --filter=@open-zread/utils` 通过

### T11: Browse Server 新增 /graph 端点
- 修改 `apps/cli/src/commands/browse-server.ts`
- 新增 `GET /api/wiki/graph` 端点
- 加载依赖图缓存或从 last_symbols.json 实时构建
- 调用 `buildGraphData()` 返回 GraphData JSON
- **验证**: `bun run typecheck --filter=cli` 通过；启动 browse 服务器后 `curl /api/wiki/graph` 返回 JSON

### T12: 前端图可视化页面
- 安装依赖: `cd apps/browse && bun add d3-force && bun add -d @types/d3-force`
- 新建 `apps/browse/src/pages/graph-page/`:
  - `index.tsx`: 页面组件，调用 API 获取图数据，渲染 GraphView
  - `GraphView.tsx`: D3 force-layout SVG 渲染组件
    - 节点按类型着色（source=蓝, doc=绿）
    - 边按类型着色（import=灰, refers=黄, links=紫）
    - 支持拖拽、缩放、点击详情
- 修改 `apps/browse/src/App.tsx` 新增 `/graph` 路由
- 修改导航栏新增 "Graph" 入口
- **验证**: `bun run typecheck --filter=browse` 通过；browse dev 环境下 `/graph` 页面可渲染

---

## 依赖关系

```
T1 → T2 → T3 → T4 → T5 → T6
                       ↓
                 T7 → T8 → T9
                 
T2 → T10 → T11 → T12
```

- Phase 1 (T1-T3) 是所有后续 Phase 的基础
- Phase 2 (T4-T6) 和 Phase 3 (T7-T9) 可以在 T3 之后并行推进
- Phase 4 (T10-T12) 在 T2 之后可以启动（依赖依赖图构建模块）
- T6 和 T9 是最终集成点，必须最后完成
