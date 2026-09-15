# Open Zread Hub PRD v0.2

> 文档状态：Draft  
> 版本：v0.2  
> 日期：2026-09-13  
> 产品暂定名：Open Zread Hub / ZRead Hub / Code Knowledge Hub  
> 核心定位：Local-first、Multi-project、Multi-provider 的代码 Wiki 与知识管理平台

---

## 0. 文档摘要

Open Zread Hub v0.2 在 v0.1“多项目统一管理 + Wiki 阅读 + Wiki 生命周期”的基础上，进一步升级为 **Wiki Provider Architecture**。

核心变化：

1. 不再假设一个项目只有一份 Wiki。
2. 不再把 Open Zread CLI 视为唯一 Wiki 生成器。
3. 将 Wiki 生成能力抽象为 `Wiki Provider`。
4. 同一个 Project 可以同时挂载多个 Provider，例如：
   - OpenZread Provider
   - Zread CLI Provider
   - Future Wiki CLI Provider
5. 不同 Provider 生成的 Wiki 作为不同的 `Wiki Variant` 共存，不互相覆盖。
6. 引入 `Unified Wiki Model / Wiki IR`，让 Reader、Search、Topic、Agent、Compare 等上层能力不依赖具体 Provider。
7. 将 Wiki 后期增加、修改、重构、风格模仿、合并等能力从 Provider 中分离，形成独立的 `Wiki Operations / Agent Layer`。
8. 为未来支持多个 Provider 的比较、互补与 Composite Wiki 奠定基础。
9. 保留 ZReadHub 已验证的多项目 Dashboard、统一 Reader、全文搜索、Source-of-Truth、Plain Markdown Import 等经验，但不延续旧 Prototype 的双 Server、硬编码路径、独立 Renderer 等技术债。

一句话定义：

> Open Zread Hub 是一个本地优先的多项目、多 Wiki Provider 代码知识中心，用统一界面管理代码项目、Wiki 生成器、Wiki 版本、后期编辑、搜索、比较与知识消费。

---

# 1. 背景

Open Zread 当前采用本地 CLI 工作流：

```text
进入项目目录
    ↓
运行 open-zread
    ↓
分析项目
    ↓
生成 .open-zread/wiki
    ↓
open-zread browse
    ↓
浏览该项目 Wiki
```

这种设计对于单项目使用简单直接，但随着项目数量增加，会出现：

- 需要频繁切换目录；
- 需要记住每个项目路径；
- 每个项目单独启动 Wiki 浏览入口；
- 无法统一查看各项目 Wiki 是否存在、是否过期；
- 无法集中执行 Generate / Sync；
- 无法跨项目搜索；
- 无法统一查看不同项目最近访问记录；
- 无法统一管理不同 Wiki 生成器的结果。

此前开发过的 ZReadHub Prototype 已验证：

- 多项目 Dashboard 是有价值的；
- 统一 Reader 是可行的；
- 中央索引 + 源路径读取优于复制 Wiki；
- 跨项目全文搜索具备明显价值；
- Plain Markdown 也可以作为知识源被统一管理。

但此前方案主要假设：

```text
Project
  └─ Wiki
```

本轮产品讨论进一步发现，更合理的实际模型应当是：

```text
Project
  └─ Wiki Workspace
       ├─ OpenZread Wiki
       ├─ Zread CLI Wiki
       ├─ Future Provider Wiki
       └─ Composite Wiki
```

---

# 2. 产品愿景

长期目标不是制作一个“Open Zread CLI 的 GUI”。

产品应逐步发展为：

```text
Local Code Knowledge Platform
```

即：

- Project Manager
- Wiki Provider Manager
- Wiki Lifecycle Manager
- Unified Wiki Reader
- Cross-project Search
- Wiki Editing Workspace
- AI Knowledge Agent
- Cross-provider Comparison
- Composite Knowledge Generation
- MCP / Agent Knowledge Interface

---

# 3. 核心产品原则

## 3.1 Local First

源码、Wiki、索引、元数据默认保存在本地。

Hub 不要求云端账号才能使用。

## 3.2 Project Owns Source

项目源码仍属于项目本身。

Hub 不复制源码作为自己的主数据。

## 3.3 Provider Owns Native Output

不同 Provider 保持自己的原生目录结构。

例如：

```text
Project/
├─ .open-zread/
│  └─ wiki/
├─ .zread/
│  └─ wiki/
└─ ...
```

