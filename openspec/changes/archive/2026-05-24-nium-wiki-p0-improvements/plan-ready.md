# Implementation Plan: nium-wiki P0 改进集成

## Source

- Proposal: openspec/changes/nium-wiki-p0-improvements/proposal.md
- Design: openspec/changes/nium-wiki-p0-improvements/design.md
- Specs: openspec/changes/nium-wiki-p0-improvements/specs/
- Tasks: openspec/changes/nium-wiki-p0-improvements/tasks.md

## Execution Order

### Task 1: 增强 page-agent.ts — 注入 Mermaid 质量规范 + 密钥脱敏规则

- **Goal**: `page-agent.ts` Prompt 包含完整的 Mermaid 规范块和密钥脱敏规则块
- **Source tasks**: Task 1, Task 4
- **Design anchors**: design.md §1.1, §3.3
- **Changed files**:
  - `packages/orchestrator/src/prompts/page-agent.ts`
- **Validation**:
  - 阅读 `page-agent.ts`，确认以下 3 个新块存在且内容完整：
    1. `## 📊 Mermaid 图表规范（强制）` — 含类型映射表、分组策略、语法安全规则、溯源要求、数量要求
    2. `## 🔴 密钥与凭证脱敏（强制）` — 含 6 种脱敏替换表
    3. `## 🎯 本文档质量目标` 注入点（在 Task 3 完成注入后验证）
- **Depends on**: none
- **Notes**:
  - Mermaid 规则块插入位置：「架构设计与模块划分」段落之后
  - 密钥脱敏规则插入位置：代码示例规范之前
  - 质量目标占位留给 Task 3 动态注入，此处不需要硬编码
  - 参考 nium-wiki SKILL.md 的 Diagram Requirements 和 Secret Sanitization 段落的措辞

### Task 2: 新增 mermaid-validator.ts

- **Goal**: 可独立调用的 Mermaid 语法校验函数，覆盖 4 条核心规则
- **Source tasks**: Task 2
- **Design anchors**: design.md §1.2
- **Changed files**:
  - `packages/repo-analyzer/src/repo-map/mermaid-validator.ts`（新建）
  - `packages/repo-analyzer/src/repo-map/index.ts`（新增导出）
- **Validation**:
  ```bash
  cd packages/repo-analyzer && bun test -- mermaid-validator
  ```
  验证以下场景：
  1. 空文档 → 返回空数组
  2. subgraph ID 与 node ID 冲突 → 返回 1 个 error
  3. 标签未转义双引号 → 返回 1 个 error
  4. 保留字作为 ID → 返回 1 个 warn
  5. 节点数超过 20 → 返回 1 个 warn
  6. 混合错误 → 返回正确数量的 error + warn
  7. 普通文本（非 mermaid 块）→ 跳过
- **Depends on**: none（可并行于 Task 1）
- **Notes**:
  - 纯正则实现，不依赖 mermaid 解析库
  - 接口签名参考 design.md §1.2
  - 导出路径：`export { validateMermaidBlocks } from './mermaid-validator'`
  - 从现有 `packages/repo-analyzer/src/repo-map/index.ts` 的 export 段添加

### Task 3: 实现 getQualityTargets 并集成到 buildPagePrompt

- **Goal**: Page Agent 接收到的 Prompt 包含根据页面复杂度动态计算的质量目标表格
- **Source tasks**: Task 3
- **Design anchors**: design.md §2.1, §2.2, §2.3
- **Changed files**:
  - `packages/orchestrator/src/wiki/generate-wiki.ts`
- **Validation**:
  ```bash
  cd packages/orchestrator && bun test -- generate-wiki
  ```
  验证以下场景：
  1. `level='Advanced'`, `associatedFiles=6` → core（400+/2+/2/5+）
  2. `level='Advanced'`, `associatedFiles=1` → core（level 优先）
  3. `level='Beginner'`, `associatedFiles=1` → simple（80+/1/1/1）
  4. `level='Intermediate'`, `associatedFiles=3` → standard（200+/1+/1/2+）
  5. 缺失 `level` 字段 → 降级 standard
  6. 缺失 `associatedFiles` → length 视为 0
  7. 生成的 Prompt 中包含 `## 🎯 本文档质量目标` 表格
  8. 表格位置在系统 Prompt 之后、页面任务信息之前
- **Depends on**: none（可并行于 Task 1、Task 2）
- **Notes**:
  - 新增函数 `getQualityTargets(page: WikiPage): QualityTargets`，放在 `buildPagePrompt` 上方
  - `QualityTargets` 接口含 `{ minLines, minDiagrams, minDiagramTypes, minExamples }`
  - 修改 `buildPagePrompt` 在 return 的模板字符串中插入质量目标段
  - 不要改动 `generate-wiki.ts` 中的并发控制和其他逻辑

### Task 4: 新增密钥扫描功能（审计模块首个子功能）

- **Goal**: 提供 `scanSecrets(mdContent: string): SecretLeak[]` 函数和一个简单的扫描 wiki/ 目录的入口
- **Source tasks**: Task 5
- **Design anchors**: design.md §3.1, §3.2
- **Changed files**:
  - `packages/utils/src/output/audit-docs.ts`（新建）
  - `packages/utils/src/index.ts`（新增导出）
- **Validation**:
  ```bash
  cd packages/utils && bun test -- audit-docs
  ```
  验证以下场景：
  1. 含 `sk_live_abc123def456` 的 markdown → 检测到
  2. 含 `password: "mysecret123"` 的 markdown → 检测到
  3. 含 `TOKEN=<your-token-here>` 的已脱敏内容 → 不误报（占位符不匹配原始模式）
  4. \`\`\`mermaid 代码块内的 `sk-*` → 跳过
  5. 普通代码块内的 `sk-*` → 检测到
  6. 空文档 → 返回空数组
- **Depends on**: none（可并行于所有其他任务）
- **Notes**:
  - 正则模式参考 design.md §3.1
  - `SecretLeak` 接口：`{ filePath, line, matchedText (前4字符+***), severity: 'error' }`
  - 导出函数：`scanSecrets` 和 `scanWikiForSecrets(wikiPath: string)`
  - 这是完整审计模块的种子文件，后续 P1 改进将扩展此文件

### Task 5: 集成验证 — 类型检查 + lint

- **Goal**: 所有改动通过 TypeScript 类型检查和 ESLint
- **Source tasks**: 全部
- **Design anchors**: n/a
- **Changed files**: n/a（验证步骤）
- **Validation**:
  ```bash
  bun run typecheck
  bun run lint
  ```
  两项命令均退出码为 0
- **Depends on**: Task 1, Task 2, Task 3, Task 4
- **Notes**:
  - 如有 lint 错误优先使用 `bun run lint:fix`
  - 确认所有新增文件被正确导出（`index.ts` 中的 re-export）
