## Context

open-zread 的 parser（`packages/repo-analyzer/src/parser/index.ts`）使用 SCM query 提取 `import` / `export` / `function_declaration` 等顶层节点。每个被捕获的节点保存了 `name`、`signature`、`imports` 等字段，但忽略了 AST 中**紧邻其上方**的注释节点。

下游的 `extractPageFacts()`（`packages/repo-analyzer/src/repo-map/module-facts.ts`）将 SymbolManifest 中的符号汇总为 `PageFacts.exports[]`。当前 ExportFact 只携带 `name / kind / signature / file / line`，无任何语义注释。Page Agent 的 Prompt（`packages/orchestrator/src/wiki/generate-wiki.ts` 的 `buildPagePrompt()`）将 Facts 渲染为：

```
- `export function buildRepoMap(opts: BuildOpts): RepoMap` → packages/.../index.ts#L42
```

无任何原作者意图。LLM 必须根据签名 + 关联文件源码自行推断 API 用途。

本设计在 parser 阶段沿用现有 SCM query + AST 遍历模式，在符号捕获后向上回溯查找紧邻注释节点；在 Facts 阶段透传；在 Prompt 阶段显式渲染并约束 LLM 行为。

## Goals / Non-Goals

**Goals:**

- 支持 5 种文档注释风格的提取：JSDoc/TSDoc、Python docstring、Go doc comment、C# XML doc、Vue SFC 内 JSDoc
- ExportFact 携带原作者注释，Page Agent Prompt 显式渲染并约束 LLM 优先使用
- 向后兼容：`doc` 字段全部可选，无注释的符号不影响现有功能
- 注释提取的性能开销 < 10%（在 50K 符号的大型 monorepo 上）

**Non-Goals:**

- 不解析注释内部的标签结构（如 `@param`、`@returns` 的语义化拆分）—— 直接把整段注释作为字符串透传给 LLM
- 不为内联注释（`// foo`）做提取，只提取**块注释 + docstring**
- 不为 Mermaid / Markdown 文件做注释提取
- 不修改 import / export 的 SCM query 本身
- 不引入新语言（Rust / Java / C++ 等）的注释支持，只覆盖已有语言

## Decisions

### D1: 注释提取走"AST 节点反向遍历"而非"正则匹配"

**选择**：在 SCM query 捕获到 `function_declaration` 节点后，遍历其 `previousSibling`，跳过空白节点，找到第一个 `comment` 类型节点，作为该函数的 doc。

**替代方案**：

- 用正则从原文本 `\/\*\*[\s\S]*?\*\/\s*(export\s+)?function\s+name` 反向匹配 → 易受嵌套结构干扰，对多行注释解析不稳定
- 在 SCM query 中加 `(comment) @doc` 捕获 → 注释节点和函数节点的关联关系无法通过单一 query 表达

**理由**：tree-sitter 的 `previousSibling` 是 AST 级关系，注释节点和函数节点的相邻关系在解析后是确定性的。Python 的 docstring 是函数体内**第一个 expression 语句**，特殊处理即可。

### D2: 五种语言的注释定位策略

| 语言 | 注释节点类型 | 定位方式 |
|------|------------|---------|
| TypeScript / JavaScript | `comment` (内容以 `/**` 开头) | `previousSibling` 跳空白后找到的第一个块注释 |
| Python | `expression_statement` 包裹 `string` | 函数 body 的第一个语句，且为字符串字面量 |
| Go | `comment` | `previousSibling` 跳空白后**连续多个**单行注释（`// `）聚合 |
| C# | `comment` (内容以 `///` 开头) | `previousSibling` 跳空白后**连续多个** XML 文档注释聚合 |
| Vue | (TS/JS 子集) | 走 TypeScript 策略，作用于 `<script>` 块内提取的 AST |

**理由**：Go 和 C# 的文档注释惯例是多行 `//` 或 `///` 序列，而非单一块注释。TypeScript 的 JSDoc 是单一块注释。Python 的 docstring 在 AST 中作为函数体的第一个语句存在，与其他语言完全不同。

### D3: 注释规范化

**选择**：提取到原始注释文本后，进行轻度规范化：

- 剥离 JSDoc 的 `/**`、`*/` 包裹符
- 剥离每行起始的 ` * ` 前缀
- 剥离 Go/C# 多行 `//` / `///` 前缀
- 剥离 Python 三引号 `"""` / `'''`
- trim 首尾空白，保留段落内的换行

**替代方案**：

- 原样保留（包括 `/**` 包裹符）→ LLM 仍然能读，但视觉噪声大，浪费 Prompt token
- 完整 Markdown 解析 → 过度工程，注释内的 `@param` 等标签对 LLM 已经足够友好

**理由**：规范化后注释是 LLM 友好的纯文本，无解析负担。

