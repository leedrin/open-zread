# Open Zread Wiki 生成与维护机制研究报告

本报告基于对源码的直接阅读与调用链追踪得出，不采信 RULES.md / README.md 中的描述作为事实依据（仅用作查找线索）。所有结论均标注具体文件路径与行号。项目实际使用 `apps/cli`（不是 RULES.md 所写的 `cli/`）与 `apps/browse` 两个前端应用，`apps/cli/src/views/wiki-generate/hooks/*.ts` 和 `apps/cli/src/views/wiki-sync/hooks/*.ts` 是驱动生成/同步流程的实际入口（RULES.md 未提及这一层）。

---

## 1. 代码库是如何被读取的

### 1.1 Scanner（文件扫描）

`scanFiles()`（`packages/repo-analyzer/src/scanner/index.ts:91-125`）从项目根目录递归遍历（`collectFiles`, L47-89），用 `ignore` 库结合内置忽略规则（`SCANNER_CONFIG.ignore_patterns`，`scanner/constants.ts:4-22`，包含 `node_modules`、`.git`、`.open-zread`、`*.test.ts` 等）和项目 `.gitignore`（`scanner/index.ts:14-28`）过滤文件；超过 1MB（`max_file_size`，`constants.ts:3`）的文件会被跳过（L69-72）；扩展名通过 `LANGUAGE_MAP`（`constants.ts:25-46`）映射到语言标识，未识别语言的文件直接丢弃（L75-77）。

**每个文件的 hash 是整文件内容的 MD5，取前 12 位**（`calculateHashes`, L30-45：`createHash('md5').update(content).digest('hex').slice(0, 12)`），而不是 AST/符号级别的 hash。这个 hash 连同 `path/size/language/lastModified` 组成 `FileInfo`（`packages/types/src/manifest.ts:25-30`），汇总为 `FileManifest`（`manifest.ts:10-20`）。

### 1.2 Parser（AST 解析）

`parseFiles()`（`packages/repo-analyzer/src/parser/index.ts:287-324`）先根据 `manifest.files` 用到的语言集合调用 `loadParsers()`（`wasm-loader.ts:145-161`）按需加载 tree-sitter WASM 语法（若本地 `~/.zread/parsers` 无缓存则从 `https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out` 下载，见 `wasm-loader.ts:14-52`、`parser/constants.ts:1-19`）。

对每个文件调用 `parseFile()`（`parser/index.ts:245-285`），使用语言专属的 tree-sitter S-expression 查询（`SCM_QUERIES`, L9-89，覆盖 TS/JS/Go/Python/PHP/Rust/Java/C/C++/C#/Ruby/Swift/Kotlin）提取：
- `imports`：import/use 语句原文本；
- `exports`：导出声明去除函数体后的签名文本（`extractExportFromNode`, L138-173）；
- `functions`：顶层函数/方法名 + 去除函数体的签名（`extractFunctionSignature`, L111-130，`resolveFunctionName`, L97-109，特殊处理 C/C++ 的 `declarator` 字段）；
- `docstrings`：**代码中恒为空数组**——`parseFile` 返回的 `SymbolInfo` 里 `docstrings: []` 是硬编码（L269, L283），当前解析器完全不提取注释/文档字符串，即便 formatter 层预留了展示位（见 1.3）。

Vue 单文件组件走独立分支 `parseVueSfc()`（`vue-handler.ts:19-62`）：先用正则从 `<script>` 标签抠出脚本内容和 `lang` 属性（`extractVueScript`, L4-17），再用对应 parser（`lang="ts"` 用 TS parser，否则用 vue parser 自身）解析出顶层 `import_statement`/`export_statement`，Vue 分支不提取函数（`parser/index.ts:259-271` 中 `functions: []` 硬编码）。

解析失败的文件被跳过并记录 warning（`parser/index.ts:308-315`），不会中断整个流程。最终产出 `SymbolManifest`（`packages/types/src/symbols.ts:10-19`）。

### 1.3 三层 Repo Map 的真实数据形状

`packages/repo-analyzer/src/repo-map/index.ts` 中真正在生产流程被使用的是三个独立函数（而非文件头部的 `buildRepoMap()`，见下方"发现的问题"）：

**Layer 1 — `buildDirectoryTreeOnly()`**（L85-113，类型 `DirectoryTreeOutput`，`packages/types/src/repo-map.ts:52-55`）：只含目录/文件名的树状文本（`content: string`）和全部目录路径列表（`directories: string[]`），**不含任何符号信息**，用于建立宏观框架。

