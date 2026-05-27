## Context

open-zread 使用 web-tree-sitter 进行 AST 解析。当前 parser（`packages/repo-analyzer/src/parser/index.ts`）通过 SCM query 捕获 import 节点，但只存储 `node.text`（完整原始文本），丢掉了 AST 结构信息。下游的 `buildDependencyGraph()`（`packages/utils/src/cache/dependency-graph.ts`）使用单一正则 `from\s+['"]([^'"]+)['"]` 提取路径，只有 TS/JS 的 ES module import 能被解析。

当前 parser 已支持 8 种语言（TS、TSX、JS、JSX、Vue、Go、Python、C#），每种语言都有对应的 SCM query。但 import 提取是语言无关的——全靠下游正则。这导致 Go、Python、C# 项目的依赖图全是孤立节点。

参考项目 Understand-Anything（38.7k stars）使用了 Extractor + Resolver 分层架构，对 9 种语言提供了完整的 import 解析。本设计借鉴其架构，但适配 open-zread 的 monorepo 包结构。

## Goals / Non-Goals

**Goals:**
- 所有已支持语言（TS/JS/Vue、Go、Python、C#）的 import 都能正确解析为项目内文件路径
- DependencyGraph 的 forward/reverse/edges 对所有语言完整可用
- 关系图（D3）对所有语言都能正确绘制节点间的连线
- 向后兼容：现有读 `imports: string[]` 的代码无需立即修改

**Non-Goals:**
- 不引入新语言（Rust、Java、C++ 等），只改进已有语言的支持
- 不做函数级 call graph 提取（这是后续改进）
- 不做 API 端点发现（这是另一个 change）
- 不做设计模式识别或保护机制检测
- 不重构 parser 的 export/function 提取逻辑（保持现有 SCM query 方式）

## Decisions

### D1: Extractor 模式替代 SCM query 的 import 提取

**选择**：为每种语言创建独立的 Extractor 类，直接用 `childForFieldName()` 从 AST 提取结构化 import。

**替代方案**：
- 在现有 SCM query 中增加 `@import_source` 捕获 → 不可行，SCM query 的 captures 不能自定义提取逻辑
- 在 `buildDependencyGraph` 中加更多正则 → 延续错误路线，精度低

**理由**：AST 已有完整的结构信息（import 的 source、specifiers、别名等），`childForFieldName()` 提取精度 100%，无需正则回溯。Go 的分组 import 在 AST 中自然拆分为多个 `import_spec` 子节点，不需要正则拆分。

### D2: Resolver 层独立于 Extractor

**选择**：Extractor 只负责 AST → `{ source, specifiers }` 的提取。Resolver 负责将 source string 解析为项目内文件路径。

**理由**：两种职责的复杂度不同。Extractor 是确定性的 AST 遍历；Resolver 需要项目级上下文（tsconfig、go.mod、文件集合）。分离后 Extractor 不需要文件系统访问，Resolver 不需要 AST 知识。

### D3: 四种 Resolver 策略

| 语言 | 策略 | 核心机制 |
|------|------|----------|
| TS/JS/Vue | 配置驱动 | tsconfig paths 别名匹配 + 10 种扩展名探测 |
| Go | 模块系统 | go.mod 前缀剥离 + 目录级映射（包级返回） |
| Python | 探测型 | 前导点计数（相对层级）+ `.py` / `__init__.py` 回退 |
| C# | 索引型 | 路径后缀索引（点→斜杠 + `.cs`） |

**C# 的关键决策**：不解析 `namespace` 声明建立反向索引，而是使用路径后缀索引。`using MyApp.Services` → 查找 `MyApp/Services.cs`。大多数 C# 项目遵循 namespace = directory 约定，后缀索引在不解析 namespace 的情况下也能工作。外部命名空间（`System.Collections.Generic`）自然无法匹配，被静默丢弃。

### D4: ResolutionContext 一次构建，全局共享

**选择**：启动时构建 `ResolutionContext`（fileSet、tsConfigs、goModules、goFilesByDir、suffixIndex），所有 Resolver 共享。

**理由**：避免每个文件的每个 import 都重新读 tsconfig/go.mod。50K 文件的 monorepo 中，go.mod 和 tsconfig 数量有限（通常 < 20），一次读取缓存后复用。

### D5: SymbolInfo 类型扩展策略

**选择**：新增 `structuredImports: ImportInfo[]` 和 `language: string` 字段，保留 `imports: string[]` 不变。

```typescript
interface ImportInfo {
  source: string;
  specifiers: string[];
  lineNumber?: number;
}
```

**理由**：`imports: string[]` 被 reference-counter、module-facts、formatter、incremental-pipeline 等多个模块读取。直接改类型需要同时修改所有消费者。新增字段可以在不破坏现有功能的情况下逐步迁移。

### D6: Vue 的处理方式

**选择**：Vue 的 `<script>` 块已有 `vue-handler.ts` 独立处理。Vue import 最终是 TS/JS import，使用 TypeScriptExtractor 提取，TS Resolver 解析。

**理由**：vue-handler 已经把 `<script>` 块的 import 提取为标准 JS import 格式。不需要单独的 VueExtractor。

## Risks / Trade-offs

**[C# 精度]** C# 的 `using` 指令引用的是命名空间，不是文件。后缀索引假设 namespace ≈ 目录路径。 → **缓解**：大多数 C# 项目遵循此约定。不遵循的项目只会得到较少的边（假阴性），不会产生错误的边（无假阳性）。

**[Go 多模块]** 多模块 monorepo 中，跨模块 import 被视为外部依赖，不产生边。 → **接受**：这是正确的 Go 语义。不同 go.mod 的模块互为外部依赖。

**[改动量]** 一次性引入 ~1460 行新代码。 → **缓解**：每个 Extractor 和 Resolver 都是独立的纯函数/类，互不依赖，可以分别测试。

**[向后兼容]** `structuredImports` 是新字段，现有代码继续读 `imports`。 → **缓解**：parser 同时填充两个字段。`imports` 继续存原始文本（向后兼容），`structuredImports` 存结构化数据。后续逐步迁移消费者。
