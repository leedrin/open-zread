# Implementation Plan: nium-wiki P1 改进集成

## Source

- Proposal: openspec/changes/nium-wiki-p1-improvements/proposal.md
- Design: openspec/changes/nium-wiki-p1-improvements/design.md
- Specs: openspec/changes/nium-wiki-p1-improvements/specs/
- Tasks: openspec/changes/nium-wiki-p1-improvements/tasks.md

## Execution Order

### Task 1: 溯源增强 — Prompt 修改

- **Goal**: `page-agent.ts` 的溯源段落增加代码块溯源强制规则
- **Source tasks**: Task 1
- **Design anchors**: design.md §2.1, §2.2
- **Changed files**: `packages/orchestrator/src/prompts/page-agent.ts`
- **Validation**: 阅读 `page-agent.ts`，确认 `🔴 **代码块溯源（强制）**` 段存在，含格式示例和约束说明
- **Depends on**: none
- **Notes**: 不删除现有 `Sources:` 章节级溯源规则，在其后追加代码块溯源规则

### Task 2: PageFacts 类型定义

- **Goal**: `@open-zread/types` 包导出 `PageFacts`, `ExportFact`, `FileSummary` 类型
- **Source tasks**: Task 2
- **Design anchors**: design.md §1.1
- **Changed files**:
  - `packages/types/src/facts.ts`（新建）
  - `packages/types/src/index.ts`（新增导出）
- **Validation**: `bun run typecheck` 通过
- **Depends on**: none（可与 Task 1 并行）

### Task 3: Facts 提取器

- **Goal**: `extractPageFacts()` 函数可按 WikiPage 的 associatedFiles 从 SymbolManifest 提取 PageFacts
- **Source tasks**: Task 3
- **Design anchors**: design.md §1.2
- **Changed files**:
  - `packages/repo-analyzer/src/repo-map/module-facts.ts`（新建）
  - `packages/repo-analyzer/src/repo-map/index.ts`（新增导出）
- **Validation**: 构造 mock 数据验证：page 含 2 个 associatedFiles → 提取到对应 exports、fileSummaries、confidence 正确
- **Depends on**: Task 2（需要 PageFacts 类型）

### Task 4: Facts 注入 Prompt + 管线传递

- **Goal**: `buildPagePrompt` 接收可选 PageFacts 并注入到 Prompt；`generateWikiContent` 接收可选 SymbolManifest
- **Source tasks**: Task 4
- **Design anchors**: design.md §1.3
- **Changed files**:
  - `packages/orchestrator/src/wiki/generate-wiki.ts`
  - `packages/orchestrator/src/wiki/types.ts`（GenerateWikiOptions 增加 symbols）
- **Validation**:
  - 传入 facts → Prompt 包含 `## 🔴 Facts — 权威数据源` 段
  - 不传 facts → Prompt 无 Facts 段
  - `bun run typecheck` 通过
- **Depends on**: Task 3（需要 extractPageFacts）

### Task 5: 质量审计模块

- **Goal**: `analyzeDoc`, `analyzeWiki`, `scoreByComplexity` 函数可用
- **Source tasks**: Task 5
- **Design anchors**: design.md §3.1, §3.2, §3.3
- **Changed files**:
  - `packages/utils/src/output/quality-audit.ts`（新建）
  - `packages/utils/src/index.ts`（新增导出）
- **Validation**:
  - 含 Mermaid + 代码块 + Source 链接的 .md → DocMetrics 各字段正确
  - 空文档 → 全部为 0
  - core 模块评分 → professional/standard/basic 阈值正确
- **Depends on**: none（可并行于 Task 1-4，复用已有的 scanSecrets 和 validateMermaidBlocks）

### Task 6: 收尾管道

- **Goal**: `finalizeWiki` 函数执行链接修复 + 索引构建 + 侧边栏生成
- **Source tasks**: Task 6
- **Design anchors**: design.md §4.1, §4.2
- **Changed files**:
  - `packages/utils/src/output/finalize.ts`（新建）
  - `packages/utils/src/index.ts`（新增导出）
- **Validation**:
  - 含 `file:///` 的 .md → 修复为相对路径，返回修复数量
  - 含 Source 链接 → 生成 source-files-index.json
  - 传入 pages → 生成 _sidebar.md
  - 子步骤失败 → 不影响其他步骤
- **Depends on**: Task 5（质量审计模块，finalizeWiki 可选调用 audit）

### Task 7: 收尾管道集成到 generateWikiContent

- **Goal**: `generateWikiContent` 在页面生成完成后自动执行 finalize + audit
- **Source tasks**: Task 7
- **Design anchors**: design.md §4.3
- **Changed files**: `packages/orchestrator/src/wiki/generate-wiki.ts`
- **Validation**: 日志输出包含收尾结果和审计摘要
- **Depends on**: Task 4, Task 6

### Task 8: 集成验证 — typecheck + lint

- **Goal**: 所有改动通过 TypeScript 类型检查和 ESLint
- **Source tasks**: 全部
- **Design anchors**: n/a
- **Changed files**: n/a
- **Validation**: `bun run typecheck` + `bun run lint` 退出码为 0
- **Depends on**: Task 1-7 全部完成
