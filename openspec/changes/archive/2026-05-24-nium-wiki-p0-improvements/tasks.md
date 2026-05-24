# Tasks: nium-wiki P0 改进集成

## Task 1: Mermaid 规则注入 Page Agent Prompt

**需求覆盖**：MQ-001, MQ-002, MQ-003, MQ-005, MQ-006

- 在 `page-agent.ts` 的「架构设计与模块划分」段落后插入 Mermaid 规范块
- 包含：图表类型映射表（5 种类型 × 场景）、复杂度分组策略（4 级）、语法安全规则（3 条硬规则、3 条建议）
- 包含：图表溯源要求（`**Diagram sources**`）
- 包含：按级别的最少图表数量要求
- **验收**：阅读 `page-agent.ts`，确认 Mermaid 规范块存在且内容完整

## Task 2: Mermaid 语法校验器

**需求覆盖**：MQ-004

- 新增 `packages/repo-analyzer/src/repo-map/mermaid-validator.ts`
- 导出 `validateMermaidBlocks(mdContent: string): MermaidIssue[]`
- 实现：提取 \`\`\`mermaid 代码块 → 逐行检查 4 条规则
- 输出 `MermaidIssue` 接口（severity / line / message / suggestion）
- 从 `packages/repo-analyzer/src/repo-map/index.ts` 导出
- **验收**：编写单元测试，输入含错误的 mermaid 块，验证返回正确的 issue 列表

## Task 3: 复杂度自适应质量目标

**需求覆盖**：QT-001, QT-002, QT-003, QT-004

- 在 `packages/orchestrator/src/wiki/generate-wiki.ts` 中新增 `getQualityTargets(page: WikiPage)` 函数
- 实现 3 级分类算法（core / standard / simple）
- 返回包含 minLines / minDiagrams / minDiagramTypes / minExamples 的目标对象
- 修改 `buildPagePrompt` 函数，在系统 Prompt 后注入 `## 🎯 本文档质量目标` 表格
- 处理缺失 `level` 或 `associatedFiles` 的降级逻辑
- **验收**：构造不同 level 的 page 对象，验证返回的目标值符合规格

## Task 4: 密钥脱敏 Prompt 规则

**需求覆盖**：SS-001

- 在 `page-agent.ts` 中增加「密钥与凭证脱敏」段
- 包含 6 种脱敏模式的替换表
- 包含脱敏不影响结构的约束说明
- **验收**：阅读 `page-agent.ts`，确认脱敏规则段存在且模式覆盖完整

## Task 5: 密钥审计扫描器

**需求覆盖**：SS-002, SS-003, SS-004, SS-005

- 在 `packages/utils/src/output/` 下新增密钥扫描功能
- 可独立于完整审计模块，或作为 `audit-docs.ts` 的第一个子功能
- 实现 3 组正则扫描
- 跳过 Mermaid 代码块
- 输出含文件路径、行号、脱敏文本、严重级别的结果
- **验收**：创建含 fake key 的 markdown 测试文件，验证扫描检测到且 Mermaid 块被跳过