Hub 通过 Adapter 读取和标准化，不强行移动 Provider 原始数据。

## 3.4 Hub Owns Control Plane

Hub 维护：

- Project Registry
- Provider Registry
- Wiki Variant Metadata
- User Preferences
- Search Index
- Activity
- Compare Metadata
- Style Profile
- Agent ChangeSet

Hub 不成为 Provider Wiki 内容的唯一存储中心。

## 3.5 Multiple Wikis Are a Feature

同一个项目存在多份 Wiki 不视为冲突。

不同 Provider 可以提供不同分析角度：

- 源码结构导向；
- 架构解释导向；
- 使用流程导向；
- 模块关系导向；
- API/符号导向；
- 新手理解导向；
- 领域知识导向。

## 3.6 Generate 与 Edit 分离

Provider 负责 Wiki 的生产。

Agent / Wiki Operations 负责：

- 修改；
- 扩充；
- 重写；
- 重组织；
- 合并；
- 风格模仿；
- 补充图表；
- 更新局部内容。

避免把所有后处理逻辑写进 Provider。

---

# 4. 产品定位

## 4.1 当前定位

> 面向本地开发者的多项目、多 Wiki Provider 代码知识中心。

## 4.2 与 Open Zread CLI 的关系

Open Zread CLI 是：

```text
First-party Native Wiki Provider
```

优势：

- 开源；
- 可二次开发；
- 可深入获取 AST / Symbol / Diff / Incremental 状态；
- 可以实现深层生命周期控制；
- 可以和 Hub 共用核心模块。

## 4.3 与 Zread CLI 的关系

Zread CLI 是：

```text
External Wiki Provider
```

特点：

- 闭源；
- 无法修改内部实现；
- 但可运行 CLI 并读取生成结果；
- 生成风格、内容组织方式可能与 Open Zread 不同；
- 这种差异本身具有互补价值。

Hub 不需要了解其内部生成算法，只负责：

```text
Execute
  ↓
Detect Output
  ↓
Import
  ↓
Normalize
```

---

# 5. 核心领域模型

## 5.1 Project

```ts
interface Project {
  id: string;
  name: string;

  location: {
    currentPath: string;
    previousPaths?: string[];
  };

  identity: {
    gitRemote?: string;
    repositoryFingerprint?: string;
  };

  git?: {
    branch?: string;
    commit?: string;
    dirty?: boolean;
  };

  favorite?: boolean;
  tags?: string[];
  lastOpenedAt?: string;
}
```

原则：

> Path 是 Location，不是 Identity。

项目移动目录后不应该自动成为一个全新项目。

## 5.2 Wiki Workspace

每个 Project 拥有一个逻辑 Wiki Workspace：

```ts
interface WikiWorkspace {
  projectId: string;
  variants: WikiVariant[];
}
```

## 5.3 Wiki Variant

一个 Provider 生成的一份独立 Wiki：

```ts
interface WikiVariant {
  id: string;

  projectId: string;
  providerId: string;

  label: string;

  status:
    | "missing"
    | "ready"
    | "outdated"
    | "generating"
    | "syncing"
    | "error";

  nativeRoot?: string;

  createdAt?: string;
  updatedAt?: string;

  sourceRevision?: string;

  capabilities?: ProviderCapabilities;

  styleProfileId?: string;

  provenance?: WikiProvenance;
}
```

---

# 6. Wiki Provider Architecture

## 6.1 Provider 定义

Provider 是“Wiki 生产能力”的抽象。

```ts
interface WikiProvider {
  id: string;
  name: string;
  version?: string;

  capabilities: ProviderCapabilities;

  detect(ctx: ProjectContext): Promise<ProviderDetection>;

  generate(
    ctx: ProjectContext,
    options?: GenerateOptions
  ): AsyncIterable<WikiEvent>;

  sync?(
    ctx: ProjectContext,
    wiki: WikiVariant,
    options?: SyncOptions
  ): AsyncIterable<WikiEvent>;

  import?(
    ctx: ProjectContext,
    outputPath: string
  ): Promise<UnifiedWiki>;

  getStatus?(
    ctx: ProjectContext,
    wiki: WikiVariant
  ): Promise<WikiStatus>;
}
```

## 6.2 Provider Capabilities