**Layer 2 — `buildCoreSignatures()`**（L152-201，类型 `CoreSignaturesOutput`，`repo-map.ts:60-64`）：过滤出被引用次数 `>= threshold`（默认 5）的文件，按引用数降序排列，每个文件只列出 `exports` 签名（不含函数体、不含 `functions` 数组），格式如 `├── path [Ref: N]` + `│   [Export] xxx`（L176-191）。

**Layer 3 — `buildModuleDetails()`**（L214-256，类型 `ModuleDetailsOutput`，`repo-map.ts:69-73`）：按前缀匹配 `modulePath` 过滤符号（L219-226），调用与 Layer1 相同的 `buildDirectoryTree` + `formatRepoMap` 生成该模块的完整树状文本，**包含 docstring（首条）、exports、functions 全部内容**（`formatter.ts:113-138`，尽管当前 docstrings 恒为空，见 1.2）。`tokenCount` 用 `行数 * 10` 的粗略估算（`repo-map/index.ts:247-248`，与 `token-counter.ts:12-33` 的估算方式一致）。

三层各自独立按需从 `SymbolManifest` 计算，Layer2/Layer3 都可复用外部传入的 `referenceMap` 避免重复计算（`buildCoreSignatures(symbols, threshold, referenceMap?)`, `buildModuleDetails(symbols, modulePath, referenceMap?)`）。

`countReferences()`（`reference-counter.ts:8-42`）的实现值得注意：它只处理**相对路径 import**（`importPath?.startsWith('.')`），通过"去掉扩展名的文件名"建索引做 O(1) 查找（L18-24），**不解析别名 import（如 `@/xxx`）、不解析包名 import**，且按文件名（非完整路径）匹配，理论上存在同名文件误计数的可能。这是 Layer2 "Ref" 阈值分层与 `prioritizer.ts` 打分的数据来源，其准确性直接受限于此简化实现。

`prioritizer.ts` 的优先级公式（`calculatePriority`, L14-29）：`score = referenceCount * 10 + exportCount * 5 + max(0, 10 - depth)`（权重取自 `repo-map/constants.ts:14-16`），`selectByTokenBudget()`（L52-96）在有 token 预算时，先保证 `referenceCount >= 5` 的文件（`must_include_threshold`, `constants.ts:20`）全部纳入，再按分数从高到低补充其余文件直到预算耗尽。这套预算选择逻辑目前**只被顶部的 legacy `buildRepoMap()` 使用**，三层工具（Layer1/2/3）默认 `includeAll`，不受 token 预算裁剪（除非显式传参）。

**Sources:**
- packages/repo-analyzer/src/scanner/index.ts:1-128
- packages/repo-analyzer/src/scanner/constants.ts:1-47
- packages/repo-analyzer/src/parser/index.ts:1-329
- packages/repo-analyzer/src/parser/wasm-loader.ts:1-166
- packages/repo-analyzer/src/parser/language-map.ts:1-27
- packages/repo-analyzer/src/parser/vue-handler.ts:1-63
- packages/repo-analyzer/src/parser/constants.ts:1-22
- packages/repo-analyzer/src/repo-map/index.ts:1-260
- packages/repo-analyzer/src/repo-map/formatter.ts:1-178
- packages/repo-analyzer/src/repo-map/prioritizer.ts:1-111
- packages/repo-analyzer/src/repo-map/reference-counter.ts:1-47
- packages/repo-analyzer/src/repo-map/token-counter.ts:1-56
- packages/repo-analyzer/src/repo-map/constants.ts:1-27
- packages/types/src/repo-map.ts:1-74
- packages/types/src/manifest.ts:1-31
- packages/types/src/symbols.ts:1-30

---

## 2. Wiki 目录（Catalog）是如何选出来的

### 2.1 入口与真实流水线顺序

真正驱动"生成目录"的不是 `orchestrator.ts` 本身，而是 CLI 侧的 `useCatalogGenerate` Hook（`apps/cli/src/views/wiki-generate/hooks/use-catalog.ts:134-153`），其顺序是：

