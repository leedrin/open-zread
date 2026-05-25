# Spec: 生成后收尾管道

## 概述

在所有 Wiki 页面生成完成后，执行链接修复、索引构建和侧边栏生成等收尾步骤。

## 需求

### FP-001: 链接修复

**Given** wiki/ 目录下的 `.md` 文件中可能包含 `file:///` 绝对路径
**When** 调用 `sanitizeLinks(outputDir)`
**Then**：
- 扫描所有 `.md` 文件
- 将 `file:///absolute/path/to/project/` 前缀替换为 `/`（项目根相对路径）
- 返回修复的链接数量

### FP-002: 源文件索引构建

**Given** wiki/ 目录下的 `.md` 文件中包含溯源链接
**When** 调用 `buildDocIndex(outputDir)`
**Then**：
- 解析所有 `.md` 中 `[Source: ...](path#L...)` 和 `Sources: [file](path)` 格式的链接
- 构建 `source-files-index.json`，结构为：
  ```json
  {
    "sourceToDocs": { "src/core/index.ts": ["wiki/architecture/core.md"] },
    "docToSources": { "wiki/architecture/core.md": ["src/core/index.ts"] }
  }
  ```
- 保存到 wiki/ 目录下

### FP-003: 侧边栏生成

**Given** wiki.json 的 pages 数组
**When** 调用 `generateSidebar(outputDir, pages)`
**Then**：
- 按 section 分组
- section 内按 group 分组（如无 group 则直接列出）
- 生成 `_sidebar.md`，格式：
  ```markdown
  - **Architecture**
    - [Core Engine](architecture/core.md)
    - [Module System](architecture/modules.md)
  - **Getting Started**
    - [Quick Start](getting-started/quick-start.md)
  ```
- 保存到 wiki/ 目录下

### FP-004: 收尾集成

**Given** `generateWikiContent` 完成所有页面生成
**When** `Promise.all(tasks)` 之后
**Then**：
- 调用 `finalizeWiki(wikiDir, options)` 执行所有收尾步骤
- 如 `options.audit === true`，执行质量审计并日志输出结果
- `WikiResult` 中可选包含 `finalizeResult` 和 `auditReport`

### FP-005: 收尾错误隔离

**Given** 收尾步骤中某个子步骤失败
**When** 执行 finalizeWiki
**Then**：
- 单个步骤失败不影响其他步骤
- 失败步骤的错误记录在 `FinalizeResult` 中
- 日志输出警告但不中断主流程