```ts
interface ProviderCapabilities {
  generate: boolean;
  incrementalSync: boolean;
  regeneratePage: boolean;
  customTopics: boolean;
  customPrompt: boolean;
  exportMarkdown: boolean;
  provenance: boolean;
}
```

Provider 不必实现全部能力。

Hub UI 根据 capability 动态决定哪些操作可用。

## 6.3 Provider 类型

### Native Provider

第一方、深集成 Provider。

首个：

```text
OpenZreadProvider
```

优势：

- 可直接调用 Open Zread Core；
- 可提供细粒度 Wiki Status；
- 可复用 AST hash；
- 可复用 symbol cache；
- 可复用 diff-aware Wiki Sync；
- 可实现 page-level regenerate。

### External CLI Provider

通过外部 CLI 工作。

首个：

```text
ZreadCliProvider
```

典型流程：

```text
Hub
 ↓
启动 zread CLI
 ↓
监听进程状态
 ↓
识别 .zread/wiki/current
 ↓
读取 wiki.json
 ↓
转换为 Unified Wiki Model
```

### Third-party Provider

未来可以支持：

```text
OtherWikiCliProvider
CustomCompanyWikiProvider
ScriptProvider
```

只需要符合 Provider contract。

---

# 7. Unified Wiki Model / Wiki IR

## 7.1 目标

Hub 上层能力不直接依赖：

```text
.open-zread/wiki
.zread/wiki
other-provider-format
```

所有 Provider 输出统一转换为：

```text
Unified Wiki Model
```

## 7.2 数据结构

```ts
interface UnifiedWiki {
  id: string;

  projectId: string;
  providerId: string;

  title: string;

  generatedAt?: string;
  sourceRevision?: string;

  sections: WikiSection[];
  pages: WikiPage[];

  metadata?: Record<string, unknown>;
}
```

```ts
interface WikiPage {
  id: string;
  slug: string;
  title: string;

  section?: string;
  group?: string;
  level?: string;

  contentPath: string;

  sources?: SourceReference[];

  metadata?: {
    generatedBy?: string;
    lastModifiedBy?: string;
    generatedAt?: string;
    modifiedAt?: string;
  };
}
```

## 7.3 Unified Wiki Model 消费方

```text
Providers
    ↓
Unified Wiki Model
    ↓
├─ Reader
├─ Search
├─ Topics
├─ Compare
├─ Agent
├─ Activity
├─ Composite Wiki
└─ MCP / Agent API
```

---

# 8. Wiki Operations / Agent Layer

Provider 生成完成后，Wiki 后期编辑交给独立层。

## 8.1 Wiki Operations

第一阶段计划支持：

- Add Page
- Rewrite Page
- Expand Page
- Delete Page
- Rename Page
- Move Page
- Add Section
- Reorganize Topic
- Add Mermaid Diagram
- Add Source Reference
- Summarize
- Translate
- Refresh From Source
- Style Imitation
- Merge Wiki Content

## 8.2 ChangeSet

所有 AI 编辑建议优先产生 ChangeSet：

```ts
interface WikiChangeSet {
  id: string;
  wikiVariantId: string;

  changes: WikiChange[];

  createdAt: string;
  createdBy: "agent" | "user";

  status:
    | "draft"
    | "reviewed"
    | "applied"
    | "rejected";
}
```

这样可以：

- Review；
- Diff；
- Undo；
- Activity；
- Audit。

---

# 9. Wiki Style Profile

## 9.1 目标

支持 AI Agent 对已有 Wiki 风格进行学习和延续。

特别适用于：

```text
Zread CLI
   ↓
生成初版 Wiki
   ↓
Style Profile
   ↓
Agent 后续新增/修改
```

## 9.2 Style Profile 内容

可以分析：

- Heading hierarchy
- Page length
- Paragraph density
- Table usage
- Mermaid density
- Code example density
- Source citation format
- Terminology
- Tone
- Section organization
- Summary structure
- Architecture-first / Code-first 倾向

---

# 10. Multi-provider Wiki Compare

同一 Project 不同 Provider 的输出可以进行比较。

Compare 维度：

- Section coverage
- Page coverage
- Topic coverage
- Technical depth
- Architecture depth
- Source references
- Diagram coverage
- API coverage
- Missing topics
- Contradictions
- Complementary content

---

# 11. Composite Wiki

Composite Wiki 是由多个 Provider Wiki 合并产生的派生 Wiki。

