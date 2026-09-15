c# Open Zread Hub 初步产品需求文档（PRD）

**版本**：v0.1  
**日期**：2026-09-13  
**目标项目**：`leedrin/open-zread`  
**目标分支参考**：`wiki-topic-management`

---

## 1. 背景

Open Zread 当前定位是一个本地优先的 AI Code Wiki 生成工具：

- 用户进入某个代码项目目录；
- 运行 `open-zread`；
- 分析当前项目代码；
- 在项目目录中生成 `.open-zread/wiki/`；
- 通过 `open-zread browse` 启动本地 Web Reader 浏览 Wiki；
- 后续代码变化后，通过 Wiki Sync 增量更新文档。

这种模式非常适合“单个项目”的分析和阅读，但当用户同时维护多个代码库时会出现明显的入口碎片化问题：

1. 必须先找到项目所在目录；
2. 必须进入该目录才能运行 CLI；
3. 每个项目单独启动 Wiki Reader；
4. 无法在一个界面看到所有项目；
5. 无法快速判断哪些项目已经生成 Wiki、哪些需要同步；
6. 无法进行跨项目搜索、收藏、最近访问和知识导航。

与此同时，zread.ai 的产品体验更接近一个“代码知识门户”：仓库搜索、仓库入口、Wiki 文档、代码理解和 AI Q&A 都集中在统一入口中。

因此，本项目需要在 Open Zread 现有 CLI + Wiki Generator + Browser 的基础上增加一个 **Open Zread Hub**。

---

# 2. 产品定义

## 2.1 产品名称

暂定：

**Open Zread Hub**

也可以进一步演化为：

- Open Zread Desktop
- Zread Workspace
- Zread Library
- Open Zread Studio

本文统一使用 **Hub**。

---

## 2.2 一句话定义

> Open Zread Hub 是 Open Zread 的本地多项目知识中心，用一个类似 ChatGPT Desktop 的统一界面管理本机所有 Open Zread 项目，并集中浏览、搜索、生成和同步项目 Wiki。

---

# 3. 产品目标

Hub 需要解决三个核心问题。

### 3.1 找到项目

用户不再需要记住：

```text
D:\Workspace\ProjectA
D:\Git\ProjectB
E:\UEProjects\ProjectC
```

Hub 提供统一项目 Library。

---

### 3.2 找到知识

用户不再需要：

```bash
cd project-a
open-zread browse
```

然后切换到：

```bash
cd project-b
open-zread browse
```

Hub 内直接：

```text
Projects
 ├─ Project A
 │   └─ Wiki
 ├─ Project B
 │   └─ Wiki
 └─ Project C
     └─ Wiki
```

---

### 3.3 管理 Wiki 生命周期

Hub 不只负责“读 Wiki”，还应成为 Wiki 生命周期控制台：

```text
未分析
   ↓
生成 Wiki
   ↓
Wiki Ready
   ↓
源码变化
   ↓
Outdated
   ↓
Sync
   ↓
Updated
```

---

# 4. 非目标

v1 不建议立即实现：

- 云端同步；
- 团队账号；
- Wiki SaaS；
- 远程 GitHub Repository 托管；
- 多用户协作编辑；
- 云端向量数据库；
- 在线代码执行环境；
- 完整 IDE。

这些能力以后可以演化，但不应该影响第一阶段架构。

---

# 5. 产品设计原则

## 5.1 Local First

所有源码、Wiki、索引默认保存在本地。

---

## 5.2 Project Owns Wiki

项目中的：

```text
project/
└─ .open-zread/
   ├─ wiki/
   └─ cache/
```

仍然是该项目 Wiki 的 **Source of Truth**。

Hub 不复制一份完整 Wiki。

Hub 只维护：

```text
项目注册信息
索引
状态
用户偏好
搜索索引
最近访问
收藏
```

---

## 5.3 Hub 是控制面，不是数据仓库