1. `scanFiles()` → `FileManifest`
2. `saveCachedManifest(manifest)` → 写入 `.open-zread/cache/last_manifest.json`（文件级 hash，供后续 sync diff 用，见第5节）
3. `parseFiles(manifest)` → `SymbolManifest`
4. `saveCachedSymbols(symbols)` → 写入 `.open-zread/cache/last_symbols.json`（**完整**符号清单，供三层 Repo Map 工具懒加载）
5. `generateWikiCatalog(handleAgentEvent)`（`packages/orchestrator/src/orchestrator.ts:40-54`）

`generateWikiCatalog()` 本身只是把固定工具集 `BLUEPRINT_TOOLS`（`orchestrator.ts:15-29`：`GetDirectoryTreeTool`/`GetCoreSignaturesTool`/`GetModuleDetailsTool` + `GenerateBlueprintTool`/`ValidateBlueprintTool` + 通用 `FileRead/FileWrite/FileEdit/Glob/Grep`）和 prompt 常量 `GenerateCatalog`（`prompts/generate-catalog.ts`）交给 `createAgent()`（`agents/create-agent.ts`）执行一次 Agent 会话，不做任何后处理——返回的 `BlueprintResult.pagesCount` 甚至硬编码为 `0`（`orchestrator.ts:50`，未从实际生成的 pages 里统计，是明显的死代码/未完成实现）。

三层工具本身在 `call()` 中都是**从磁盘缓存 `loadCachedSymbols()` 惰性加载**（`packages/utils/src/cache/symbol-cache.ts:34-49`），而不是持有内存里的 `SymbolManifest`（`repo-map-tools.ts:35, 91, 155`）——即 Catalog Agent 每次调用 `get_directory_tree` / `get_core_signatures` / `get_module_details` 都是重新读一次 `last_symbols.json` 并现算，如果缓存不存在会提示 `请先运行 CLI：bun run dev`（`repo-map-tools.ts:41-43` 等）。

### 2.2 Prompt 实际内容与要求（`packages/orchestrator/src/prompts/generate-catalog.ts`）

Prompt 把 Agent 设定为"顶级软件架构师和 DDD 专家"，要求以四步思维流工作：

- **Step1**：调用 `get_directory_tree` + `get_core_signatures({ threshold: 5 })`，从核心导出签名反推项目的"核心能力"，并要求特别识别"架构暗线"（调度/事件总线/DI/错误处理等横切关注点）（L9-18）。
- **Step2**：按 Feature-First 原则划分模块，明确禁止把庞大领域塞进一篇文章（`associatedFiles` 不应过多），并给出一张拆分/聚合策略表（同平台不同实现必须拆分成多篇但用 `section`/`group` 聚合；细碎 utils 允许聚合；高密度核心机制哪怕只有 1-2 个文件也必须独立成篇）（L20-31）。
- **Step3**：对需要深入的模块调用 `get_module_details` 获取"脱水代码"（仅签名/注释/引用关系，无函数体），要求 `associatedFiles` 精确到 1-4 个具体文件/目录，不允许粗暴打包整个父目录（L32-38）。
- **Step4**：调用 `generate_blueprint` 生成 wiki.json，再用 `validate_blueprint` 验证（L40-41）。

结构规范部分要求：动态推导 4-8 个顶级 `section`（禁止套用固定模板）、可选 `group` 二级聚合、必须包含"入门指南/项目概览"类基础分类，并给出三篇必选基础文章模板（`1-project-overview`/`2-quick-start`/`3-core-architecture`，L60-65）。输出红线：`slug` 必须英文 kebab-case、`title` 必须是"产品架构能力视角"而非"代码包视角"（给出正反例，L71-79），并给出完整 JSON 示例（L82-121）。

### 2.3 输出（`generate_blueprint` 工具）

`GenerateBlueprintTool`（`packages/orchestrator/src/tools/output-tools.ts:15-110`）接收 `pages: WikiPage[]`（每项含 `slug/title/file/section/group?/level/associatedFiles?`）与可选 `techStackSummary`，调用 `generateWikiJson()`（`packages/utils/src/output/wiki-content.ts:27-45`）写入 `.open-zread/wiki/wiki.json`。注意 prompt 并未指示 Agent 主动产出 `techStackSummary`，该字段在实际生成中大概率为 `undefined`。

