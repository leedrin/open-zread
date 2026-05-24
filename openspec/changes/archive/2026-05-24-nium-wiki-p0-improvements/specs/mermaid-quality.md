# Spec: Mermaid 图质量体系

## 概述

将 Page Agent 的 Mermaid 图生成从「自由发挥」升级为「规则驱动」，包括类型映射、复杂度自适应分组和语法校验。

## 需求

### MQ-001: Prompt 内置图表类型映射

**Given** Page Agent 生成包含架构/流程/依赖描述的文档  
**When** 选择 Mermaid 图表类型  
**Then** 遵循以下映射：

| 内容 | 图表 | 方向 |
|------|------|------|
| 系统架构/分层 | flowchart | TB |
| 请求/数据流 | sequenceDiagram | — |
| 状态/生命周期 | stateDiagram-v2 | — |
| 模块依赖/类型关系 | flowchart | LR |
| 数据模型 | erDiagram | — |

### MQ-002: 复杂度自适应分组

**Given** 图表节点数确定  
**When** 生成 Mermaid 代码  
**Then**：
- ≤ 6 节点 → 线形排列
- 7-12 节点 → subgraph 分组
- 13-20 节点 → 拆分为概览 + 细节两个图
- > 20 节点 → 拆分为多个独立图

### MQ-003: 语法安全规则

**Given** 生成 Mermaid 代码  
**When** 编写节点 ID 和标签  
**Then**：
- subgraph ID 不与任何 node ID 重复
- 标签中的双引号使用 `&quot;` 转义
- 节点 ID 不使用 Mermaid 保留关键字（class / graph / subgraph / end / style / state / note）

### MQ-004: Mermaid 语法校验器

**Given** 已生成的 `.md` 文件  
**When** 运行 `validateMermaidBlocks(content)`  
**Then** 返回 `MermaidIssue[]`，每个 issue 含：
- `severity`: `'warn'` | `'error'`
- `line`: 错误所在行号
- `message`: 错误描述
- `suggestion`: 修复建议

**校验规则**：
- subgraph ID 与 node ID 冲突 → error
- 标签内未转义双引号 → error
- 保留字作为 ID → warn
- 节点数超过 20 → warn

### MQ-005: 图表溯源

**Given** 文档中嵌入了 Mermaid 图  
**When** 图的内容基于特定源文件  
**Then** 图下方应包含 `**Diagram sources**` 标注源文件路径。

### MQ-006: 图表数量要求

**Given** 文档难度等级为 Advanced 或 associatedFiles ≥ 5  
**When** 生成文档  
**Then** 至少包含 2 个不同类型的 Mermaid 图。

**Given** 文档难度等级为 Beginner 且 associatedFiles ≤ 2  
**When** 生成文档  
**Then** 至少包含 1 个 Mermaid 图。
