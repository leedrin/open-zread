## Why

当前 `extractPageFacts()` 产出的 `PageFacts.exports[]` 只包含函数签名和文件路径。Page Agent 在生成文档时，对每个 API 的"用途、行为、注意事项"必须自己根据签名重新推理，这会引入两类问题：

1. **作者意图丢失**：原作者亲手写的 JSDoc / docstring 是最权威的语义来源，但 parser 没有提取，LLM 只能凭代码字面推断
2. **描述漂移**：同一个 API 在不同文档中的描述可能不一致，因为 LLM 每次推理结果不同

举例：

```typescript
/**
 * 构建三层 Repo Map：目录树、核心签名、模块详情。
 * 用于 Blueprint Agent 渐进式分析项目结构。
 *
 * @param opts 构建选项（threshold、tokenBudget 等）
 * @returns 三层 Repo Map 结构
 */
export function buildRepoMap(opts: BuildOpts): RepoMap { ... }
```

当前 Facts 只给 Agent 看到 `export function buildRepoMap(opts: BuildOpts): RepoMap`。上方 JSDoc 的"渐进式分析项目结构"这一关键设计意图完全丢失，LLM 只能瞎猜或省略。

`web-tree-sitter` 完全有能力提取 leading comment，但当前 parser 未做。改造点小、收益直接。

## What Changes

- **扩展 parser**：在符号提取时同步提取**紧邻其上方**的文档注释（JSDoc / TSDoc / Python docstring / Go doc comment / C# XML doc）
- **扩展类型**：`SymbolInfo.functions[]` 新增 `doc?: string` 字段；`ExportFact` 新增 `doc?: string` 字段
- **扩展 Facts 提取器**：`extractPageFacts()` 将 doc 透传到 `ExportFact.doc`
- **扩展 Page Prompt**：`buildPagePrompt()` 在 Facts 段落中显示作者原始注释；新增规则："优先以作者注释作为 API 用途描述"

向后兼容：`doc` 字段全部可选，无注释的符号不影响现有行为。

## Capabilities

### New Capabilities

- `doc-comment-extraction`: 按语言从 AST 提取符号上方文档注释的能力。支持 5 种注释风格：JSDoc/TSDoc（TS/JS）、Python docstring、Go doc comment、C# XML doc comment、Vue SFC 内 JSDoc。

### Modified Capabilities

- `facts-first`: PageFacts 的 ExportFact 携带作者原始注释；Page Agent Prompt 注入注释并约束 LLM 优先使用注释作为 API 用途描述。

## Impact

**代码变更：**

- `packages/types/src/symbols.ts` — `SymbolInfo.functions[]` 新增 `doc?: string`
- `packages/types/src/facts.ts` — `ExportFact` 新增 `doc?: string`
- `packages/repo-analyzer/src/parser/` — 新增 `doc-extractor.ts`，改造 `index.ts` 的 `extractWithQuery()` 和 `extractBasic()`
- `packages/repo-analyzer/src/repo-map/module-facts.ts` — 透传 `doc` 到 `ExportFact`
- `packages/orchestrator/src/wiki/generate-wiki.ts` — `buildPagePrompt()` 的 Facts 段落渲染 `doc`，新增 1 条 Facts 规则

**新增文件：**

- `packages/repo-analyzer/src/parser/doc-extractor.ts`
- `packages/repo-analyzer/src/parser/__tests__/doc-extractor.test.ts`

**API 变更：** 无破坏性变更，新字段全部可选。

**向后兼容：** parser 输出对未来读 `SymbolInfo` 的代码完全向后兼容。无注释的符号 `doc` 字段为 `undefined`，现有 Prompt 模板不渲染该字段时无视觉变化。

**预期效果：** API 描述准确率从约 70%（依赖 LLM 推理）提升到 95%+（基于原作者注释）。配合现有 Facts-First 基础设施，进一步削弱 LLM 在描述层面的幻觉空间。

## 来源

完整反思：[`docs/next-phase-improvements.md`](../../../docs/next-phase-improvements.md) 改进项 P0-1