`ValidateBlueprintTool`（`output-tools.ts:117-247`）是纯本地文件系统校验：对每个 `associatedFiles` 路径调用 `stat`，判断文件/目录/缺失，目录还会统计其中 `.ts/.tsx/.js` 文件数（L181-189）。这是 prompt 里"必须找到支撑该功能的底层代码"这条红线的唯一硬校验，但**校验结果只是文本反馈给 Agent，代码层面不会阻止 Agent 直接结束会话**——是否根据校验结果修正完全取决于 Agent 自己是否再次调用工具。

**Sources:**
- apps/cli/src/views/wiki-generate/hooks/use-catalog.ts:134-153
- packages/orchestrator/src/orchestrator.ts:1-62
- packages/orchestrator/src/prompts/generate-catalog.ts:1-124
- packages/orchestrator/src/tools/repo-map-tools.ts:1-191
- packages/orchestrator/src/tools/output-tools.ts:1-247
- packages/utils/src/output/wiki-content.ts:27-45
- packages/utils/src/cache/symbol-cache.ts:34-49

---

## 3. 页面内容是如何选择/生成的

### 3.1 并发调度

`generateWikiContent()`（`packages/orchestrator/src/wiki/generate-wiki.ts:66-245`）是纯 TypeScript 控制流："Code for control flow, LLM for content"（文件头注释，L6）。并发数**完全由调用方传入**，函数内部只是 `pLimit(maxConcurrent)`（L84），若不传默认为 `1`（L70：`options?.maxConcurrent ?? 1`）。三个调用点（`apps/cli/src/views/wiki-generate/hooks/use-articles.ts:128-134,185-191`、`apps/cli/src/views/wiki-sync/hooks/use-wiki-sync.ts:110-114,191-195`）都从 `loadConfig()` 读取 `config.concurrency.max_concurrent`，其默认值是 `1`（`packages/utils/src/config/index.ts:23-26` 的 `DEFAULT_CONFIG`），用户可在 CLI 的 `config-concurrency` 视图修改（`apps/cli/src/views/config-concurrency/index.tsx`）。**代码里不存在任何硬编码的并发上限常量**——RULES.md 只提到"并发控制使用 p-limit"，未说明默认值为 1 且完全可配置这一事实。

每个页面各自 `limit(async () => { ... createAgent(...) })`（L97-227），单页失败被 `catch` 捕获、记录 `page_error` 事件，不影响其余页面（错误隔离，L199-225）。

### 3.2 页面 Agent 的工具与"读什么"

关键发现：**页面级 Agent 完全不装配三层 Repo Map 工具**。其工具列表（`generate-wiki.ts:113-119`）是 `[FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool]`——对比 Catalog Agent 的 `BLUEPRINT_TOOLS`（含 `GetDirectoryTreeTool/GetCoreSignaturesTool/GetModuleDetailsTool`），page agent 没有 repo-map 工具。也就是说页面内容生成阶段**不依赖 Repo Map 的抽象/脱水表示**，而是完全依赖：

1. `wiki.json` 中该页面的 `associatedFiles` 字段——由 `buildPagePrompt()`（`generate-wiki.ts:25-56`）拼进 prompt 顶部的"关联路径"列表；
2. Agent 自主调用 `FileReadTool`/`GlobTool`/`GrepTool` 去真实读取这些路径（及其引用到的其它文件）的源码原文（不是脱水签名，是完整文件内容）。

`maxTurns: 30`（`generate-wiki.ts:121`）限制单页 Agent 最多 30 轮工具调用/回复。

### 3.3 Page Prompt 内容（`packages/orchestrator/src/prompts/page-agent.ts`）

要求输出结构固定为：项目定位与核心价值 → 架构设计与模块划分（**必须**用 Mermaid，且对节点 label 含括号/`<br/>`/竖线等特殊字符时**必须**加引号，如 `A["节点文本"]`）→ 技术栈与核心工作流 → 按需代码示例 → 学习与探索建议（L9-31）。

**强制溯源规则**（L35-48）：每个技术论述段落后必须换行加 `Sources: [文件名](文件路径#L起始行-L结束行)`，可用逗号分隔多个来源。这一规则由 prompt 层面约束，代码侧**没有**对生成的 Markdown 做"是否包含 Sources"的机器校验（对比 `write_page` 工具只校验 Mermaid 语法，见 3.4）。

文末要求按"形态"输出"源码导航"或"关联模块与上下游"两种收尾结构之一（L52-57）。

### 3.4 输出与去重跳过逻辑