### D4: 提取范围只覆盖"函数 / 方法 / 类 / 接口"

**选择**：只为 SCM query 捕获的 `function_declaration` / `method_definition` / `class_declaration` / `interface_declaration` 等**符号声明**提取注释。不为 `export_statement` 节点单独提取（如果其内部是带注释的 declaration，注释会附在 declaration 上）。

**理由**：导出语句本身不是文档对象——文档应该附在被导出的实体上。Page Agent 通过签名定位到符号，注释也通过同一个符号提供。

### D5: 注释长度上限

**选择**：单个 doc 截断到 800 字符（约 200 tokens）。超长注释在末尾追加 `...（已截断）`。

**理由**：

- 防止个别项目（如某些 TypeScript 库）的超长 JSDoc 把 Prompt 顶爆
- 200 tokens 足以承载 5-10 行的核心描述 + `@param` 标签
- Page Agent 仍可通过 `FileReadTool` 读原文获取完整注释

### D6: SymbolInfo / ExportFact 类型扩展策略

**选择**：在 `SymbolInfo.functions[]` 的每个元素和 `ExportFact` 上各加 `doc?: string`。不引入新的 `docs: string[]` 数组。

**替代方案**：使用 `SymbolManifest.symbols[].docstrings: string[]`（已存在但未使用）作为聚合容器 → 该字段无法关联到具体函数。

**理由**：注释属于具体符号，不属于文件级别。已有的 `docstrings: string[]` 字段维持现状（不破坏向后兼容），新字段附在函数上有明确归属。

### D7: 与现有 Facts 段落的渲染整合

**当前 Prompt 中的 Facts 段落**：

```
**导出符号** (共 N 个):
- `signature` → file#L42
```

**新渲染格式**：

```
**导出符号** (共 N 个):
- `signature` → file#L42
  📝 作者注释：构建三层 Repo Map：目录树、核心签名、模块详情。
              用于 Blueprint Agent 渐进式分析项目结构。
```

新增 1 条 Facts 规则：

```
4. 描述 API 用途时，**优先**使用作者注释中的措辞和角度，避免重新发挥
```

**理由**：

- 视觉上分行 + emoji 让 LLM 容易识别"这是作者一手意图"
- 显式规则强化"优先使用"的约束，配合已有 Facts-First 三条规则形成完整闭环

### D8: Vue 单文件组件的注释提取

**选择**：在 `parseVueSfc` 提取出 `<script>` 块的 TS/JS AST 后，复用 TypeScriptDocExtractor。Vue 模板的注释 (`<!-- -->`) 不在范围内。

**理由**：Vue 组件的导出符号都在 `<script>` 块内（`defineProps` / `defineComponent` 等）。这部分本质是 TS/JS，无需独立 Vue 注释策略。

## Risks / Trade-offs

**[注释陈旧]** 注释可能与代码实现不同步（"代码改了，注释忘了改"）。 → **接受**：这是 LLM 也无法解决的根本问题。注入注释只是把"原作者的意图（哪怕过时）"放在 LLM 的"自由发挥"之上——后者出错概率更高。质量审计可以未来增加"代码改动 + 注释未改"的告警。

**[Prompt 膨胀]** 大型模块（如 20 个 export 全有 JSDoc）的 Facts 段落显著增长。 → **缓解**：

- D5 的 800 字符截断已经控制单条
- 复杂度自适应质量目标（已落地）会确保大模块有足够 token 预算
- 若实测有问题，可加入"仅 Advanced 级别页面注入完整注释，Beginner 级别只注入首行"的策略

**[多行 Go/C# 注释聚合策略复杂]** Go 的 `// xxx` 序列需要判断"连续性"——中间有空行算不算同一段？ → **决策**：以空行为分隔符。空行后的注释视为下一组，不与当前函数关联。

**[Python 的 docstring 不是注释]** Python docstring 本质是字符串字面量，在 AST 中表现为 `expression_statement`，需要特殊处理。 → **缓解**：单独的 `PythonDocExtractor` 处理逻辑独立，不影响其他语言。

**[改动量小]** 总改动约 350 行新代码（含测试）。 → **接受**：每个 DocExtractor 是独立的纯函数，可分别测试。

## Migration / Rollout

无需迁移。`doc` 字段全部可选：

- 新版本 parser 输出带 `doc` 的 SymbolInfo
- 旧的 PageFacts 消费者（如缓存中的 facts JSON）不识别 `doc` 字段会被静默忽略
- 新版本 Prompt 模板检测 `doc` 是否存在，存在则渲染，不存在则维持原样

灰度策略：在 `buildPagePrompt` 中可以加 `if (process.env.OPEN_ZREAD_INJECT_DOC === 'false') skip` 的逃生口（首版可不加，发现问题再加）。