推荐模型：

```text
                 Open Zread Hub
                       │
            ┌──────────┼──────────┐
            │          │          │
        Project A  Project B  Project C
            │          │          │
       .open-zread .open-zread .open-zread
            │          │          │
           Wiki       Wiki       Wiki
```

而不是：

```text
Hub
└─ Central Wiki Copy
   ├─ Project A
   ├─ Project B
   └─ Project C
```

这样可以避免：

- Wiki 双份数据；
- 同步冲突；
- 项目移动后数据失配；
- Git 提交 Wiki 与 Hub Wiki 不一致。

---

# 6. 目标用户

## 6.1 核心用户

同时维护多个代码项目的开发者。

典型用户可能同时拥有：

- 游戏项目；
- Engine / Tool；
- Web 项目；
- Agent 项目；
- GitHub Clone 项目；
- 研究性质代码库。

---

# 7. 核心用户场景

## 场景 A：添加项目

用户点击：

```text
+ Add Project
```

选择：

```text
D:\Workspace\MyProject
```

Hub 检测：

```text
Git Repository        ✓
.open-zread            ✓
Wiki                   ✓
Last Generated         2026-09-10
Source Changed         Yes
```

项目自动进入 Library。

---

## 场景 B：项目还没有 Wiki

Hub 显示：

```text
Uninitialized
```

操作：

```text
Generate Wiki
```

Hub 实际调用：

```bash
open-zread wiki
```

Working Directory：

```text
D:\Workspace\MyProject
```

---

## 场景 C：浏览 Wiki

用户点击：

```text
Project A
```

进入：

```text
Project Overview
Wiki
Topics
Source
Activity
```

选择 Wiki 后直接在 Hub 内展示 Markdown / Mermaid / Code Block。

不再额外启动：

```bash
open-zread browse
```

---

## 场景 D：源码已经变化

Hub检测：

```text
Wiki Status: Outdated
12 source files changed
3 wiki pages affected
```

用户点击：

```text
Sync Wiki
```

然后实时看到：

```text
Scanning
Parsing
Planning
Updating 3 pages
Completed
```

---

# 8. 信息架构

推荐主导航：

```text
Open Zread Hub

├─ Home
├─ Projects
├─ Recent
├─ Favorites
├─ Search
└─ Settings
```

---

# 9. Home 首页

首页目标不是 Wiki 本身，而是回答：

> 我有哪些项目？最近发生了什么？哪些 Wiki 需要处理？

推荐布局：

```text
┌─────────────────────────────────────────┐
│ Open Zread                              │
│ Search projects or Wiki...              │
├─────────────────────────────────────────┤
│ Recent Projects                         │
│                                         │
│ Project A        Ready                  │
│ Project B        Wiki Outdated          │
│ Project C        Generating...           │
│                                         │
├─────────────────────────────────────────┤
│ Needs Attention                         │
│ 3 projects need Wiki sync               │
└─────────────────────────────────────────┘
```

---

# 10. Projects Library

建议支持两种视图。

## 10.1 Card View

适合类似 ChatGPT Desktop / Launcher：

```text
Project A
TypeScript
Wiki Ready
Updated 2h ago
```

---

## 10.2 List View

适合项目较多：

| Project | Path | Wiki | Git | Last Update |
|---|---|---|---|---|
| Open Zread | D:\Git\open-zread | Ready | main | 2h |
| Rewind Debugger | D:\Unity\rewind | Outdated | dev | 1d |

---

# 11. Project Detail

进入项目后建议采用：

```text
Project
├─ Overview
├─ Wiki
├─ Topics
├─ Source
└─ Activity
```

---

# 12. Wiki Reader

现有 `apps/browse` 应尽可能直接复用。

Hub Wiki URL 可以从当前：

```text
/:slug
```

升级为：

```text
/project/:projectId/wiki/:slug
```

例如：

```text
/project/open-zread/wiki/architecture
```