`write_page` 工具（`packages/orchestrator/src/tools/page-tools.ts:121-219`）先做 Mermaid 语法自检（`validateMermaidContent`, L68-94：扫描 flowchart 节点 label，若含 `(){}|<>` 等结构字符但未加引号则拒绝写入并返回 `is_error: true`，逼迫 Agent 修正后重试），通过后按 `file`/`section` 拼路径写入 `<cwd>/.open-zread/wiki/{section}/{file}`（L160-177，直接用 `context.cwd` + 固定字符串 `.open-zread/wiki`，并未调用 `getWikiDir()`），并在文件头拼接 YAML frontmatter（`title`/`slug`）。

`useArticlesGenerate.initialize()`（`apps/cli/src/views/wiki-generate/hooks/use-articles.ts:63-98`）在启动生成前，用 `fileExists(getWikiDir()/{section}/{file})` 逐页检查磁盘是否已存在对应 `.md`，已存在的页面直接标记为 `completed` 并从待生成列表剔除（L70-97）——这是"continue 模式"（对应 `wiki-generate/index.tsx` 里的 `mode=continue` URL 参数）跳过已生成页面的实际机制，**判断依据仅仅是文件是否存在，不比较内容或 hash**，因此如果源码变了但 `.md` 还在，会被当作"已完成"直接跳过，不会重新生成（除非用户手动按 `r` 触发 `regeneratePage`，或走第 5 节的 sync 流程）。

**Sources:**
- packages/orchestrator/src/wiki/generate-wiki.ts:1-245
- packages/orchestrator/src/prompts/page-agent.ts:1-67
- packages/orchestrator/src/tools/page-tools.ts:1-219
- packages/orchestrator/src/agents/create-agent.ts:1-214
- packages/orchestrator/src/agents/uitls.ts:1-50
- apps/cli/src/views/wiki-generate/hooks/use-articles.ts:1-217
- packages/utils/src/config/index.ts:14-27
- apps/cli/src/views/config-concurrency/index.tsx (存在性确认，未逐行引用)

---

## 4. Wiki 结构与落盘格式

### 4.1 类型定义（`packages/types/src/wiki.ts`）

```ts
type WikiLevel = 'Beginner' | 'Intermediate' | 'Advanced';
type SyncPageStatus = 'unchanged' | 'new' | 'updated' | 'archived';

interface WikiPage {
  slug: string; title: string; file: string; section: string;
  group?: string;               // 二级聚合
  level: WikiLevel;
  associatedFiles?: string[];   // 关联源文件/目录路径
  status?: SyncPageStatus;      // 仅 sync 流程使用
}

interface WikiOutput {
  id: string; generated_at: string; language: string;
  pages: WikiPage[];
  techStackSummary?: TechStackSummary;
}

interface SyncDiff {
  newPages: WikiPage[]; updatedPages: WikiPage[]; archivedPages: WikiPage[];
}
```
（`packages/types/src/wiki.ts:13-59`）

### 4.2 落盘路径（实际生效路径，两处相互印证）

- `wiki.json` → `getWikiJsonPath()` = `<projectRoot>/.open-zread/wiki/wiki.json`（`packages/utils/src/file-io.ts:59-65`），由 `generateWikiJson()` 写入（`wiki-content.ts:27-45`）。
- 每页 Markdown → `<projectRoot>/.open-zread/wiki/{section}/{file}`（`page-tools.ts:160-177` 的 `write_page` 工具直接拼接字符串，不经过 `WikiStore`）。

即真实的输出目录结构是 **`.open-zread/wiki/wiki.json` + `.open-zread/wiki/{中文或英文 section 名}/{slug}.md`**（是平铺在 `section` 子目录下，不是 `current/`、`archived/`、`versions/` 三段式——这与 `packages/utils/src/storage/wiki-store.ts` / `versioning.ts` 里定义的目录假设不一致，详见第 5 节）。

### 4.3 本仓库的真实示例

对本仓库根目录执行检查，**当前不存在 `.open-zread/` 目录**（已用 `ls -la .open-zread` 验证返回 "NO .open-zread dir"）。也就是说 open-zread 尚未对自身仓库跑过一次 Wiki 生成，本报告第 4 节无法给出"真实产物"的实例内容，只能基于代码路径推断上述结构；这点在此明确说明，避免虚构一个不存在的示例。

**Sources:**
- packages/types/src/wiki.ts:1-72
- packages/utils/src/output/wiki-content.ts:1-78
- packages/utils/src/file-io.ts:47-65
- packages/orchestrator/src/tools/page-tools.ts:160-177
- Bash 验证：`ls -la .open-zread` → 目录不存在（会话内命令输出）

