# Tasks: nium-wiki P1 改进集成

## Task 1: 溯源增强 — Prompt 修改

**需求覆盖**：TR-001, TR-002, TR-003

- 在 `packages/orchestrator/src/prompts/page-agent.ts` 的 `## 🔍 绝对纪律：精准溯源` 段落中增加代码块溯源规则
- 包含：代码块上方溯源行格式、位置约束（必须在代码块外面）、正确/错误示例
- 不删除现有章节级溯源规则
- **验收**：阅读 `page-agent.ts`，确认代码块溯源规则段存在且格式正确

## Task 2: PageFacts 类型定义

**需求覆盖**：FF-001

- 新增 `packages/types/src/facts.ts`
- 定义 `ExportFact`, `FileSummary`, `PageFacts` 接口
- 在 `packages/types/src/index.ts` 中新增导出
- **验收**：`bun run typecheck` 通过，类型可被其他包导入

## Task 3: Facts 提取器

**需求覆盖**：FF-002

- 新增 `packages/repo-analyzer/src/repo-map/module-facts.ts`
- 实现 `extractPageFacts(page: WikiPage, symbols: SymbolManifest): PageFacts`
- 从 `packages/repo-analyzer/src/repo-map/index.ts` 导出
- 按 associatedFiles 过滤、汇总 exports、区分 internal/external deps、计算 confidence
- **验收**：构造 mock WikiPage + SymbolManifest，验证输出 PageFacts 字段正确

## Task 4: Facts 注入 Prompt + 管线传递

**需求覆盖**：FF-003, FF-004, FF-005

- 修改 `packages/orchestrator/src/wiki/generate-wiki.ts`
- 扩展 `buildPagePrompt(page, facts?)` 签名，当 facts 存在时注入 Facts 段落
- 扩展 `GenerateWikiOptions` 增加 `symbols?: SymbolManifest` 参数
- 在 page 循环中调用 `extractPageFacts` 并传入 `buildPagePrompt`
- 不传 symbols 时降级为无 Facts 模式（向后兼容）
- **验收**：
  - 传入 symbols + page 有 associatedFiles → Prompt 包含 Facts 段落
  - 不传 symbols → Prompt 无 Facts 段落，行为与 P0 一致
  - `bun run typecheck` 通过

## Task 5: 质量审计模块

**需求覆盖**：QA-001, QA-002, QA-003, QA-004

- 新增 `packages/utils/src/output/quality-audit.ts`
- 实现 `analyzeDoc(filePath): DocMetrics`
- 实现 `analyzeWiki(wikiPath, pages?): QualityReport`
- 实现 `scoreByComplexity(metrics, page?): { level, score }`
- 复用 `scanSecrets`（密钥检测）和 `validateMermaidBlocks`（Mermaid 校验）
- 在 `packages/utils/src/index.ts` 中新增导出
- **验收**：
  - 传入含 Mermaid 图 + 代码块的 .md → 正确统计各项指标
  - 空文档 → 全部为 0
  - 评分逻辑覆盖 core/standard/simple 三种场景

## Task 6: 收尾管道

**需求覆盖**：FP-001, FP-002, FP-003, FP-005

- 新增 `packages/utils/src/output/finalize.ts`
- 实现 `sanitizeLinks(outputDir): Promise<number>`
- 实现 `buildDocIndex(outputDir): Promise<void>`
- 实现 `generateSidebar(outputDir, pages): Promise<void>`
- 实现 `finalizeWiki(wikiPath, options?): Promise<FinalizeResult>`
- 在 `packages/utils/src/index.ts` 中新增导出
- **验收**：
  - 含 `file:///` 路径的 .md → 修复为相对路径
  - 含 Source 链接的 .md → 生成 source-files-index.json
  - 传入 pages 数组 → 生成 _sidebar.md
  - 单步骤失败不影响其他步骤

## Task 7: 收尾管道集成到 generateWikiContent

**需求覆盖**：FP-004

- 修改 `packages/orchestrator/src/wiki/generate-wiki.ts`
- 在 `Promise.all(tasks)` 之后调用 `finalizeWiki`
- 可选执行 `analyzeWiki` 质量审计
- 日志输出审计摘要
- **验收**：生成完成后日志输出收尾结果和审计摘要

## Task 8: 集成验证

- 所有改动通过 `bun run typecheck` 和 `bun run lint`
- **验收**：两项命令均退出码为 0
