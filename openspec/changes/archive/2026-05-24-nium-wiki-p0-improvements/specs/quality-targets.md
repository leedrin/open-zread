# Spec: 复杂度自适应质量目标

## 概述

根据 wiki.json 中的 `level` 和 `associatedFiles` 字段，动态为每个 Page Agent 设置质量目标，避免简单模块过度生成、核心模块深度不足。

## 需求

### QT-001: 模块分级

**Given** wiki.json 中一个 page 对象的 `level` 和 `associatedFiles` 字段  
**When** 构建该页面的 Prompt  
**Then** 按以下规则分为三级：

| 分类 | 条件 |
|------|------|
| core | `level === 'Advanced'` 或 `associatedFiles.length >= 5` |
| simple | `level === 'Beginner'` 且 `associatedFiles.length <= 2` |
| standard | 其他所有情况 |

### QT-002: 分级质量目标

**Given** 模块已被分为 core / standard / simple  
**When** 注入质量目标到 Prompt  
**Then** 应包含以下指标：

| 分类 | 推荐行数 | 图表数 | 图类型 | 示例数 |
|------|----------|--------|--------|--------|
| core | 400+ | 2+ | 2 种不同 | 5+ |
| standard | 200+ | 1+ | 1 种 | 2+ |
| simple | 80+ | 1 | 1 种 | 1 |

### QT-003: 目标注入位置

**Given** `buildPagePrompt` 函数正在构造 Per-page Prompt  
**When** 拼接 Prompt 字符串  
**Then** 在系统 Prompt 之后、页面任务信息之前插入 `## 🎯 本文档质量目标` 表格。

### QT-004: 向后兼容

**Given** wiki.json 中没有 `level` 字段的旧 page  
**When** 计算质量目标  
**Then** 降级为 standard 分类。

**Given** wiki.json 中没有 `associatedFiles` 的旧 page  
**When** 计算质量目标  
**Then** 默认 `associatedFiles.length` 为 0。
