# Open Zread Hub PRD v0.3

> 文档状态：Draft  
> 版本：v0.3  
> 日期：2026-09-13  
> 产品暂定名：Open Zread Hub / ZRead Hub / Code Knowledge Hub  
> 核心定位：Local-first、Multi-project、Multi-provider、Unified-maintenance 的代码知识平台

---

# 0. 文档摘要

Open Zread Hub v0.3 在 v0.2 “Multi-Provider Wiki Hub”基础上进一步升级。

v0.2 已确立：

- 一个 Project 可以存在多个 Wiki Provider；
- OpenZread CLI 是 First-party Native Provider；
- Zread CLI 是 External Provider；
- 不同 Provider 的 Wiki 作为独立 Wiki Variant 共存；
- Hub 使用 Unified Wiki Model 统一消费不同 Provider 的结果。

v0.3 进一步引入：

> **Unified Wiki Maintenance Architecture**

即：

- Provider 负责 Wiki 初始生成；
- Hub 负责 Wiki 后续长期维护；
- OpenZread Provider 可采用 Native Maintenance；
- Zread / 第三方 Provider 可采用 Overlay Maintenance；
- 用户可以将 Provider Wiki Fork 成完全由 Hub 管理的 Managed Variant；
- 所有 Provider Wiki 在 Hub 中都可以获得统一的增删改、AI 重写、Topic 管理、Diff、ChangeSet 和未来 Rebase 能力。

v0.3 核心产品公式：

```text
Provider Generated Wiki
        ↓
Provider Baseline
        ↓
Unified Wiki Model
        ↓
Wiki Maintenance Engine
        ↓
ChangeSet / Overlay / Native Mutation
        ↓
Managed Wiki Experience
```

一句话定义：

> Open Zread Hub 是一个本地优先的多项目、多 Wiki Provider 代码知识中心，不仅统一生成和阅读不同 Provider 的 Wiki，还为所有 Provider 提供统一、可审阅、可持续的 Wiki 后期维护能力。

---

# 1. 背景

Open Zread 当前已经具备：

- 代码库扫描；
- Repo Map；
- Wiki Catalog 生成；
- 页面内容生成；
- 增量 Sync；
- Wiki Browse；
- AI Chat；
- `wiki-topic-management` 分支中的后期 Wiki 维护能力。

其中 `wiki-topic-management` 已经实现或设计：

- 新增 Topic / Page；
- 删除 Page；
- 修改 Page Metadata；
- 修改 Section / Group；
- 修改 associatedFiles；
- 小节级 Rewrite；
- 独立页面重新生成；
- Slug 冲突检测；
- 文件迁移；
- 写入前 Mermaid 校验；
- Wiki JSON 的统一读改写；
- 进程内互斥。

这些能力证明：

> Wiki 的生命周期不应该结束于 Generate。

而应该持续进入：

```text
Generate
   ↓
Review
   ↓
Maintain
   ↓
Update
   ↓
Rewrite
   ↓
Reorganize
   ↓
Sync / Rebase
```

与此同时，Open Zread Hub v0.2 已决定支持多个 Wiki Provider：

```text
Project
├─ OpenZread Wiki
├─ Zread CLI Wiki
└─ Future Provider Wiki
```

因此 v0.3 的核心问题变成：

> 如何让 OpenZread 已经具备的 Wiki 后期维护能力，不只服务 OpenZread Wiki，而能服务所有 Provider Wiki？

---

# 2. 产品愿景

长期目标：

```text
Local Code Knowledge Platform
```

而不是：

```text
OpenZread CLI GUI
```

完整能力域：

- Project Management
- Wiki Provider Management
- Wiki Generation
- Unified Wiki Reading
- Wiki Maintenance
- AI Wiki Editing
- Cross-project Search
- Provider Compare
- Composite Wiki
- Knowledge Graph
- MCP / Agent Interface
- Long-term Knowledge Lifecycle

---

# 3. 核心产品原则

## 3.1 Local First

源码、Wiki、Overlay、ChangeSet、索引、Registry 默认保存在本地。

