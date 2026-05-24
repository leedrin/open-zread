## Context

Open Zread 使用 web-tree-sitter 进行多语言 AST 解析。当前支持 TypeScript、JavaScript、Go、Python 四种语言。解析管线分为三层：

1. **Scanner** → 按扩展名识别语言，生成 FileManifest（`.cs` → `csharp` 已映射）
2. **Parser** → 加载 WASM 解析器，通过 SCM query 提取 imports/exports/functions
3. **Repo Map** → 基于符号信息构建三层 Repo Map

Scanner 层的 `LANGUAGE_MAP` 已包含 `.cs → csharp` 映射，但 Parser 层的三个关键注册点缺失：`LANGUAGE_TO_PARSER`、`WASM_FILE_MAP`、`SCM_QUERIES`。

C# 的 tree-sitter 语法树节点类型已通过 `node-types.json` 确认，所有主要声明类型都使用 `name` field（类型为 `identifier`），方法/构造函数使用 `body` field（类型为 `block` 或 `arrow_expression_clause`），与现有通用签名提取函数 `extractFunctionSignature` 兼容。

WASM 文件已确认存在于当前 CDN 源 `tree-sitter-wasms@0.1.13`，文件名为 `tree-sitter-c_sharp.wasm`（注意下划线），大小 3.79 MB。

## Goals / Non-Goals

**Goals:**
- 在 `repo-analyzer` 包中完整支持 C# 语言的 AST 解析和符号提取
- 覆盖 C# 全部核心声明类型：namespace、class、struct、interface、enum、record、delegate、method、constructor、property、event、indexer、operator
- 复用现有签名提取逻辑（`extractFunctionSignature`、`extractExportFromNode`），无需新增提取函数
- WASM 加载、缓存、下载机制完全复用现有管线

**Non-Goals:**
- 不支持 C# 的 Razor/Blazor 文件（`.razor`、`.cshtml`）—— 这需要类似 Vue SFC 的特殊处理器
- 不支持 C# 的 LINQ 表达式、lambda 表达式等语句级符号—— 只提取声明级符号
- 不修改 Scanner 层—— 已有 `.cs` 映射
- 不修改 Repo Map 构建逻辑—— 它是语言无关的

## Decisions

### Decision 1: 使用现有 CDN 源的 C# WASM

**选择**: 使用 `tree-sitter-wasms@0.1.13` CDN 的 `tree-sitter-c_sharp.wasm`。

**备选方案**:
- 自行编译 tree-sitter-c-sharp WASM → 维护成本高，不必要
- 切换到 tree-sitter 官方 WASM 分发 → 与现有管线不一致

**理由**: 现有 CDN 已包含 C# WASM（3.79 MB），与其他语言 WASM 来源一致，无需引入新的分发渠道。

### Decision 2: SCM Query 覆盖范围

**选择**: 在 `SCM_QUERIES` 中为 C# 编写完整查询，覆盖 13 种声明类型。

**理由**: C# 的 tree-sitter 语法定义清晰，所有声明类型都使用 `name` field（identifier），SCM query 可一次性定义所有提取规则。相比只支持 class/method 的最小方案，完整覆盖只需增加约 10 行 query 代码，边际成本极低。

### Decision 3: 不新增特殊处理逻辑

**选择**: 完全复用现有的 `extractFunctionSignature` 和 `extractWithQuery` 流程，C# 不走特殊分支。

**理由**: C# tree-sitter 节点结构与现有语言一致：`name` field 取名称，`body` field 定位函数体。通用签名提取逻辑（去掉 body 后拼接其余子节点）天然适配。

## Risks / Trade-offs

- **[WASM 文件体积]** → C# WASM 为 3.79 MB，是当前最大的解析器文件（对比 python 464 KB、go 230 KB）。首次下载较慢，但会缓存到 `~/.zread/parsers/`。可接受。
- **[SCM query 准确性]** → tree-sitter C# 语法的 query 可能因版本差异导致部分节点匹配失败。已确认 node-types.json 中的节点名称。若运行时 query 失败，现有代码会 fallback 到 `extractBasic`。
- **[C# file-scoped namespace]** → C# 10 的 `file_scoped_namespace_declaration` 是独立节点类型，与 `namespace_declaration` 不同。需要在 SCM query 中单独匹配。
