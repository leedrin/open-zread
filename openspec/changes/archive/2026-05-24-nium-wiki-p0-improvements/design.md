# Design: nium-wiki P0 改进集成

## 决策概览

| 决策 | 选择 | 理由 |
|------|------|------|
| Mermaid 规则注入位置 | `page-agent.ts` Prompt 内联 | 无需新增工具，对 Agent 透明 |
| Mermaid 语法校验实现 | 新增独立模块 `repo-analyzer` | 纯 Node.js 实现，零依赖 |
| 质量目标分级依据 | wiki.json `level` 字段 + `associatedFiles` 数量 | Catalog 阶段已有足够信息 |
| 密钥检测时机 | Prompt 约束（生成时） + 审计模块（生成后） | 双保险 |

## 架构影响

所有改动限定在现有包内，不引入新包依赖：

```
packages/orchestrator/src/prompts/page-agent.ts   ← Prompt 增强（3 处）
packages/repo-analyzer/src/repo-map/              ← 新增 mermaid-validator.ts
packages/utils/src/output/                        ← 新增 audit-docs.ts（含密钥检测）
```

## 1. Mermaid 图质量体系

### 1.1 Prompt 增强

在 `page-agent.ts` 的「架构设计与模块划分」段落后插入 Mermaid 规则块：

```markdown
## 📊 Mermaid 图表规范（强制）

### 图表类型选择

| 内容类型 | 使用图表 | 条件 |
|----------|----------|------|
| 系统架构 / 模块分层 | flowchart TB + subgraph | 始终 |
| 请求 / 数据流 | sequenceDiagram | 始终 |
| 生命周期 / 状态转换 | stateDiagram-v2 | 仅状态化模块 |
| 模块依赖 / 类型关系 | flowchart LR | 始终 |
| 数据模型 / ORM | erDiagram | 项目有 DB/ORM 时 |

### 复杂度分组策略

| 节点数 | 策略 |
|--------|------|
| ≤ 6 | 线形排列 |
| 7-12 | subgraph 分组，每组 2-4 节点 |
| 13-20 | 分层抽象（概览图 + 细节图） |
| > 20 | 拆分为多个独立图 |

### 语法安全规则

| 规则 | 错误 | 正确 |
|------|------|------|
| subgraph ID ≠ 节点 ID | subgraph CLI[...] CLI[...] | subgraph CL[...] CLI[...] |
| 标签中双引号转义 | A[Config "x"] | A[Config &quot;x&quot;] |
| ID 不用保留字 | class[class] | NodeClass[class] |
```

### 1.2 Mermaid 语法校验器

新增 `packages/repo-analyzer/src/repo-map/mermaid-validator.ts`：

```typescript
export interface MermaidIssue {
  severity: 'warn' | 'error';
  line: number;
  message: string;
  suggestion: string;
}

export function validateMermaidBlocks(mdContent: string): MermaidIssue[]
```

实现策略：
- 从 markdown 中提取 ````mermaid` 代码块
- 按行逐行检查语法规则（不引入 mermaid 解析库，避免重依赖）
- 检测：subgraph/节点 ID 冲突、未转义引号、保留字 ID、节点数超阈值

## 2. 复杂度自适应质量目标

### 2.1 分级规则

| 条件 | 分类 |
|------|------|
| `level === 'Advanced'` 或 `associatedFiles.length >= 5` | core |
| `level === 'Beginner'` 且 `associatedFiles.length <= 2` | simple |
| 其他 | standard |

### 2.2 质量目标表

| 分类 | 行数 | 图数 | 图类型 | 示例数 |
|------|------|------|--------|--------|
| core | 400+ | 2+ | 2 种不同 | 5+ |
| standard | 200+ | 1+ | 1 种 | 2+ |
| simple | 80+ | 1 | 1 种 | 1 |

### 2.3 实现位置

`packages/orchestrator/src/wiki/generate-wiki.ts` 中的 `buildPagePrompt` 函数，在构造每页 Prompt 时根据 `page.level` 和 `page.associatedFiles` 动态注入 `## 🎯 本文档质量目标`。

## 3. 密钥自动脱敏

### 3.1 检测模式

```typescript
const SECRET_PATTERNS = [
  /(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{10,}/g,
  /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
];
```

### 3.2 脱敏替换

| 检测类型 | 替换模板 |
|----------|----------|
| API Key 前缀 | `sk_live_XXXXXXXX`, `pk_test_XXXXXXXX` |
| 密码 | `***REDACTED***` |
| Token | `<your-token-here>` |
| 通用 | `<sensitive-data>` |

### 3.3 两级防护

1. **Prompt 级**：在 `page-agent.ts` 中增加脱敏规则段，AI 生成时主动脱敏
2. **审计级**：在 `audit-docs.ts` 中扫描已生成的 `.md` 文件，检测遗漏的密钥并报告

## 约束

- 不引入新的 npm 依赖（Mermaid 校验用纯文本正则）
- 不改动 Agent SDK 核心（工具定义不变）
- 不改动 Catalog 生成流程（wiki.json 结构不变）
- 所有改动向后兼容（Prompt 增强不影响已有生成结果）