---

## 3.2 Provider Owns Baseline

Provider 原始生成结果视为：

```text
Provider Baseline
```

例如：

```text
.open-zread/wiki
.zread/wiki
```

默认不要求第三方 Provider 改变自己的原始存储格式。

---

## 3.3 Hub Owns Maintenance

Hub 统一负责：

- Add Topic
- Delete Page
- Rename
- Move
- Metadata Update
- Rewrite
- Expand
- Reorganize
- Diff
- ChangeSet
- Overlay
- Rebase
- Agent Maintenance

---

## 3.4 Generate 与 Maintain 解耦

```text
WikiProvider
    ↓
Generate

WikiMaintenanceEngine
    ↓
Maintain
```

Provider 不需要自己实现完整的 Topic Manager。

---

## 3.5 Multiple Wikis Are a Feature

不同 Provider 的 Wiki 可以：

- Coexist
- Compare
- Complement
- Fork
- Merge

而不是互相覆盖。

---

## 3.6 Baseline 与用户修改必须分离

尤其对于 External Provider：

```text
Zread Baseline
      +
Hub Overlay
      =
Managed Zread View
```

避免 Provider 再次生成时覆盖用户修改。

---

# 4. 产品定位升级

v0.2：

> Multi-Provider Code Knowledge Hub

v0.3：

> **Multi-Provider Code Knowledge & Wiki Maintenance Platform**

核心价值从：

```text
统一生成 + 统一浏览
```

升级为：

```text
统一生成
+
统一浏览
+
统一维护
+
持续演化
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

---

## 5.2 Wiki Workspace

```ts
interface WikiWorkspace {
  projectId: string;
  variants: WikiVariant[];
}
```

---

## 5.3 Wiki Variant

v0.3 增加 Baseline、Ownership 和 Maintenance Mode。

```ts
interface WikiVariant {
  id: string;
  projectId: string;

  origin: {
    providerId: string;
    baselineRevision?: string;
  };

  label: string;

  ownership:
    | "provider-native"
    | "hub-overlay"
    | "hub-managed"
    | "composite";

  maintenanceMode:
    | "native"
    | "overlay"
    | "managed";

  status:
    | "missing"
    | "ready"
    | "outdated"
    | "possibly_outdated"
    | "generating"
    | "syncing"
    | "rebasing"
    | "conflicted"
    | "error"
    | "unknown";

  nativeRoot?: string;

  createdAt?: string;
  updatedAt?: string;

  sourceRevision?: string;

  styleProfileId?: string;
  provenance?: WikiProvenance;
}
```

---

# 6. Wiki Provider Architecture

## 6.1 Provider 只负责生产能力

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

  getStatus?(
    ctx: ProjectContext,
    wiki: WikiVariant
  ): Promise<WikiStatus>;
}
```

---

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

  nativeMaintenance?: boolean;
}
```

`nativeMaintenance` 只表示 Provider 是否允许 Hub 直接修改 Provider 原始 Wiki。

---

# 7. Wiki Adapter

Provider 与 Hub 内部 Wiki Model 之间增加 Adapter 层。

```ts
interface WikiAdapter {
  read(): Promise<UnifiedWiki>;

  capabilities: {
    nativeWrite: boolean;
    nativeDelete: boolean;
    nativeMove: boolean;
    nativeMetadataUpdate: boolean;
  };

  writePage?(
    page: WikiPage,
    content: string
  ): Promise<void>;

  deletePage?(
    pageId: string
  ): Promise<void>;

  updateMetadata?(
    pageId: string,
    patch: WikiPagePatch
  ): Promise<void>;

  commitManifest?(
    wiki: UnifiedWiki
  ): Promise<void>;
}
```

---

# 8. Unified Wiki Model / Wiki IR

Hub 上层不依赖：

```text
.open-zread/wiki
.zread/wiki
future-provider-format
```

统一转换为：

```text
Unified Wiki Model
```

---

## 8.1 Unified Wiki

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

---

## 8.2 Wiki Page

```ts
interface WikiPage {
  id: string;
  slug: string;
  title: string;

