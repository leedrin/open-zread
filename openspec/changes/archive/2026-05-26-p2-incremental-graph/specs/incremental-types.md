# Spec: 增量管道类型定义

## Module: `packages/types/src/incremental.ts`

### 新增类型

```typescript
/**
 * DependencyGraph - 双向依赖图
 *
 * 从 SymbolManifest.imports 构建，描述源文件间的导入关系。
 */
export interface DependencyGraph {
  forward: Record<string, string[]>;
  reverse: Record<string, string[]>;
  edges: DependencyEdge[];
}

export interface DependencyEdge {
  source: string;
  target: string;
  kind: 'import' | 'dynamic_import' | 'reexport';
  symbols?: string[];
}

/**
 * AffectedDoc - 受变更影响的文档
 */
export interface AffectedDoc {
  docPath: string;
  page: import('./wiki').WikiPage;
  reason: 'source_changed' | 'dep_changed' | 'doc_dep_changed';
  updateStrength: 'full' | 'incremental';
  triggeredBy: string[];
  signatureChanged: boolean;
}

/**
 * IncrementalPlan - 增量更新计划
 */
export interface IncrementalPlan {
  changedFiles: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  affectedDocs: AffectedDoc[];
  unaffectedDocs: string[];
}

/**
 * GraphData - 图可视化数据
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
  metadata?: {
    exportCount?: number;
    pageCount?: number;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'import' | 'refers' | 'links';
}
```

### 修改文件

- `packages/types/src/index.ts`: 新增 `export * from './incremental.js';`
