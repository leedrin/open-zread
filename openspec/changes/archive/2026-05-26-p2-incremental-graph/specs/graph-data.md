# Spec: 图可视化数据构建

## Module: `packages/utils/src/output/graph-data.ts`

### 导入

```typescript
import type { DependencyGraph, GraphData, GraphNode, GraphEdge, WikiPage } from '@open-zread/types';
```

### 导出函数

```typescript
/**
 * 构建 GraphData 用于前端可视化
 *
 * 三类边:
 * 1. import: DependencyGraph.forward → source → source
 * 2. refers: source-files-index.json → source → doc
 * 3. links: markdown 文档间链接 → doc → doc
 */
export function buildGraphData(
  wikiPath: string,
  depGraph: DependencyGraph,
  pages: WikiPage[]
): GraphData
```

### 实现约束

- 节点 ID 使用文件路径（source 类型）或 slug（doc 类型）
- source 节点的 `group` 从文件路径提取包名（如 `packages/utils`）
- doc 节点的 `group` 使用 `WikiPage.section`
- `refers` 边从 `source-files-index.json` 读取（finalize.ts 已生成）
- `links` 边解析 markdown 中的 `[...](./path.md)` 模式
- 合并重复边（同一 source→target+kind 只保留一条）