```text
OpenZread Wiki
       +
Zread Wiki
       +
Agent Synthesis
       ↓
Composite Wiki
```

P2 实现。

---

# 12. Knowledge Source Adapter

Provider 与 Source Adapter 必须分开。

## 12.1 Wiki Provider

负责“生产 Wiki”。

例如：

- OpenZread
- Zread CLI
- Future Wiki CLI

## 12.2 Knowledge Source Adapter

负责“导入已有知识”。

例如：

- Plain Markdown Directory
- Markdown File
- MkDocs
- Docusaurus
- Existing Documentation Folder

---

# 13. Source of Truth

Provider Native Wiki 保持原目录：

```text
Project
├─ .open-zread/wiki
└─ .zread/wiki
```

Hub 不应复制正文作为长期主数据。

建议 Hub Registry：

```text
~/.open-zread/
└─ hub/
   ├─ projects.db
   ├─ search.db
   ├─ activity.db
   └─ settings.json
```

---

# 14. Project Registry

基础能力：

- Add Project
- Remove From Hub
- Locate Project
- Recover Moved Project
- Favorite
- Recent
- Tags
- Workspace grouping

P0 手动 Add Project。

P1 Workspace Scan。

---

# 15. Provider Registry

```ts
interface ProviderRegistration {
  id: string;
  name: string;

  type:
    | "native"
    | "external-cli"
    | "plugin";

  executable?: string;

  enabled: boolean;

  capabilities: ProviderCapabilities;

  configuration?: Record<string, unknown>;
}
```

---

# 16. Provider Detection

进入 Project 时，Hub 可以检查：

```text
OpenZread Provider
  detected / not initialized

Zread CLI Provider
  installed / not installed
  wiki exists / not exists

Other Providers
  ...
```

---

# 17. Project Detail

推荐页面结构：

```text
Project
├─ Overview
├─ Wiki
├─ Providers
├─ Topics
├─ Search
├─ Activity
└─ Settings
```

---

# 18. Provider Matrix

| Provider | Status | Last Update | Capabilities | Actions |
|---|---|---|---|---|
| OpenZread | Outdated | 2 days ago | Generate / Sync / Incremental | Sync |
| Zread CLI | Ready | 1 day ago | Generate | Regenerate |
| Composite | Ready | 1 day ago | Merge | Rebuild |

---

# 19. Unified Wiki Reader

统一 Reader 读取 Unified Wiki Model。

Provider Switcher：

```text
OpenZread | Zread | Composite
```

允许在同一 Project 中快速切换不同 Provider Wiki。

---

# 20. Search

P0：

- Project name
- Path
- Tag
- Wiki title
- Section
- Group

P1：

- Cross-project Full-text Search

索引必须包含：

```text
project
provider
page title
section
markdown content
```

---

# 21. Topics

P0/P1 保留 Provider 原生 Topic。

P2 支持 Cross-project Topic 与跨 Provider Topic 对齐。

---

# 22. Activity

记录：

- Project added
- Provider detected
- Wiki generated
- Wiki synced
- Wiki outdated
- Page added
- Agent edited
- ChangeSet applied
- Composite rebuilt
- Provider failed

---

# 23. Wiki Lifecycle

生命周期属于 Wiki Variant，而不是 Project。

```text
missing
   ↓
generating
   ↓
ready
   ↓
outdated
   ↓
syncing
   ↓
ready
```

External Provider 无法精确检测时，可降级为：

```text
possibly_outdated
unknown
```

---

# 24. Generate / Sync

用户可以从 Hub：

```text
Project
 ↓
Provider
 ↓
Generate
```

无需 Terminal。

只有 `incrementalSync=true` 的 Provider 显示 Sync。

例如：

```text
OpenZread → Sync
Zread CLI → Regenerate
```

---

# 25. Desktop 技术方案

推荐：

```text
Tauri + React
```

原因：

- 本地文件系统访问；
- 本地 CLI 进程管理；
- IPC；
- 较低资源占用；
- 可复用现有 React Browse；
- 避免 localhost Admin API 暴露本地文件系统；
- Windows/macOS/Linux 可扩展。

---

# 26. 建议 Monorepo 结构

