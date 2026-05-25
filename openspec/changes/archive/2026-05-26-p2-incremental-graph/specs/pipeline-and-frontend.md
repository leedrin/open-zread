# Spec: 增量修补 Prompt 与管线修改

## Module: `packages/orchestrator/src/prompts/surgical-edit.ts`

### 导出

```typescript
/**
 * 增量修补 Prompt 模板
 *
 * 当 updateStrength === 'incremental' 时使用，指导 Agent 只修补受影响段落。
 */
export function buildSurgicalEditPrompt(options: {
  page: WikiPage;
  triggeredBy: string[];
  existingContent: string;
}): string
```

### Prompt 内容约束

- 明确告知 Agent 这是修补任务，不是重写任务
- 列出触发变更的源文件列表（triggeredBy）
- 要求保留 Mermaid 图表不变
- 要求保留未受影响的代码示例不变
- 要求输出完整文档（包含未修改部分）
- maxTurns 降低为 15

## Module: `packages/orchestrator/src/wiki/generate-wiki.ts` (修改)

### 变更点

1. `GenerateWikiOptions` 新增字段:

```typescript
interface GenerateWikiOptions {
  // ... existing fields ...
  incrementalPlan?: IncrementalPlan;  // 新增
}
```

2. `generateWikiContent` 函数修改:

- 如果 `incrementalPlan` 存在且 `affectedDocs.length > 0`:
  - 只生成 `affectedDocs` 中的页面
  - `updateStrength === 'incremental'` 的页面使用 `buildSurgicalEditPrompt`
  - `updateStrength === 'full'` 的页面使用标准 `buildPagePrompt`
- 如果 `incrementalPlan` 不存在或 `affectedDocs.length === 0`:
  - 保持现有全量生成行为

3. 新增 `ReadPageTool`:

```typescript
// packages/orchestrator/src/tools/page-tools.ts
export const ReadPageTool: ToolDefinition = {
  name: 'read_page',
  description: '读取现有 Wiki 页面内容',
  parameters: z.object({
    slug: z.string(),
    section: z.string(),
    file: z.string(),
  }),
  // 实现: 从 .open-zread/wiki/{section}/{file} 读取
};
```

- 只在增量修补模式下添加到 Agent 工具列表

## Module: `packages/orchestrator/src/wiki/types.ts` (修改)

### 新增类型

```typescript
interface GenerateWikiOptions {
  // ... existing ...
  incrementalPlan?: IncrementalPlan;
}
```

## Module: `apps/cli/src/commands/browse-server.ts` (修改)

### 新增端点

```
GET /api/wiki/graph
  - 读取 wiki.json 获取 pages
  - 读取 source-files-index.json 获取 refers 映射
  - 如果 .open-zread/cache/dependency-graph.json 存在，加载它
  - 否则，从 last_symbols.json 实时构建依赖图
  - 调用 buildGraphData() 返回图数据
  Response: GraphData JSON
```

## Module: `apps/browse/` (新增前端)

### 新增文件

- `src/pages/graph-page/index.tsx`: 页面组件，调用 `/api/wiki/graph` 获取数据
- `src/pages/graph-page/GraphView.tsx`: D3 force-layout 渲染组件

### GraphView 组件规范

- 使用 `d3-force` (`forceSimulation`, `forceLink`, `forceManyBody`, `forceCenter`)
- 节点颜色: source = `#3B82F6`（蓝），doc = `#10B981`（绿）
- 节点大小: 按 `metadata.exportCount` 或 `metadata.pageCount` 缩放
- 边颜色: import = `#94A3B8`（灰），refers = `#F59E0B`（黄），links = `#8B5CF6`（紫）
- 支持鼠标拖拽、滚轮缩放
- 点击节点弹出详情面板（关联文件列表、引用关系）
- 响应式布局，占满容器

### 路由修改

- `App.tsx`: 新增 `<Route path="/graph" element={<GraphPage />} />`
- 导航栏: 新增 "Graph" 链接

### 依赖变更

- `package.json` 新增: `d3-force`, `@types/d3-force`
