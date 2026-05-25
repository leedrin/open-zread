# Spec: 依赖图构建模块

## Module: `packages/utils/src/cache/dependency-graph.ts`

### 导入

```typescript
import type { SymbolManifest, DependencyGraph, DependencyEdge } from '@open-zread/types';
```

### 导出函数

```typescript
/**
 * 从 SymbolManifest 构建双向依赖图
 *
 * 解析每个文件的 imports 字段，提取相对路径导入关系。
 * 跳过 node_modules 和包别名以外的外部依赖。
 */
export function buildDependencyGraph(
  symbols: SymbolManifest,
  packageAliases?: Record<string, string>
): DependencyGraph

/**
 * 从指定源文件集合出发，BFS 遍历依赖图，返回所有受影响的文件
 *
 * @param sources 起始文件集合
 * @param graph 依赖图
 * @param maxDepth BFS 最大深度（默认 3）
 * @returns 受影响文件及其传播深度
 */
export function computeTransitiveImpact(
  sources: string[],
  graph: DependencyGraph,
  maxDepth?: number
): Map<string, { depth: number; reason: 'source_changed' | 'dep_changed' }>
```

### 实现约束

- `buildDependencyGraph` 必须处理 `SymbolInfo.imports` 中的原始文本格式
- 使用 `from\s+['"]([^'"]+)['"]` 正则提取导入路径
- 相对路径解析：以 `SymbolInfo.file` 的目录为基准
- 包别名解析：使用传入的 `packageAliases` 映射（默认为 monorepo workspace 配置）
- 不抛异常，解析失败的 import 静默跳过
