## Why

当前 `buildDependencyGraph()` 使用单一正则 `from\s+['"]...['"]` 提取 import 路径，只有 TypeScript/JavaScript 的 ES module import 能被解析。Go、Python、C# 项目的 import 全部被丢弃，导致关系图中所有非 TS 节点都是孤立节点。同时，即使 TS 项目也缺乏 tsconfig paths 别名解析和完整的扩展名探测（只试 `.ts`），monorepo 中的跨包引用大量丢失。

## What Changes

- 引入 **Extractor 模式**：每种语言一个独立的 Extractor 类（TS/JS、Go、Python、C#），用 tree-sitter AST 的 `childForFieldName()` 提取结构化 import 数据 `{ source, specifiers, lineNumber }`，替代当前的 `node.text` 扁平存储
- 引入 **Resolver 层**：独立的路径解析模块，按语言分发到不同的解析策略（tsconfig 别名 + 扩展名探测、go.mod 前缀剥离、相对层级 + `__init__.py` 回退、路径后缀索引）
- 扩展 `SymbolInfo` 类型：新增 `structuredImports: ImportInfo[]` 和 `language: string` 字段，保持 `imports: string[]` 向后兼容
- 改造 `buildDependencyGraph()`：消费 Resolver 的输出替代正则提取

## Capabilities

### New Capabilities
- `language-extractor`: 按语言从 AST 提取结构化 import 数据的 Extractor 接口和 4 种语言实现（TypeScript/JS、Go、Python、C#）
- `import-resolver`: 将 import source string 解析为项目内文件路径的 Resolver 层，包含 4 种解析策略和统一的解析上下文构建

### Modified Capabilities

## Impact

- `packages/types/src/symbols.ts`：SymbolInfo 新增字段
- `packages/repo-analyzer/src/parser/`：引入 extractors 目录，改造 `index.ts` 的 import 提取逻辑
- `packages/utils/src/cache/`：引入 resolvers 目录，改造 `dependency-graph.ts` 消费 Resolver 输出
- 级联影响（读 `imports` 的模块需同步改为优先读 `structuredImports`）：
  - `packages/repo-analyzer/src/repo-map/reference-counter.ts`
  - `packages/repo-analyzer/src/repo-map/module-facts.ts`
  - `packages/repo-analyzer/src/repo-map/formatter.ts`
  - `packages/utils/src/cache/incremental-pipeline.ts`