这样同一个 Browser Runtime 可以读取多个项目。

---

# 13. Project Registry

Hub 需要建立一个中央项目注册表。

建议位置：

```text
~/.open-zread/
└─ hub/
   ├─ projects.json
   ├─ settings.json
   └─ index.db
```

MVP 可以使用 JSON。

后期建议迁移 SQLite。

---

# 14. Project 数据模型

建议：

```ts
interface HubProject {
  id: string

  name: string
  path: string

  git?: {
    remote?: string
    branch?: string
    commit?: string
  }

  openZread: {
    initialized: boolean
    wikiPath?: string
    wikiStatus:
      | "missing"
      | "ready"
      | "outdated"
      | "generating"
      | "syncing"
      | "error"

    lastGeneratedAt?: string
    lastSyncedAt?: string
  }

  tags?: string[]

  favorite?: boolean
  lastOpenedAt?: string
}
```

---

# 15. 项目发现

Hub 应支持三种方式。

## A. 手动添加

```text
Add Project → Choose Folder
```

MVP 必须支持。

---

## B. 扫描 Workspace

用户设置：

```text
D:\Workspace
D:\Git
E:\Projects
```

Hub递归查找：

```text
.git/
.open-zread/
package.json
Cargo.toml
*.uproject
*.sln
```

然后提示：

```text
Found 17 repositories
Add selected projects
```

建议 v1.1。

---

## C. 自动注册

当用户在某项目第一次执行：

```bash
open-zread
```

CLI 自动：

```text
register project into Hub Registry
```

这样 CLI 与 Desktop Hub 自动联动。

这是非常值得实现的一点。

---

# 16. CLI 与 Hub 的关系

推荐不要废弃 CLI。

架构应该是：

```text
          Open Zread Core
                │
       ┌────────┴────────┐
       │                 │
      CLI               Hub
       │                 │
 Terminal UI       Desktop / GUI
```

Hub 调用 Core API，而不是长期通过解析终端输出控制 CLI。

短期 MVP 可以使用 Child Process：

```text
Hub
 ↓
spawn(open-zread)
 ↓
project cwd
```

长期应抽离：

```text
@open-zread/core
```

提供：

```ts
generateWiki(projectPath)
syncWiki(projectPath)
getWikiStatus(projectPath)
loadWiki(projectPath)
scanProject(projectPath)
```

CLI 和 Hub 同时使用该 Core。

---

# 17. Desktop 技术方案

推荐优先考虑：

## Tauri + React

原因：

- 现有 Browse 已经是 React；
- 可直接复用 UI；
- 桌面程序体积明显小于 Electron；
- 可以安全访问本地文件系统；
- 可以启动 Open Zread Core / CLI；
- Windows/macOS 后续都可覆盖。

推荐结构：

```text
apps/
├─ cli
├─ browse
└─ desktop
```

或者将：

```text
apps/browse
```

逐步升级为：

```text
apps/hub
```

Browser Reader 成为 Hub 的一个 Feature。

---

# 18. 推荐前端结构

```text
apps/hub/src/

features/
├─ projects/
├─ wiki/
├─ search/
├─ activity/
├─ settings/
└─ generation/

pages/
├─ home/
├─ projects/
├─ project/
├─ wiki/
└─ settings/
```

---

# 19. Hub Service

Desktop 后端负责：

```text
Project Registry
Filesystem
Git Status
Wiki Status
CLI/Core execution
File Watch
Search Index
```

概念架构：

```text
React UI
   │
   │ IPC
   ▼
Hub Service
   │
   ├─ ProjectRegistry
   ├─ WikiService
   ├─ GitService
   ├─ ProcessService
   ├─ SearchService
   └─ FileWatcher
          │
          ▼
   Local Projects
```

---

# 20. Wiki 状态检测

这是 Hub 最重要的后台能力之一。

状态：