  section?: string;
  group?: string;
  level?: string;

  contentPath?: string;

  sources?: SourceReference[];

  metadata?: {
    generatedBy?: string;
    lastModifiedBy?: string;
    generatedAt?: string;
    modifiedAt?: string;
  };
}
```

---

# 9. SourceReference：替代 associatedFiles 的通用模型

OpenZread 当前使用：

```text
associatedFiles
```

但这是 OpenZread-specific 概念。

v0.3 统一为：

```ts
interface SourceReference {
  type:
    | "file"
    | "symbol"
    | "directory"
    | "url"
    | "unknown";

  path?: string;
  symbol?: string;

  confidence?: number;

  origin?:
    | "provider"
    | "agent-inferred"
    | "user";

  providerMetadata?: unknown;
}
```

映射：

```text
OpenZread associatedFiles
        ↓
SourceReference[]
```

Zread 如果没有明确 Source 信息：

```text
Agent Analysis
    ↓
SourceReference[]
```

---

# 10. Wiki Maintenance Engine

v0.3 新增核心模块：

```text
WikiMaintenanceEngine
```

职责：

```text
Add
Delete
Rename
Move
Metadata Update
Rewrite
Expand
Reorganize
Refresh From Source
Validate
Diff
Apply ChangeSet
```

---

## 10.1 通用接口

```ts
interface WikiMaintenanceEngine {
  addTopic(
    wiki: WikiVariant,
    request: AddTopicRequest
  ): Promise<WikiChangeSet>;

  deletePage(
    wiki: WikiVariant,
    pageId: string
  ): Promise<WikiChangeSet>;

  updatePage(
    wiki: WikiVariant,
    pageId: string,
    patch: WikiPagePatch
  ): Promise<WikiChangeSet>;

  rewriteSection(
    wiki: WikiVariant,
    pageId: string,
    instruction: string
  ): Promise<WikiChangeSet>;

  rewritePage(
    wiki: WikiVariant,
    pageId: string,
    instruction: string
  ): Promise<WikiChangeSet>;

  reorganize(
    wiki: WikiVariant,
    instruction: string
  ): Promise<WikiChangeSet>;
}
```

---

# 11. Wiki Maintenance 操作分类

## 11.1 Deterministic Operations

不需要 AI：

- Delete Page
- Rename Page
- Change Title
- Change Section
- Change Group
- Move Page
- Change Slug
- Metadata Patch

这些能力可直接继承 `wiki-topic-management` 中的确定性 Mutation 思路。

---

## 11.2 AI Operations

需要 Agent：

- Add Topic
- Generate New Page
- Rewrite Section
- Rewrite Page
- Expand Page
- Reorganize Topic
- Refresh From Source
- Generate SourceReference
- Match Provider Style
- Merge Wiki Content

---

# 12. Maintenance Mode

v0.3 定义三种 Wiki Maintenance Mode。

---

## 12.1 Native Mode

适用于：

```text
OpenZread Provider
```

流程：

```text
Maintenance Operation
      ↓
ChangeSet
      ↓
Review
      ↓
Native Writer
      ↓
.open-zread/wiki
```

优势：

- 可直接修改 Provider Wiki；
- 可复用 OpenZread Topic Manager；
- 可复用 Wiki Mutation；
- 可复用 Incremental Sync；
- 可复用 Repo Map；
- 可复用 Source Reference；
- 可复用 Mermaid 校验。

---

## 12.2 Overlay Mode

默认适用于：

```text
Zread Provider
Third-party Provider
```

流程：

```text
Provider Baseline
       +
Hub Overlay
       ↓
Resolved Wiki
```

Provider 原始 Wiki 不被修改。

---

## 12.3 Managed Mode

用户可以将任何 Wiki：

```text
Fork as Managed Wiki
```

形成：

```text
Provider Baseline
      ↓ Fork