```text
open-zread/

apps/
├─ cli/
├─ browse/
└─ hub-desktop/

packages/
├─ agent-sdk/
├─ orchestrator/
├─ repo-analyzer/
├─ types/
├─ utils/
├─ hub-core/
├─ project-registry/
├─ provider-sdk/
├─ providers/
│  ├─ openzread-provider/
│  └─ zread-provider/
├─ wiki-model/
├─ wiki-operations/
├─ search-index/
└─ source-adapters/
```

---

# 27. Provider SDK

负责：

- Provider Contract
- Capability
- Lifecycle Event
- Progress
- Error
- Provider Detection
- Process Adapter

---

# 28. Hub Core

```text
Hub Core
├─ ProjectService
├─ ProviderService
├─ WikiService
├─ SearchService
├─ GitService
├─ ActivityService
├─ CompareService
└─ AgentService
```

---

# 29. Provider Event Stream

建议输出事件：

```ts
type WikiEvent =
  | { type: "started" }
  | { type: "phase"; name: string }
  | { type: "progress"; value: number }
  | { type: "page"; slug: string }
  | { type: "warning"; message: string }
  | { type: "completed"; wikiId: string }
  | { type: "error"; message: string };
```

---

# 30. Security Model

Hub 只能访问：

- 用户显式添加的项目；
- 用户配置的 Workspace；
- Provider 自己声明的输出目录。

External Provider 执行时：

- 显示 executable；
- 显示 cwd；
- 参数可审计；
- stdout/stderr 可记录。

Reader 默认采用安全渲染模式。

---

# 31. MVP Scope

## P0

### Desktop Hub

- Tauri shell
- Project Library
- Add / Remove Project
- Recent
- Favorite

### Provider

- Provider Registry
- OpenZread Provider
- Zread CLI Provider
- Provider Detection
- Provider Matrix

### Wiki

- Unified Wiki Model
- Multi-variant Wiki
- Unified Reader
- Provider Switcher
- Generate
- Regenerate
- OpenZread Sync

### Status

- Missing
- Ready
- Outdated
- Generating
- Syncing
- Error

### Utilities

- Open Project Folder
- Open Terminal
- Copy Project Path

---

# 32. P1

- Workspace Scan
- File Watch
- Git Metadata
- Cross-project Full-text Search
- Activity
- Plain Markdown Source Adapter
- Style Profile
- AI Add Page
- AI Rewrite Page
- Wiki ChangeSet
- Provider Compare Basic
- CLI auto-register
- Project relocation recovery

---

# 33. P2

- Composite Wiki
- Cross-provider topic comparison
- Semantic Search
- AI Q&A
- Cross-project Topics
- Knowledge Graph
- MCP Server
- Agent API
- Plugin Provider SDK
- Cloud Sync
- Team Hub

---

# 34. 首页 UX

```text
Home

Recent Projects

Needs Attention
- OpenZread: outdated
- Project B: Zread failed
- Project C: no Wiki

Providers
- OpenZread installed
- Zread installed

Recent Activity
```

---

# 35. Project Card

展示：

- Name
- Path
- Git Branch
- Provider summary
- Wiki count
- Latest update
- Warning

---

# 36. Project Wiki 页面

```text
Wiki

[ OpenZread ] [ Zread ] [ Composite ]

Status: Ready

Generate
Sync
Compare
Edit with Agent
```

---

# 37. Agent Edit

示例：

```text
Add Wiki Page

Topic:
Networking

Instruction:
Add a detailed networking architecture page.

Style:
Match Zread Provider

Sources:
Current source code

Output:
ChangeSet Preview
```

---

# 38. 与旧 ZReadHub 的继承关系

应继承：

- Dashboard 产品形态；
- Project Card；
- Multi-project Reader；
- Project Switcher；
- TOC；
- Source Path Reader；
- FlexSearch 经验；
- Plain Markdown Import；
- 测试 Fixture；
- E2E 思路；
- Mermaid Fullscreen；
- Path Safety 思想。

不应继承：

- `hub/app.js` 单文件架构；
- `admin-server.mjs`；
- Python Static Server；
- 双 Server；
- localhost CORS 文件访问；
- Hardcoded Root Path；
- Path Hash Project ID；
- 独立 Markdown Renderer；
- 一项目一 Wiki 假设。

---

# 39. 当前关键技术决策