```text
MISSING
READY
OUTDATED
GENERATING
SYNCING
ERROR
```

Hub 可以根据：

```text
.open-zread/cache/manifest.json
Git HEAD
File mtime
AST Hash
Wiki Metadata
```

判断 Wiki 是否需要刷新。

应尽量复用 Open Zread 当前的增量缓存和 Wiki Sync 逻辑，而不是 Hub 自己重新实现代码 diff。

---

# 21. 全局搜索

MVP 第一版：

```text
搜索 Project Name
搜索 Wiki Title
搜索 Markdown Text
```

未来：

```text
跨项目 Semantic Search
```

例如：

```text
"哪里实现了 Agent Retry?"
```

返回：

```text
Open Zread
  Agent Runtime / Retry Strategy

Rewind Debugger
  Capture Pipeline / Retry
```

这是 Hub 相比单项目 Browse 最有价值的长期能力之一。

---

# 22. Topic Management

当前 `wiki-topic-management` 分支已经体现 Wiki 不再只是简单页面树，而开始拥有 Topic / Page 生命周期管理思路。

Hub 中建议把 Topic 提升一级：

```text
Project
 └─ Topics
     ├─ Architecture
     ├─ Runtime
     ├─ Agent System
     └─ Storage
```

后续可以允许：

```text
跨项目 Topic
```

例如：

```text
Animation
 ├─ Unreal Migration
 ├─ Rewind Debugger
 └─ Motion Analysis
```

这会让 Hub 从“项目启动器”升级为真正的“个人代码知识库”。

但跨项目 Topic 不建议进入 MVP。

---

# 23. Activity

建议保留 Wiki 生命周期记录：

```text
2026-09-13
Wiki Sync

Changed:
+ Agent Runtime
~ CLI Architecture
- Legacy Provider

Source:
23 files changed
```

未来可以继续扩展为知识变化 Timeline。

---

# 24. MVP 功能范围

## P0

必须实现：

- Desktop Hub；
- Add Project；
- Remove Project；
- Project Registry；
- 项目列表；
- 打开项目；
- 检测 `.open-zread`；
- 检测 Wiki 是否存在；
- 在 Hub 内浏览 Wiki；
- Generate Wiki；
- Sync Wiki；
- Generation Progress；
- 打开项目文件夹；
- 打开 Terminal；
- Recent Projects；
- Favorites。

---

## P1

下一阶段：

- Workspace Scan；
- File Watch；
- 自动 Wiki Outdated 检测；
- 全局 Wiki 文本搜索；
- Tags；
- Git Branch / Status；
- Wiki Activity；
- CLI 自动注册项目。

---

## P2

长期：

- 跨项目 Semantic Search；
- AI Q&A；
- Cross Project Topics；
- Knowledge Graph；
- Workspace；
- MCP Server；
- Agent Interface；
- 云同步；
- Team Hub。

---

# 25. 首版 UI 建议

整体交互建议参考：

```text
ChatGPT Desktop
+
VS Code Project Explorer
+
Zread Wiki
```

主界面：

```text
┌─────────────┬─────────────────────────────────┐
│ Open Zread  │                                 │
│             │                                 │
│ Home        │      Project / Wiki Content     │
│ Projects    │                                 │
│ Search      │                                 │
│ Favorites   │                                 │
│             │                                 │
│ Settings    │                                 │
└─────────────┴─────────────────────────────────┘
```

进入 Project：

```text
┌─────────────┬──────────────┬──────────────────┐
│ Projects    │ Wiki TOC     │ Wiki Content     │
│             │              │                  │
│ Open Zread  │ Overview     │ Architecture     │
│ Rewind      │ Runtime      │                  │
│ UE Tools    │ Agent        │ Mermaid...       │
│             │ CLI          │                  │
└─────────────┴──────────────┴──────────────────┘
```

---

# 26. 关键产品决策

## Decision 1

**Wiki 不集中复制。**