Hub Managed Variant
```

之后 Hub 拥有完整控制权：

- Add
- Delete
- Move
- Rewrite
- Reorganize
- Merge

但该 Variant 不再等同于 Provider 原始输出。

---

# 13. Baseline + Overlay Architecture

以 Zread 为例：

```text
.zread/wiki
   ↓
Zread Baseline
   ↓
Unified Wiki
   +
Hub Overlay
   ↓
Resolved Zread Wiki
```

---

## 13.1 Overlay 数据建议

```text
.open-zread/hub/
└─ overlays/
   └─ zread/
      ├─ manifest.json
      ├─ page-additions/
      ├─ page-patches/
      ├─ metadata-patches/
      └─ tombstones.json
```

---

## 13.2 Overlay 类型

```text
Page Addition
Page Content Patch
Metadata Patch
Move Patch
Delete Tombstone
SourceReference Patch
Style Metadata
```

---

# 14. Wiki ChangeSet Engine

所有修改尽量先产生：

```text
WikiChangeSet
```

---

## 14.1 数据结构

```ts
interface WikiChangeSet {
  id: string;

  wikiVariantId: string;
  baselineRevision?: string;

  changes: WikiChange[];

  createdAt: string;

  createdBy:
    | "user"
    | "agent"
    | "system";

  status:
    | "draft"
    | "reviewed"
    | "applied"
    | "rejected"
    | "conflicted";
}
```

---

## 14.2 WikiChange

```ts
type WikiChange =
  | AddPageChange
  | DeletePageChange
  | UpdateMetadataChange
  | MovePageChange
  | RewriteContentChange
  | ReorganizeChange;
```

---

# 15. ChangeSet 工作流

```text
User Request
    ↓
Maintenance Engine
    ↓
Generate ChangeSet
    ↓
Preview Diff
    ↓
Review
    ↓
Apply
    ↓
Native Writer / Overlay Writer
```

---

# 16. Wiki Topic Manager 能力迁移

当前 OpenZread `wiki-topic-management` 可以映射为：

| OpenZread 当前能力 | Hub v0.3 通用能力 |
|---|---|
| Append Wiki Topic | AddTopicOperation |
| Delete Wiki Page | DeletePageOperation |
| Update Metadata | UpdatePageOperation |
| Change Section | MovePageOperation |
| Associated Files Update | RelinkSourceOperation |
| Regenerate Section | RewriteSectionOperation |
| Regenerate Page | RewritePageOperation |
| Slug Conflict Check | WikiValidation |
| Mermaid Check | ContentValidation |

---

# 17. Validation Engine

Wiki Maintenance Engine 不应直接信任所有 Agent 输出。

建议增加：

```text
WikiValidationEngine
```

---

## 17.1 Validation

P0：

- Slug uniqueness
- Path conflict
- Markdown file existence
- Mermaid syntax
- Duplicate Page ID
- Invalid Section
- Unsafe path

P1：

- Broken internal links
- Missing referenced page
- SourceReference validity
- Duplicate Topic detection
- Structural consistency

P2：

- Semantic overlap
- Contradiction detection
- Provider-style consistency

---

# 18. Wiki Style Profile

External Provider 尤其需要 Style Profile。

例如：

```text
Zread Baseline
      ↓
Style Analyzer
      ↓
Zread Style Profile
      ↓
Hub Agent Maintenance
```

---

## 18.1 Style Profile 内容

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
- Architecture-first / Code-first

---

# 19. Zread Provider 后期维护

Zread CLI 只负责：

```text
Initial Generate
Regenerate Baseline
```

Hub 可以负责：

```text
Add Topic
Delete Topic
Rewrite Section
Rewrite Page
Move Page
Rename Page
Expand Topic
Reorganize
Add Diagram
Add Source Reference
```

默认采用：

```text
Overlay Mode
```

---

# 20. Provider Baseline 更新

当 External Provider 再次生成：

```text
Baseline v1
   ↓
Baseline v2
```

旧 Overlay 不应直接丢弃。

引入：

```text
Overlay Rebase
```

---

# 21. Wiki Rebase

长期模型：

```text
Provider Baseline v1
      +
