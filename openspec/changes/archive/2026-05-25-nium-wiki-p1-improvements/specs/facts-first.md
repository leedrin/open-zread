# Spec: Facts-First 事实前置提取

## 概述

在 Page Agent 生成文档前，预提取模块的导出符号作为权威数据源注入 Prompt，杜绝 LLM 幻觉。

## 需求

### FF-001: PageFacts 类型定义

**Given** types 包需要定义跨包共享的 Facts 类型
**When** 定义 `PageFacts` 接口
**Then** 包含：`pageSlug`, `exports: ExportFact[]`, `fileSummaries: FileSummary[]`, `internalDeps: string[]`, `externalDeps: string[]`, `confidence: number`

`ExportFact` 含：`name`, `kind`, `signature`, `file`, `line?`
`FileSummary` 含：`file`, `lineCount?`, `symbolCount`, `exports: string[]`

### FF-002: Facts 提取器

**Given** 一个 WikiPage（含 associatedFiles）和 SymbolManifest
**When** 调用 `extractPageFacts(page, symbols)`
**Then**：
- 按 `page.associatedFiles` 过滤 `SymbolManifest.symbols` 中的匹配项
- 汇总所有 `functions` 为 ExportFact 列表（按 name 去重，保留完整 signature）
- 汇总所有 `exports` 到每个 FileSummary
- 从 `imports` 中区分 internalDeps（项目内部路径）和 externalDeps（node_modules/第三方）
- `confidence = matchedSymbolFiles / totalAssociatedFiles`（0~1 范围）

### FF-003: Facts 注入 Prompt

**Given** PageFacts 已提取
**When** 构建 `buildPagePrompt(page, facts)`
**Then**：
- 在 `## 🎯 本文档质量目标` 之前注入 `## 🔴 Facts — 权威数据源` 段落
- 列出所有导出符号（含签名和文件位置）
- 列出关联文件摘要
- 包含 3 条 Facts 规则（以 Facts 为准、不添加不存在的符号、不篡改签名）

### FF-004: Facts 可选降级

**Given** SymbolManifest 不可用或为空
**When** 调用 `buildPagePrompt(page)` 不传 facts
**Then** Prompt 中不包含 Facts 段落，行为与 P0 一致（向后兼容）

### FF-005: 管线传递 SymbolManifest

**Given** `generateWikiContent` 被调用
**When** 传入了 `symbols` 参数（类型 `SymbolManifest`）
**Then** 对每个 page 调用 `extractPageFacts` 并传入 `buildPagePrompt`
**When** 未传入 `symbols`
**Then** 所有 page 以无 Facts 模式生成