---

## 5. 维护/同步（diff 感知的增量重生成）

### 5.1 变更检测——文件级 MD5，而非 AST Hash

`packages/utils/src/cache/index.ts` 的 `diffManifests()`（L35-61）比较的是两份 `CacheManifest.files[].hash`（`packages/types/src/cache.ts:10-18`），这个 `hash` 来自 1.1 节所述的**整文件内容 MD5**（`scanner/index.ts:36`），逐路径比较得到 `added/modified/removed` 三个文件路径数组。`needsReprocess()`（L63-71）是同一逻辑的布尔封装。

**这与 RULES.md 所写的"符号级缓存（基于 AST Hash）"不符**：
- `packages/utils/src/cache/symbol-cache.ts` 里的"符号缓存"（`saveCachedSymbols`/`loadCachedSymbols`, L15-49）只是把 `parseFiles()` 产出的**完整 `SymbolManifest` 原样序列化**成 `last_symbols.json` 一个大 JSON blob，供三层 Repo Map 工具懒加载读取（见 2.1），它不含任何 hash 字段，也不参与 diff 比较。
- 真正参与"变没变"判断的只有 `last_manifest.json` 里的整文件 MD5（`cache/constants.ts:1-4`），是文件级而非符号/AST 级。
- 代码库中没有找到任何对 AST 节点做 hash 的实现（parser 层只提取签名文本，未计算 hash）。

### 5.2 sync 流程实际决策链

`syncWiki()`（`packages/orchestrator/src/wiki/sync-wiki.ts:59-152`）：

1. 并行执行 `scanFiles()`（重新全量扫描）、`loadCachedManifest()`（读取上次的 `last_manifest.json`）、`loadWikiBlueprint()`（读取上次的 `wiki.json`）（L67-73）；若没有旧 `wiki.json` 直接抛错要求先跑一次生成（L75-77）。
2. 用 `diffManifests(cachedManifest, currentManifest)` 得到变更文件路径列表；**若三类变更都为空，直接跳过 LLM，返回空 `SyncDiff`**（L85-91，这是唯一的代码层面确定性判断）。
3. 否则把 `added/modified/removed` 的**文件路径清单**（不含 diff 内容本身）拼成文本 `diffSummary`（L93-100）。
4. 重新执行一次完整 `parseFiles()` 并覆盖保存 `last_manifest.json`/`last_symbols.json`（L102-108）——即每次 sync 都会重新解析全部文件，而不是只解析变更文件。
5. 调用 `createAgent()`，把"旧 wiki.json 全文 + 文件变更摘要 + `SyncCatalogPrompt`"一起发给 Agent（L111-120），工具集 `SYNC_TOOLS`（L31-42）= 三层 Repo Map 工具 + `GenerateSyncBlueprintTool`/`ValidateBlueprintTool` + 通用文件工具。
6. **页面级别的 `new`/`updated`/`archived`/`unchanged` 判定完全由 LLM 自行决定**，写在 Agent 输出的新 `wiki.json` 每个 page 的 `status` 字段里（`prompts/sync-catalog.ts` 的状态标记规则，L14-19：`updated` = "关联的源文件有 modify"、`archived` = "关联的所有源文件已被删除"，但这些规则只是文字指令给 LLM 参考，**代码没有对每个 page 的 `associatedFiles` 与变更文件列表做交集计算来验证或强制 LLM 的判断**）。`syncWiki()` 拿到新 `wiki.json` 后只是按 `page.status` 做一次分类归并（L132-145），不做二次校验。

### 5.3 归档快照——存在但与实际写入路径脱节

`WikiStore`（`packages/utils/src/storage/wiki-store.ts`）假定当前生效页面存放在 `.open-zread/wiki/current/`（`CURRENT_DIR = joinPath(WIKI_DIR, 'current')`, L7-8, L16），`archivePage()`（L43-55）把 `join(currentDir, page.file)` 移动到 `.open-zread/wiki/archived/{snapshotName}/{section}/{fileName}`；`versioning.ts` 的 `createVersionSnapshot()`（L29-44）把整个 `current/` 目录复制到 `.open-zread/wiki/versions/{snapshotName}/`。