Hub 保存 Project Registry，Wiki 保留在原项目。

---

## Decision 2

**Hub 不替代 CLI。**

Hub 与 CLI 是 Open Zread 的两个入口。

---

## Decision 3

**Browser 应升级为多项目 Reader，而不是另写 Reader。**

最大化复用现有 React Wiki 浏览代码。

---

## Decision 4

**Hub Registry 与 Wiki Generator 解耦。**

即使一个项目还没生成 Wiki，它也可以存在于 Hub。

---

## Decision 5

**项目路径是 Location，不是 Identity。**

Project ID 不应该直接等于 Path。

因为项目可能从：

```text
D:\Git\Project
```

移动到：

```text
E:\Workspace\Project
```

推荐 ID：

```text
UUID
```

并辅助使用：

```text
Git Remote
Repository ID
```

识别项目。

---

# 27. 建议的开发阶段

## Phase 1：Project Library

完成：

```text
Desktop
Project Registry
Add Project
Project List
Open Project
```

先解决“统一入口”。

---

## Phase 2：Unified Wiki Reader

把现有 Browse Reader 接入 Hub：

```text
projectId → wiki path → wiki.json → pages
```

解决“统一浏览”。

---

## Phase 3：Wiki Lifecycle

加入：

```text
Generate
Sync
Status
Progress
Error
```

解决“统一管理”。

---

## Phase 4：Knowledge Hub

加入：

```text
Global Search
Tags
Topics
Recent
Favorites
Activity
```

真正成为知识库。

---

## Phase 5：AI Workspace

未来：

```text
Ask Across Projects
Compare Architecture
Find Implementations
Generate Research
Cross-project Agent
```

这时 Open Zread Hub 将不再只是 Wiki 管理器，而会逐渐接近一个：

> Local Code Knowledge Operating System

---

# 28. MVP 成功指标

首版可以使用非常简单的指标。

### 项目管理

```text
用户可以在 30 秒内把现有项目加入 Hub。
```

### Wiki 访问

```text
从启动 Hub 到打开任意项目 Wiki ≤ 3 次点击。
```

### 项目切换

```text
从 Project A Wiki 切到 Project B Wiki ≤ 2 次点击。
```

### 生命周期

```text
不进入 Terminal 即可完成 Generate / Sync。
```

### 数据完整性

```text
Hub 删除 Project 不删除项目源码和 .open-zread Wiki。
```

---

# 29. 建议的新模块

建议未来在 monorepo 增加：

```text
packages/
├─ hub-core
├─ project-registry
└─ search-index

apps/
├─ cli
├─ browse
└─ hub
```

其中：

```text
hub-core
```

负责：

```text
Project Discovery
Wiki Status
Process Orchestration
File Watch
Git Metadata
```

---

# 30. 最小架构草图

```text
                 Open Zread Hub
                       │
                React Desktop UI
                       │
                      IPC
                       │
                  Hub Service
                       │
       ┌───────────────┼────────────────┐
       │               │                │
ProjectRegistry    WikiService       GitService
       │               │                │
       │         Open Zread Core         │
       │               │                │
       └───────────────┼────────────────┘
                       │
                 Local Projects
                       │
             .open-zread/wiki
```

---

# 31. 核心判断

从产品演化角度，Hub 不应该被定义成：

> 一个用于启动 `open-zread browse` 的项目 Launcher。

这种定位价值太低。

更合理的定义是：

> **Open Zread 的多项目控制面和本地代码知识中心。**

第一阶段只是：

```text
Project Library
+
Unified Wiki Reader
```

但架构上应该为下面这些能力保留空间：

```text
Global Search
Cross Project Topics
AI Q&A
Knowledge Graph
Agent
MCP
```

这样 Open Zread 的产品形态就会从：

```text
CLI Wiki Generator
```

逐步演化成：

```text
Local Code Knowledge Platform
```

这也是我认为最值得推进的产品方向。