1. Hub 不是 Open Zread CLI GUI。
2. Project 可以同时拥有多个 Wiki Variant。
3. Provider 负责 Generate。
4. Agent 负责后处理。
5. Unified Wiki Model 是 Hub 的核心内部数据接口。
6. Provider Native Output 保持 Source of Truth。
7. OpenZread 是 Native First-party Provider。
8. Zread CLI 是 External Provider。
9. 未来 Provider 不需要修改 Hub 核心 Reader/Search，只需要实现 Provider Adapter。

---

# 40. 成功指标

Project Management：

- 30 秒内完成项目添加；
- Hub → 任一 Wiki ≤ 3 clicks；
- Provider 切换 ≤ 1 click；
- 项目移动后可以恢复。

Wiki Management：

- OpenZread / Zread 可以同时存在；
- 不互相覆盖；
- 独立显示状态；
- Generate 无需 terminal；
- OpenZread Sync 无需 terminal。

Reliability：

- Provider 失败不影响其他 Provider；
- 一个项目损坏不阻塞 Hub；
- Remove From Hub 永远不删除源码；
- 删除 Wiki Variant 需要明确区分“从 Hub 移除”与“删除 Provider Output”。

---

# 41. 风险

## Provider 输出格式变化

应对：

- Adapter version；
- Schema validation；
- capability negotiation；
- backward compatibility tests。

## External CLI 行为不可控

应对：

- process isolation；
- timeout；
- stdout/stderr；
- command preview；
- provider health check。

## 多 Wiki 带来用户认知复杂度

应对：

- 默认选择 Primary Provider；
- Provider Matrix；
- 清晰的 Variant 标签；
- 允许用户指定默认 Provider。

## Agent 修改污染 Provider Wiki

初期不建议直接覆盖 Provider 原始生成内容。

推荐：

```text
Provider Wiki
    ↓
Agent Working Copy / Overlay
```

或：

```text
ChangeSet
    ↓
Review
    ↓
Apply
```

---

# 42. 推荐开发阶段

## Phase 1 — Hub Foundation

- Tauri
- Project Registry
- Project Library
- Unified Reader shell

## Phase 2 — Provider Foundation

- Provider SDK
- OpenZread Provider
- Zread CLI Provider
- Provider Matrix
- Unified Wiki Model

## Phase 3 — Wiki Lifecycle

- Generate
- Sync
- Regenerate
- Status
- Progress
- Activity

## Phase 4 — Knowledge Navigation

- Search
- Recent
- Favorites
- Topics
- Markdown Adapter

## Phase 5 — Wiki Operations

- Style Profile
- Agent Edit
- ChangeSet
- Compare

## Phase 6 — Knowledge Synthesis

- Composite Wiki
- Semantic Search
- Q&A
- Knowledge Graph
- MCP / Agent

---

# 43. 推荐下一步技术验证

## Spike A — Provider Prototype

实现：

```text
WikiProvider interface

OpenZreadProvider
ZreadCliProvider
```

验证两套 CLI 可以统一进入同一个 Hub Provider Contract。

## Spike B — Unified Wiki Model

选择同一项目：

1. 用 OpenZread 生成；
2. 用 Zread CLI 生成；
3. 两者都转换为 Unified Wiki Model；
4. 用同一个 Reader 展示。

这是 v0.2 最关键的架构验证。

## Spike C — Variant Compare

对同一项目两份 Wiki：

- 对齐 Section；
- 对齐 Page；
- 显示 coverage 差异；
- 显示缺失 Topic。

---

# 44. 产品演进路径

```text
Open Zread CLI
       ↓
Multi-project Hub
       ↓
Multi-provider Wiki Hub
       ↓
Wiki Editing Workspace
       ↓
Cross-provider Compare
       ↓
Composite Wiki
       ↓
Local Code Knowledge Platform
```

---

# 45. 结论

v0.2 的核心变化是：

> 将 Wiki 生成从 Open Zread 的内部能力，提升为 Hub 的开放 Provider 能力。

这样 OpenZread 不再是 Hub 唯一的数据生产方式，而是：

```text
Native First-party Provider
```

同时 Zread CLI 可以作为：

```text
External Provider
```

并保持自己的生成风格、分析角度和 Wiki 组织方式。

未来任何新的 Wiki CLI 只需要实现 Provider Adapter，就可以加入系统。

不同 Provider 的结果不是互相替代，而是可以：

```text
Coexist
Compare
Complement
Merge
```

这使 Open Zread Hub 从“项目 Wiki 管理器”进一步演化为：

> **面向代码库的多视角知识生成、组织与消费平台。**