ChangeSet A
ChangeSet B
ChangeSet C
```

Provider 更新：

```text
Baseline v2
```

Hub 执行：

```text
Rebase
```

结果：

```text
Applied
Conflict
Obsolete
Needs Review
```

---

## 21.1 Rebase P1/P2 能力

- Detect baseline revision change
- Replay deterministic ChangeSet
- Detect content conflict
- Detect deleted source page
- Detect moved provider page
- AI-assisted conflict resolution

---

# 22. Provider 与 Maintenance 的职责边界

## Provider

负责：

- Detect
- Generate
- Regenerate
- Sync
- Baseline Status

---

## Adapter

负责：

- Parse Provider Format
- Convert to Unified Wiki
- Native Read/Write Capability Mapping

---

## Maintenance Engine

负责：

- CRUD
- AI Rewrite
- Topic Management
- Validation
- ChangeSet
- Apply
- Rebase

---

# 23. 完整架构

```text
                        Open Zread Hub
                              │
                          Project
                              │
                        Wiki Providers
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
 OpenZreadProvider       ZreadProvider        FutureProvider
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ↓
                         Wiki Adapters
                              ↓
                      Unified Wiki Model
                              ↓
                    Wiki Maintenance Engine
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
 Deterministic Ops         AI Ops           Validation Engine
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ↓
                      Wiki ChangeSet Engine
                              ↓
                 ┌────────────┼─────────────┐
                 │            │             │
           Native Writer  Overlay Writer  Managed Writer
                 │            │             │
           OpenZread Wiki   Zread Wiki   Hub Variant
```

---

# 24. Project Detail

推荐结构：

```text
Project
├─ Overview
├─ Wiki
├─ Providers
├─ Maintenance
├─ Topics
├─ Search
├─ Activity
└─ Settings
```

---

# 25. Wiki 页面 UX

```text
Wiki

[ OpenZread ] [ Zread ] [ Zread Managed ]

Status: Ready
Maintenance: Overlay

Generate
Sync
Compare
Add Topic
Edit with AI
History
```

---

# 26. Maintenance Toolbar

统一提供：

```text
Add Topic
Rename
Move
Rewrite Section
Rewrite Page
Delete
Refresh From Source
```

不同 Provider 的内部写入方式不同，但用户体验一致。

---

# 27. ChangeSet Preview UX

```text
Wiki Change

Provider:
Zread

Operation:
Rewrite Section

Page:
Architecture

Changes:
+ 23 lines
- 11 lines

Source:
Current Code

Style:
Match Zread

[ Reject ] [ Edit ] [ Apply ]
```

---

# 28. Provider Matrix

| Provider | Baseline | Maintenance | Status | Actions |
|---|---|---|---|---|
| OpenZread | Native | Native | Outdated | Sync / Maintain |
| Zread | External | Overlay | Ready | Regenerate / Maintain |
| Zread Managed | Fork | Managed | Ready | Maintain |
| Composite | Derived | Managed | Ready | Rebuild / Maintain |

---

# 29. Search

搜索结果必须包含：

```text
Project
Provider
Variant
Page
Section
Snippet
```

避免多 Provider 下结果歧义。

---

# 30. Activity

新增记录：

- ChangeSet Created
- ChangeSet Applied
- ChangeSet Rejected
- Overlay Rebased
- Overlay Conflict
- Managed Variant Forked
- Native Mutation
- Page Added
- Page Deleted
- Page Moved
- Section Rewritten

---

# 31. Source of Truth

## Native Mode

```text
Provider Wiki
```

是实际修改后的 Source of Truth。

---

## Overlay Mode

```text
Provider Baseline
+
Hub Overlay
```

共同组成 Resolved Wiki。

---

## Managed Mode

```text
Hub Managed Variant
```

成为独立 Source of Truth。

---

# 32. Desktop 技术方案

继续推荐：

```text
Tauri + React
```

主要原因：

- 本地文件系统；
- CLI Process；
- IPC；
- Overlay 文件管理；
- ChangeSet；
- Provider 生命周期；
- 安全边界；
- 可复用 Browse UI。

---

# 33. 推荐 Monorepo 结构

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
│
├─ hub-core/
├─ project-registry/
├─ provider-sdk/
├─ providers/
│  ├─ openzread-provider/
│  └─ zread-provider/
│
├─ wiki-model/
├─ wiki-adapters/
├─ wiki-maintenance/
├─ wiki-changeset/
├─ wiki-validation/
├─ wiki-overlay/
├─ search-index/
└─ source-adapters/
```

