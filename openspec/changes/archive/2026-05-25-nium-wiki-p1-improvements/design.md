# Design: nium-wiki P1 改进集成

## 决策概览

| 决策 | 选择 | 理由 |
|------|------|------|
| Facts 类型定义位置 | `packages/types/src/facts.ts` | 跨包共享，遵循现有类型组织模式 |
| Facts 提取器位置 | `packages/repo-analyzer/src/repo-map/module-facts.ts` | 复用 SymbolManifest，与 repo-map 同层 |
| Facts 注入方式 | `buildPagePrompt` 签名扩展，接收 `PageFacts` 参数 | 最小侵入，不改 Agent SDK |
| 质量审计位置 | `packages/utils/src/output/quality-audit.ts` | 复用已有 audit-docs.ts 和 mermaid-validator |
| 收尾管道位置 | `packages/utils/src/output/finalize.ts` | 独立模块，被 orchestrator 调用 |
| 收尾触发时机 | `generateWikiContent` 的 `Promise.all(tasks)` 之后 | 全部页面生成完成后统一收尾 |

## 架构影响

```
packages/types/src/facts.ts                              ← 新增 PageFacts 类型
packages/types/src/index.ts                              ← 新增导出
packages/repo-analyzer/src/repo-map/module-facts.ts      ← 新增提取器
packages/repo-analyzer/src/repo-map/index.ts             ← 新增导出
packages/orchestrator/src/prompts/page-agent.ts          ← 溯源增强
packages/orchestrator/src/wiki/generate-wiki.ts          ← Facts 注入 + finalize 调用
packages/utils/src/output/quality-audit.ts               ← 新增审计模块
packages/utils/src/output/finalize.ts                    ← 新增收尾管道
packages/utils/src/output/audit-docs.ts                  ← 扩展（质量审计复用密钥扫描）
packages/utils/src/index.ts                              ← 新增导出
```

## 1. Facts-First 事实前置提取

### 1.1 类型定义

新增 `packages/types/src/facts.ts`：

```typescript
export interface ExportFact {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'unknown';
  signature: string;
  file: string;
  line?: number;
}

export interface FileSummary {
  file: string;
  lineCount?: number;
  symbolCount: number;
  exports: string[];
}

export interface PageFacts {
  pageSlug: string;
  exports: ExportFact[];
  fileSummaries: FileSummary[];
  internalDeps: string[];
  externalDeps: string[];
  confidence: number;
}
```

### 1.2 Facts 提取器

新增 `packages/repo-analyzer/src/repo-map/module-facts.ts`：

```typescript
export function extractPageFacts(page: WikiPage, symbols: SymbolManifest): PageFacts
```

实现策略：
- 按 `page.associatedFiles` 过滤 `SymbolManifest.symbols`
- 汇总所有 `exports`（按 functions 的 name + signature 去重）
- 从 `imports` 收集 internalDeps（项目内部）和 externalDeps（node_modules）
- `confidence = matchedFiles / totalAssociatedFiles`（0~1）

### 1.3 管线集成

修改 `packages/orchestrator/src/wiki/generate-wiki.ts`：

1. `generateWikiContent` 接收 `SymbolManifest` 参数（可选）
2. 在 `pages.map` 循环中，对每个 page 调用 `extractPageFacts(page, symbols)` 获取 facts
3. `buildPagePrompt` 签名扩展为 `buildPagePrompt(page: WikiPage, facts?: PageFacts): string`
4. 当 facts 存在时，在质量目标表格之前注入 Facts 段落

Facts 注入格式：

```markdown
## 🔴 Facts — 权威数据源（API 签名必须以这里为准）

**导出符号** (共 N 个):
- `export function analyzeProject(...)` → src/core/analyzeProject.ts#L123
- ...

**关联文件摘要**:
- src/core/index.ts (N 个符号, 导出: [...])

## ⚠️ Facts 规则
1. 所有 API 描述必须以上述符号列表为准
2. 如果某个符号在 Facts 中不存在，不要添加到文档中
3. 如果 Facts 中有某个符号但不理解，可以忽略但不要篡改其签名
```

## 2. 溯源增强

### 2.1 Prompt 修改

在 `page-agent.ts` 的 `## 🔍 绝对纪律：精准溯源` 段落中增加代码块溯源规则：

```markdown
🔴 **代码块溯源（强制）**
任何从源文件摘抄的代码块，必须在 ``` 上方添加溯源行：