但经过全仓库检索确认（`grep -rn "writePage\("`），**`WikiStore.writePage()`（唯一会真正往 `current/` 目录写文件的方法）在整个代码库中没有任何调用点**——实际写入页面内容的始终是 3.4 节所述的 `write_page` 工具，它把文件直接写到 `.open-zread/wiki/{section}/{file}`，从不经过 `current/` 子目录。

其后果：
- `useWikiSync` 在 sync 流程里确实调用了 `store.archivePage(page)` 和 `store.createSnapshot()`（`apps/cli/src/views/wiki-sync/hooks/use-wiki-sync.ts:96-103`），但 `archivePage()` 内部 `existsSync(sourcePath)` 检查的路径是 `.open-zread/wiki/current/{file}`——这个路径永远不存在（因为从未有代码写入过 `current/`），所以 `archivePage()` 实际上总是提前 `return null`（`wiki-store.ts:44-45`），什么也不归档。
- 同理 `createVersionSnapshot()` 在 `!existsSync(currentPath)` 时直接 `return ''`（`versioning.ts:31-33`），快照功能也从不真正执行复制。

也就是说：**"归档到 archived/、创建版本快照到 versions/" 这套设计在当前代码状态下是不生效的死路径**，页面被标记为 `archived` 后，它在 `.open-zread/wiki/{section}/{file}` 位置的旧 `.md` 文件会**原地保留、不会被移动或删除**（唯一的后续处理只是 UI 状态标记为完成，见 `use-wiki-sync.ts:123-132`）。这是本次调研中发现的最明确的"文档声称的机制与实际代码行为不一致"之处。

### 5.4 增量内容重生成

`syncWiki()` 完成规划后，`useWikiSync` 只对 `status ∈ {new, updated}` 的页面调用 `generateWikiContent()`（`use-wiki-sync.ts:109-121`），并发数同样来自 `config.concurrency.max_concurrent`；`archived` 页面不生成内容，只在 UI 状态里标记为 completed（L123-132）。`unchanged` 页面完全不出现在 `syncDiff` 里（`sync-wiki.ts:143` 注释"unchanged pages are silently ignored"），因此也不会被重新生成或触碰。

**Sources:**
- packages/utils/src/cache/index.ts:1-72
- packages/utils/src/cache/symbol-cache.ts:1-49
- packages/utils/src/cache/constants.ts:1-4
- packages/types/src/cache.ts:1-19
- packages/repo-analyzer/src/scanner/index.ts:30-45
- packages/orchestrator/src/wiki/sync-wiki.ts:1-153
- packages/orchestrator/src/prompts/sync-catalog.ts:1-76
- packages/orchestrator/src/tools/output-tools.ts:256-344
- packages/utils/src/storage/wiki-store.ts:1-57
- packages/utils/src/storage/versioning.ts:1-63
- apps/cli/src/views/wiki-sync/hooks/use-wiki-sync.ts:1-221
- Grep 验证：`writePage\(` 在仓库中仅 1 处定义（wiki-store.ts:20），无任何调用点

---

## 附：与 RULES.md 描述不一致之处汇总

| RULES.md 描述 | 实际代码行为 | 依据 |
|---|---|---|
| 目录结构写作 `cli/`（终端 UI 入口） | 实际路径是 `apps/cli/`，且还有独立的 `apps/browse/`（Wiki 浏览前端）未被提及 | `apps/cli/src/*`, `apps/browse/src/*` |
| "符号级缓存（基于 AST Hash）" | 缓存分两块：文件级整文件 MD5（用于 diff）+ 全量 SymbolManifest blob（供 repo-map 工具读取，不参与 diff、无 hash 字段） | cache/index.ts:35-61, cache/symbol-cache.ts:15-49, scanner/index.ts:36 |
| `repo-map/index.ts` 主入口是 `buildRepoMap()` | `buildRepoMap()` 只在单元测试中被调用，生产流程（catalog/sync）实际使用的是三个独立的 `buildDirectoryTreeOnly`/`buildCoreSignatures`/`buildModuleDetails` | repo-map/index.ts:25-72 vs repo-map-tools.ts, grep 结果 |
| 未明确提及但隐含"归档快照会生效" | `WikiStore.archivePage`/`createVersionSnapshot` 依赖的 `current/` 目录从未被任何写入路径填充，二者在当前代码状态下均静默 no-op | wiki-store.ts:43-55, versioning.ts:29-33, 全仓库 grep `writePage\(` |