---

# 34. OpenZread Topic Manager 代码复用建议

优先迁移：

```text
wiki-mutation.ts
```

拆为：

```text
wiki-maintenance/
├─ mutation/
├─ validation/
├─ file-ops/
└─ native-openzread-writer/
```

当前：

```text
appendWikiTopic
updateWikiTopicAssociatedFiles
regenerateWikiPageSection
deleteWikiPage
updateWikiPageMetadata
```

可逐步迁移为 Maintenance Engine Operation。

---

# 35. P0 Scope

v0.3 将 Maintenance Engine 提升到 P0/P0+。

## Desktop

- Tauri shell
- Project Library
- Add / Remove Project
- Recent
- Favorite

## Provider

- Provider Registry
- OpenZread Provider
- Zread Provider
- Provider Detection
- Provider Matrix

## Unified Wiki

- Unified Wiki Model
- Wiki Adapter
- Multi Variant
- Unified Reader
- Provider Switcher

## Generation

- OpenZread Generate
- OpenZread Sync
- Zread Generate / Regenerate

## Maintenance

- Wiki Maintenance Engine
- Add Topic
- Delete Page
- Rename
- Move
- Metadata Update
- Rewrite Section
- Rewrite Page
- ChangeSet
- Change Preview
- Validation

## Writers

- OpenZread Native Writer
- Generic Overlay Writer

---

# 36. P1

- Workspace Scan
- File Watch
- Git Metadata
- Full-text Search
- Activity
- Plain Markdown Adapter
- Style Profile
- Managed Variant Fork
- Rebase deterministic changes
- Basic conflict detection
- SourceReference inference
- CLI auto-register
- Project relocation recovery

---

# 37. P2

- AI-assisted Rebase
- Composite Wiki
- Cross-provider topic alignment
- Semantic Search
- AI Q&A
- Knowledge Graph
- Cross-project Topics
- MCP Server
- Agent API
- Plugin Provider SDK
- Cloud Sync
- Team Hub

---

# 38. Success Metrics

## Multi-provider

- 同项目可同时存在 OpenZread 和 Zread Wiki；
- 不互相覆盖；
- 可一键切换；
- 独立状态。

## Maintenance

- 用户无需关心 Provider 类型即可执行 Add / Delete / Rewrite；
- OpenZread 走 Native Writer；
- Zread 默认走 Overlay Writer；
- External Provider Regenerate 不丢失 Hub 修改；
- 每次 AI 维护都可以 Preview Diff。

## Reliability

- Provider 失败不影响其他 Variant；
- ChangeSet Apply 失败可回滚或保持 Draft；
- Overlay 冲突可识别；
- Remove From Hub 不删除源码。

---

# 39. 风险

## 39.1 Overlay 与 Provider 新版本冲突

应对：

- baselineRevision；
- ChangeSet；
- rebase；
- conflict state。

---

## 39.2 AI Rewrite 破坏 Provider Style

应对：

- Style Profile；
- style-aware prompt；
- Diff Review。

---

## 39.3 External Provider 页面 ID 不稳定

应对：

- slug + title + content fingerprint；
- page identity mapping；
- fuzzy matching。

---

## 39.4 Native Mutation 与 Sync 冲突

OpenZread 自己既能 Sync 又能手工维护。

需要明确：

```text
Generated Content
+
User Maintained Content
```

哪些字段在 Sync 时允许覆盖。

这是后续需要单独设计的：

```text
Manual Edit Preservation Policy
```

---

# 40. Manual Edit Preservation Policy

OpenZread Native Mode 不能简单让 Sync 覆盖所有 Agent / 用户修改。