[Source: foo.ts](/packages/core/src/foo.ts#L42-L67)
\`\`\`typescript
const result = foo.bar();
\`\`\`

⚠️ 溯源行必须在代码块**外面**（纯文本），不要在代码块内部用注释！
❌ 错误：\`\`\`typescript\n// Source: foo.ts\n...
✅ 正确：[Source: foo.ts](/...)\n\`\`\`typescript\n...
```

## 3. 文档质量审计层

### 3.1 质量指标

新增 `packages/utils/src/output/quality-audit.ts`：

```typescript
export interface DocMetrics {
  filePath: string;
  lineCount: number;
  diagramCount: number;
  diagramTypes: string[];
  codeBlockCount: number;
  sourceLinkCount: number;
  codeBlockSourceLinks: number;
  emptySections: string[];
  secretLeaks: SecretLeak[];
  mermaidIssues: MermaidIssue[];
}

export type QualityLevel = 'professional' | 'standard' | 'basic';

export interface QualityReport {
  totalDocs: number;
  professionalCount: number;
  standardCount: number;
  basicCount: number;
  docs: Array<{
    filePath: string;
    metrics: DocMetrics;
    level: QualityLevel;
    score: number;
  }>;
  summary: {
    totalDiagrams: number;
    totalCodeBlocks: number;
    totalSourceLinks: number;
    totalSecretLeaks: number;
    totalMermaidIssues: number;
  };
}
```

### 3.2 审计函数

```typescript
export function analyzeDoc(filePath: string): DocMetrics
export function analyzeWiki(wikiPath: string, pages?: WikiPage[]): QualityReport
export function scoreByComplexity(metrics: DocMetrics, page?: WikiPage): { level: QualityLevel; score: number }
```

实现策略：
- `analyzeDoc`：解析单个 .md 文件，统计图表、代码块、溯源链接、空章节，复用 `scanSecrets` 和 `validateMermaidBlocks`
- `analyzeWiki`：递归扫描 wiki/ 目录，汇总所有文档指标
- `scoreByComplexity`：按 page.level 计算质量等级（professional = 3pt, standard = 2pt, basic = 1pt）

### 3.3 评分规则

| 指标 | professional (3pt) | standard (2pt) | basic (1pt) |
|------|---|---|---|
| 图表数 | ≥ 2 且 ≥ 2 种类型 | ≥ 1 | 0 |
| 代码示例 | ≥ 5 | ≥ 2 | ≥ 1 |
| 溯源覆盖 | 每章 + 每代码块 | 每章 | 部分 |
| 安全 | 0 leaks | 0 leaks | 0 leaks |
| Mermaid | 0 errors | ≤ 1 warn | 有 errors |

对 core 模块（Advanced / ≥5 files）：总分 ≥ 12 → professional, ≥ 8 → standard
对 simple 模块（Beginner / ≤2 files）：总分 ≥ 6 → professional, ≥ 4 → standard

## 4. 生成后收尾管道

### 4.1 收尾函数

新增 `packages/utils/src/output/finalize.ts`：

```typescript
export interface FinalizeOptions {
  audit?: boolean;
  wikiPath?: string;
}

export interface FinalizeResult {
  linksSanitized: number;
  docIndexBuilt: boolean;
  sidebarGenerated: boolean;
  auditReport?: QualityReport;
}

export async function finalizeWiki(wikiPath: string, options?: FinalizeOptions): Promise<FinalizeResult>
```

### 4.2 收尾步骤

1. **`sanitizeLinks(outputDir)`** — 扫描所有 .md 文件中的 `file:///` 绝对路径，替换为相对路径
2. **`buildDocIndex(outputDir)`** — 解析所有 .md 中的 `[Source: ...](...)` 和 `Sources:` 链接，构建 `source-files-index.json`（源文件 → 文档的双向映射）
3. **`generateSidebar(outputDir, pages)`** — 从 wiki.json 的 pages 生成 `_sidebar.md`（按 section/group 层级组织）

### 4.3 集成点

在 `packages/orchestrator/src/wiki/generate-wiki.ts` 的 `Promise.all(tasks)` 之后调用：

```typescript
const wikiDir = getWikiDir();
const finalizeResult = await finalizeWiki(wikiDir, { audit: true });
if (finalizeResult.auditReport) {
  logger.info(`质量审计: ${finalizeResult.auditReport.professionalCount}/${finalizeResult.auditReport.totalDocs} professional`);
}
```

## 约束

- 不引入新的 npm 依赖
- 不改动 Agent SDK 核心工具定义
- 不改动 Catalog 生成流程
- Facts 注入为可选：当 SymbolManifest 不可用时降级为无 Facts 模式
- 所有改动向后兼容
