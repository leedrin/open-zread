# Spec: 密钥自动脱敏

## 概述

防止生成的文档代码示例中包含硬编码的 API Key、密码、Token 等敏感信息。通过 Prompt 约束（生成时）和审计扫描（生成后）双重保障。

## 需求

### SS-001: Prompt 脱敏规则

**Given** Page Agent 正在生成包含代码示例的文档  
**When** 代码中存在硬编码密钥/密码/Token  
**Then** Agent 应使用脱敏占位符替换：

| 原始模式 | 替换为 |
|----------|--------|
| `sk_live_*` / `sk-*` | `sk_live_XXXXXXXX` |
| `pk_test_*` / `pk-*` | `pk_test_XXXXXXXX` |
| `ghp_*` / `gho_*` / `ghu_*` | `ghp_XXXXXXXX` |
| `password: "xxx"` | `password: "***REDACTED***"` |
| `TOKEN=xxx` | `TOKEN=<your-token-here>` |
| 其他 8+ 字符密钥字符串 | `<sensitive-data>` |

### SS-002: 审计扫描

**Given** 已生成的 wiki/ 目录  
**When** 运行密钥审计函数  
**Then** 使用以下正则扫描所有 `.md` 文件：

```
/(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{10,}/g
/(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/gi
/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi
```

### SS-003: 审计结果

**Given** 密钥扫描完成  
**When** 输出审计结果  
**Then** 每个泄漏应包含：
- 文件路径
- 行号
- 匹配的文本（脱敏显示前 4 字符 + `***`）
- 严重级别：`error`

### SS-004: Mermaid 图例外

**Given** Mermaid 代码块内容  
**When** 扫描密钥  
**Then** 跳过 Mermaid 代码块内部的检测（Mermaid 不会包含真实密钥，且误报率高）。

### SS-005: 脱敏不影响结构

**Given** 脱敏替换应用于代码块  
**When** 替换敏感值  
**Then** 保持代码块语法结构不变：
- 不删除代码块
- 不修改 Markdown 语法
- 仅替换字符串值，保持引号/赋值符号不变
