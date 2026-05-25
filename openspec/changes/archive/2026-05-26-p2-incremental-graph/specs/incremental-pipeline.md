# Spec: 增量更新管道模块

## Module: `packages/utils/src/cache/incremental-pipeline.ts`

### 导入

```typescript
import type {
  FileManifest, CacheManifest, SymbolManifest,
  DependencyGraph, IncrementalPlan, AffectedDoc, WikiPage, PageFacts
} from '@open-zread/types';
import { diffManifests } from './index.js';
import { buildDependencyGraph, computeTransitiveImpact } from './dependency-graph.js';
```

### 导出函数

```typescript
/**
 * 构建文档间依赖映射
 *
 * 解析 wiki 目录下 markdown 中的跨文档链接，构建 doc → doc 的引用关系。
 * 检测模式: [text](./relative.md) 和 [text](/path/to/page)
 */
export function buildDocToDocDeps(wikiPath: string): Map<string, string[]>

/**
 * 计算增量更新计划
 *
 * 四级传播:
 * 1. FileHashDiff → changedFiles
 * 2. DepGraphBFS → affectedSourceFiles
 * 3. SourceToDocs mapping → affectedDocs (source_changed)
 * 4. DocToDoc deps → affectedDocs (doc_dep_changed)
 *
 * @returns IncrementalPlan 包含所有受影响文档及其更新策略
 */
export async function buildIncrementalPlan(options: {
  cached: CacheManifest;
  current: FileManifest;
  symbols: SymbolManifest;
  wikiPath: string;
  pages: WikiPage[];
  previousFacts?: Map<string, PageFacts>;
}): Promise<IncrementalPlan>
```

### 实现约束

- `buildDocToDocDeps` 使用 `readdirSync` 递归扫描 wiki 目录
- 链接检测正则: `/\[([^\]]+)\]\((?!http)([^)]+\.md)\)/g`
- `buildIncrementalPlan` 调用 `diffManifests()` 获取文件变更
- `updateStrength` 判定:
  - `full`: exports 签名变更（对比 PageFacts.exports 的 signature）或文件被删除
  - `incremental`: dep_changed、doc_dep_changed、或文件修改但 exports 不变
- `previousFacts` 为可选参数。如果不存在，所有 modified 文件的变更都视为 `full`
