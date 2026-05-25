# Spec: 文档质量审计层

## 概述

新增质量审计模块，统计文档的图表/示例/溯源完整性，按模块复杂度分级评分。

## 需求

### QA-001: 单文档指标分析

**Given** 一个已生成的 `.md` 文件
**When** 调用 `analyzeDoc(filePath)`
**Then** 返回 `DocMetrics`，包含：
- `lineCount`: 文档总行数
- `diagramCount`: Mermaid 图数量
- `diagramTypes`: 图表类型列表（flowchart, sequenceDiagram, stateDiagram-v2, erDiagram）
- `codeBlockCount`: 代码块数量
- `sourceLinkCount`: `Sources:` 和 `[Source:` 格式的溯源链接总数
- `codeBlockSourceLinks`: 代码块上方溯源行数量
- `emptySections`: 空章节标题列表（标题后紧跟下一个标题或文件结束）
- `secretLeaks`: 复用 `scanSecrets` 的密钥检测结果
- `mermaidIssues`: 复用 `validateMermaidBlocks` 的 Mermaid 语法检测结果

### QA-002: Wiki 全局审计

**Given** wiki/ 输出目录
**When** 调用 `analyzeWiki(wikiPath, pages?)`
**Then**：
- 递归扫描所有 `.md` 文件
- 对每个文件调用 `analyzeDoc`
- 汇总为 `QualityReport`，含 professional/standard/basic 计数和全局摘要

### QA-003: 复杂度自适应评分

**Given** 单文档指标和对应 WikiPage 信息
**When** 调用 `scoreByComplexity(metrics, page?)`
**Then**：
- 按 6 维度评分（图表数量/类型、代码示例、溯源覆盖、安全性、Mermaid 质量）
- 每维度 1-3 分（professional=3, standard=2, basic=1）
- core 模块（Advanced / ≥5 files）：总分 ≥ 12 → professional, ≥ 8 → standard, 其他 → basic
- simple 模块（Beginner / ≤2 files）：总分 ≥ 6 → professional, ≥ 4 → standard, 其他 → basic
- standard 模块：总分 ≥ 9 → professional, ≥ 6 → standard, 其他 → basic

### QA-004: 审计报告输出

**Given** QualityReport 已生成
**When** 日志输出审计结果
**Then** 显示：`professional/N` 的比例和关键问题摘要

## 评分矩阵

| 维度 | 3pt (professional) | 2pt (standard) | 1pt (basic) |
|------|---|---|---|
| 图表数 | ≥ 2 且 ≥ 2 种类型 | ≥ 1 | 0 |
| 代码示例 | ≥ 5 | ≥ 2 | ≥ 1 |
| 溯源覆盖 | 每章 + 每代码块 | 每章 | 部分有 |
| 安全性 | 0 leaks | 0 leaks | 0 leaks |
| Mermaid | 0 errors | ≤ 1 warn | 有 errors |
| 文档长度 | ≥ 目标行数 | ≥ 50% 目标 | < 50% 目标 |