建议后续区分：

```text
provider-generated
user-edited
agent-edited
locked
```

页面或 Section 可以拥有：

```text
maintenanceState
```

例如：

```ts
type MaintenanceState =
  | "provider-owned"
  | "hub-managed"
  | "user-locked";
```

P1 深化。

---

# 41. 推荐开发阶段

## Phase 1 — Hub Foundation

- Tauri
- Registry
- Project Library
- Unified Reader

## Phase 2 — Provider Foundation

- Provider SDK
- Wiki Adapter
- OpenZread Provider
- Zread Provider
- Unified Wiki

## Phase 3 — Maintenance Foundation

- Maintenance Engine
- ChangeSet
- Validation
- Native Writer
- Overlay Writer

## Phase 4 — Topic Management

- Add
- Delete
- Rename
- Move
- Rewrite
- Source Relink

## Phase 5 — Knowledge Lifecycle

- Activity
- Search
- Style Profile
- Managed Variant
- Rebase

## Phase 6 — Knowledge Synthesis

- Compare
- Composite Wiki
- Semantic Search
- Q&A
- Knowledge Graph

---

# 42. 推荐技术 Spike

## Spike A — Native vs Overlay

同一个维护操作：

```text
Delete Page
```

分别运行在：

```text
OpenZread Native
Zread Overlay
```

验证用户体验一致。

---

## Spike B — Add Topic

同一 Project：

```text
OpenZread Wiki
Zread Wiki
```

分别执行：

```text
Add Topic: Dependency Injection
```

要求：

- 使用同一 Maintenance Engine；
- 读取不同 Style Profile；
- 产生不同 ChangeSet；
- 最终写入 Native / Overlay。

---

## Spike C — Zread Regenerate + Rebase

流程：

```text
Zread Baseline v1
→ Hub Rewrite
→ Hub Add Topic
→ Zread Regenerate v2
→ Rebase Overlay
```

验证：

- 修改不丢失；
- 冲突可检测；
- 无冲突修改自动恢复。

---

# 43. 核心技术决策

1. Provider 负责生成，Hub 负责长期维护。
2. OpenZread 采用 Native Maintenance。
3. Zread / Third-party 默认采用 Overlay Maintenance。
4. 所有维护操作统一经过 Maintenance Engine。
5. 所有重要修改优先产生 ChangeSet。
6. Unified Wiki Model 是维护层的唯一主接口。
7. Provider Baseline 与 Hub 用户修改分离。
8. External Provider 再生成后通过 Rebase 继承 Hub 修改。
9. associatedFiles 升级为通用 SourceReference。
10. OpenZread Topic Manager 是 Hub Maintenance Engine 的第一份 Reference Implementation。

---

# 44. 产品演进路径

```text
Open Zread CLI
       ↓
Multi-project Hub
       ↓
Multi-provider Wiki Hub
       ↓
Unified Wiki Maintenance
       ↓
Overlay / ChangeSet / Rebase
       ↓
Cross-provider Compare
       ↓
Composite Knowledge
       ↓
Local Code Knowledge Platform
```

---

# 45. v0.3 最终结论

v0.2 的核心创新是：

> Wiki Provider

v0.3 的核心创新是：

> **Wiki Maintenance Engine**

最终产品边界变成：

```text
Provider
负责第一次生成和上游更新

Hub
负责统一阅读、长期维护、AI 修改、Diff、Overlay、Rebase 与知识演化
```

OpenZread Provider 因为开源且可控，可以拥有最深的 Native Integration。

Zread CLI 等闭源或第三方 Provider 即使没有任何 Wiki 编辑 API，也仍然可以通过：

```text
Unified Wiki
+
Overlay
+
ChangeSet
+
AI Maintenance
```

获得完整的后期维护能力。

这意味着 Open Zread Hub 不再只是：

> 多 Provider Wiki 浏览器

而是：

> **能够把任何 Provider 的一次性 Wiki 生成结果，转化为可持续维护、可持续演化的长期代码知识资产的平台。**
