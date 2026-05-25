# Build Plan: nium-wiki-p1-improvements

> Generated from `openspec/changes/nium-wiki-p1-improvements/plan-ready.md`
> Do not reinterpret requirements or change technical decisions from design.md.

## Phase 1: 独立模块（Tasks 1, 2, 5 — 可并行）

---

### [x] 1.1 溯源增强 — page-agent.ts Prompt 修改

**Goal**: `page-agent.ts` 的溯源段落增加代码块溯源强制规则

**Steps**:
1. 打开 `packages/orchestrator/src/prompts/page-agent.ts`
2. 定位 `## 🔍 绝对纪律：精准溯源 (Mandatory Traceability)` 段落（约 line 105-119）
3. 在现有溯源格式说明之后（line 118 附近），追加代码块溯源规则：

```markdown

🔴 **代码块溯源（强制）**
任何从源文件摘抄的代码块，必须在 \`\`\` 上方添加溯源行：

[Source: foo.ts](/packages/core/src/foo.ts#L42-L67)
\`\`\`typescript
const result = foo.bar();
\`\`\`

⚠️ 溯源行必须在代码块**外面**（纯文本，链接可点击），不要在代码块内部用注释！
❌ 错误：\`\`\`typescript\n// Source: foo.ts\n...
✅ 正确：[Source: foo.ts](/...)\n\`\`\`typescript\n...
```

4. 保存文件

**Changed files**: `packages/orchestrator/src/prompts/page-agent.ts`

**Validation**: 阅读 page-agent.ts，确认 `🔴 **代码块溯源（强制）**` 段存在

**Time**: 3 min

---

### [x] 1.2 PageFacts 类型定义

**Goal**: `@open-zread/types` 包导出 `PageFacts`, `ExportFact`, `FileSummary` 类型

**Steps**:
1. 新建 `packages/types/src/facts.ts`

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

2. 打开 `packages/types/src/index.ts`，在 Wiki types 导出之后添加：

```typescript
// Facts types
export type { PageFacts, ExportFact, FileSummary } from './facts.js'
```

**Changed files**:
- `packages/types/src/facts.ts`（新建）
- `packages/types/src/index.ts`

**Validation**: `bun run typecheck`

**Time**: 3 min

---

### [x] 1.3 质量审计模块

**Goal**: 提供 `analyzeDoc`, `analyzeWiki`, `scoreByComplexity` 函数

**Steps**:
1. 新建 `packages/utils/src/output/quality-audit.ts`

实现逻辑：

```typescript
import { readFileSync } from 'node:fs';
import { scanSecrets } from './audit-docs.js';
import type { SecretLeak } from './audit-docs.js';
import type { WikiPage } from '@open-zread/types';

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

// MermaidIssue 需从 repo-analyzer 导入，或在此定义简化版
export interface MermaidIssue {
  severity: 'warn' | 'error';
  line: number;
  message: string;
  suggestion: string;
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

export function analyzeDoc(filePath: string): DocMetrics {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // 1. lineCount
  const lineCount = lines.length;

  // 2. Mermaid blocks — count and types
  const diagramCount: number = /* count ```mermaid blocks */;
  const diagramTypes: string[] = /* extract first keyword (flowchart, sequenceDiagram, etc.) */;

  // 3. Code blocks — count non-mermaid code blocks
  const codeBlockCount: number = /* count ``` blocks excluding ```mermaid */;

  // 4. Source links — Sources: [...] and [Source: ...](...)
  const sourceLinkCount: number = /* regex count */;
  const codeBlockSourceLinks: number = /* count [Source:...] lines above ``` blocks */;

  // 5. Empty sections
  const emptySections: string[] = /* find ##/### followed by another ##/### or EOF */;

  // 6. Secret leaks — reuse scanSecrets
  const secretLeaks = scanSecrets(filePath, content);

  // 7. Mermaid issues — simplified inline validation
  const mermaidIssues: MermaidIssue[] = /* basic mermaid validation */;

  return { filePath, lineCount, diagramCount, diagramTypes, codeBlockCount, sourceLinkCount, codeBlockSourceLinks, emptySections, secretLeaks, mermaidIssues };
}

export function analyzeWiki(wikiPath: string, pages?: WikiPage[]): QualityReport { /* ... */ }
export function scoreByComplexity(metrics: DocMetrics, page?: WikiPage): { level: QualityLevel; score: number } { /* ... */ }
```

**关键实现细节**：
- `analyzeDoc` 需实现 6 种统计：mermaid 块计数/类型提取、代码块计数、溯源链接计数、代码块溯源计数、空章节检测
- 复用 `scanSecrets` 做密钥检测
- Mermaid 校验：由于 `validateMermaidBlocks` 在 `repo-analyzer` 包中，`utils` 包不应直接依赖 `repo-analyzer`。解决方案：在 `quality-audit.ts` 中实现简化版 Mermaid 校验（仅统计和基础检查），或让 `analyzeWiki` 接受外部传入的 mermaid 验证函数
- `scoreByComplexity` 按 design.md §3.3 的评分矩阵实现

2. 打开 `packages/utils/src/index.ts`，在 Output 段添加导出

**Changed files**:
- `packages/utils/src/output/quality-audit.ts`（新建）
- `packages/utils/src/index.ts`

**Validation**: `bun run typecheck`

**Time**: 15 min

**Notes**: Mermaid 校验采用简化版内联实现（仅提取块+统计类型+检测 subgraph 冲突），避免 utils → repo-analyzer 的循环依赖。完整校验仍用 repo-analyzer 的 `validateMermaidBlocks`。

---

## Phase 2: Facts-First 管线（Tasks 3-4，依赖 Phase 1.2）

---

### [x] 2.1 Facts 提取器

**Goal**: `extractPageFacts()` 按 WikiPage.associatedFiles 从 SymbolManifest 提取结构化 Facts

**Steps**:
1. 新建 `packages/repo-analyzer/src/repo-map/module-facts.ts`

```typescript
import type { WikiPage, SymbolManifest, PageFacts, ExportFact, FileSummary } from '@open-zread/types';

export function extractPageFacts(page: WikiPage, symbols: SymbolManifest): PageFacts {
  const associatedFiles = page.associatedFiles ?? [];
  
  // 1. Filter symbols by associatedFiles
  const matchedSymbols = symbols.symbols.filter(s =>
    associatedFiles.some(af => {
      // Match both exact file and directory prefix
      return s.file === af || s.file.startsWith(af.replace(/\/$/, '') + '/');
    })
  );

  // 2. Build exports list from functions
  const seen = new Set<string>();
  const exports: ExportFact[] = [];
  for (const sym of matchedSymbols) {
    for (const fn of sym.functions) {
      if (!seen.has(fn.name)) {
        seen.add(fn.name);
        exports.push({
          name: fn.name,
          kind: 'function',
          signature: fn.signature,
          file: sym.file,
        });
      }
    }
    // Also add bare export names
    for (const exp of sym.exports) {
      if (!seen.has(exp)) {
        seen.add(exp);
        exports.push({
          name: exp,
          kind: 'unknown',
          signature: exp,
          file: sym.file,
        });
      }
    }
  }

  // 3. Build file summaries
  const fileSummaries: FileSummary[] = matchedSymbols.map(sym => ({
    file: sym.file,
    symbolCount: sym.functions.length + sym.exports.length,
    exports: sym.exports,
  }));

  // 4. Collect deps
  const internalDepsSet = new Set<string>();
  const externalDepsSet = new Set<string>();
  for (const sym of matchedSymbols) {
    for (const imp of sym.imports) {
      if (imp.startsWith('.') || imp.startsWith('/')) {
        internalDepsSet.add(imp);
      } else if (!imp.startsWith('@open-zread')) {
        externalDepsSet.add(imp);
      }
    }
  }

  // 5. Calculate confidence
  const matchedFiles = matchedSymbols.length;
  const confidence = associatedFiles.length > 0 ? matchedFiles / associatedFiles.length : 0;

  return {
    pageSlug: page.slug,
    exports,
    fileSummaries,
    internalDeps: [...internalDepsSet],
    externalDeps: [...externalDepsSet],
    confidence: Math.min(confidence, 1),
  };
}
```

2. 打开 `packages/repo-analyzer/src/repo-map/index.ts`，在 export 段添加：

```typescript
export { extractPageFacts } from './module-facts.js';
```

**Changed files**:
- `packages/repo-analyzer/src/repo-map/module-facts.ts`（新建）
- `packages/repo-analyzer/src/repo-map/index.ts`

**Validation**: `bun run typecheck`

**Time**: 8 min

---

### [x] 2.2 Facts 注入 Prompt + 管线传递

**Goal**: `buildPagePrompt` 接收可选 PageFacts 并注入到 Prompt；`generateWikiContent` 接收可选 SymbolManifest

**Steps**:
1. 打开 `packages/orchestrator/src/wiki/generate-wiki.ts`

2. 添加导入：
```typescript
import type { SymbolManifest, PageFacts } from '@open-zread/types';
import { extractPageFacts } from '@open-zread/repo-analyzer';
```

3. 修改 `buildPagePrompt` 签名和函数体：

```typescript
function buildPagePrompt(page: WikiPage, facts?: PageFacts): string {
  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';
  const targets = getQualityTargets(page);

  // Build facts section if available
  const factsSection = facts && facts.exports.length > 0
    ? `
---

## 🔴 Facts — 权威数据源（API 签名必须以这里为准）

**导出符号** (共 ${facts.exports.length} 个):
${facts.exports.map(e => `- \`${e.signature}\` → ${e.file}${e.line ? `#L${e.line}` : ''}`).join('\n')}

**关联文件摘要**:
${facts.fileSummaries.map(f => `- ${f.file} (${f.symbolCount} 个符号, 导出: [${f.exports.slice(0, 5).join(', ')}${f.exports.length > 5 ? '...' : ''}])`).join('\n')}

## ⚠️ Facts 规则
1. 所有 API 描述必须以上述符号列表为准
2. 如果某个符号在 Facts 中不存在，不要添加到文档中
3. 如果 Facts 中有某个符号但不理解，可以忽略但不要篡改其签名

`
    : '';

  return `${PageAgentPrompt}

---
${factsSection}
## 🎯 本文档质量目标
// ... rest unchanged
`;
}
```

4. 打开 `packages/orchestrator/src/wiki/types.ts`，在 `GenerateWikiOptions` 接口添加：

```typescript
/** Symbol manifest for Facts-First extraction (optional) */
symbols?: SymbolManifest;
```

同时在文件顶部添加导入：
```typescript
import type { SymbolManifest } from '@open-zread/types';
```

5. 修改 `generateWikiContent` 函数，在 pages.map 循环中：

```typescript
const tasks = pages.map((page) =>
  limit(async () => {
    // ... existing code ...
    const facts = options?.symbols
      ? extractPageFacts(page, options.symbols)
      : undefined;

    const result = await createAgent({
      tools: [...],
      prompts: buildPagePrompt(page, facts),  // 传入 facts
      // ... rest unchanged
    });
    // ...
  })
);
```

**Changed files**:
- `packages/orchestrator/src/wiki/generate-wiki.ts`
- `packages/orchestrator/src/wiki/types.ts`

**Validation**:
- 传入 symbols + page 有 associatedFiles → Prompt 包含 `## 🔴 Facts` 段
- 不传 symbols → 无 Facts 段
- `bun run typecheck`

**Time**: 8 min

---

## Phase 3: 收尾管道 + 集成（Tasks 6-7，依赖 Phase 2）

---

### [x] 3.1 收尾管道

**Goal**: `finalizeWiki` 函数执行链接修复 + 索引构建 + 侧边栏生成

**Steps**:
1. 新建 `packages/utils/src/output/finalize.ts`

```typescript
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { WikiPage } from '@open-zread/types';
import { logger } from '../logger.js';
import { analyzeWiki } from './quality-audit.js';
import type { QualityReport } from './quality-audit.js';

export interface FinalizeOptions {
  audit?: boolean;
  pages?: WikiPage[];
}

export interface FinalizeResult {
  linksSanitized: number;
  docIndexBuilt: boolean;
  sidebarGenerated: boolean;
  auditReport?: QualityReport;
  errors: Array<{ step: string; error: string }>;
}

function collectMdFiles(dir: string): string[] { /* recursive .md collection */ }

async function sanitizeLinks(outputDir: string): Promise<number> {
  // Scan all .md files, replace file:///absolute/path/ prefix with /
  // Return count of fixed links
}

async function buildDocIndex(outputDir: string): Promise<void> {
  // Parse Source links from all .md
  // Build sourceToDocs and docToSources maps
  // Write source-files-index.json
}

async function generateSidebar(outputDir: string, pages: WikiPage[]): Promise<void> {
  // Group by section, then by group
  // Write _sidebar.md
}

export async function finalizeWiki(wikiPath: string, options?: FinalizeOptions): Promise<FinalizeResult> {
  const result: FinalizeResult = {
    linksSanitized: 0,
    docIndexBuilt: false,
    sidebarGenerated: false,
    errors: [],
  };

  // Step 1: sanitize links
  try {
    result.linksSanitized = await sanitizeLinks(wikiPath);
  } catch (err) {
    result.errors.push({ step: 'sanitizeLinks', error: String(err) });
  }

  // Step 2: build doc index
  try {
    await buildDocIndex(wikiPath);
    result.docIndexBuilt = true;
  } catch (err) {
    result.errors.push({ step: 'buildDocIndex', error: String(err) });
  }

  // Step 3: generate sidebar
  if (options?.pages?.length) {
    try {
      await generateSidebar(wikiPath, options.pages);
      result.sidebarGenerated = true;
    } catch (err) {
      result.errors.push({ step: 'generateSidebar', error: String(err) });
    }
  }

  // Step 4: optional audit
  if (options?.audit) {
    try {
      result.auditReport = analyzeWiki(wikiPath, options.pages);
    } catch (err) {
      result.errors.push({ step: 'audit', error: String(err) });
    }
  }

  return result;
}
```

2. 打开 `packages/utils/src/index.ts`，添加导出

**Changed files**:
- `packages/utils/src/output/finalize.ts`（新建）
- `packages/utils/src/index.ts`

**Validation**: `bun run typecheck`

**Time**: 12 min

---

### [x] 3.2 收尾管道集成到 generateWikiContent

**Goal**: 页面生成完成后自动执行 finalize + audit

**Steps**:
1. 打开 `packages/orchestrator/src/wiki/generate-wiki.ts`
2. 添加导入：

```typescript
import { finalizeWiki, getWikiDir } from '@open-zread/utils';
```

3. 在 `await Promise.all(tasks);` 之后、`const durationMs = ...` 之前，插入：

```typescript
  // 7. Finalize: sanitize links, build index, generate sidebar, audit
  try {
    const wikiDir = getWikiDir();
    const finalizeResult = await finalizeWiki(wikiDir, {
      pages,
      audit: true,
    });

    logger.info(`收尾完成: ${finalizeResult.linksSanitized} 链接修复, 索引=${finalizeResult.docIndexBuilt}, 侧边栏=${finalizeResult.sidebarGenerated}`);

    if (finalizeResult.auditReport) {
      const { auditReport } = finalizeResult;
      logger.info(
        `质量审计: ${auditReport.professionalCount}/${auditReport.totalDocs} professional, ${auditReport.standardCount} standard, ${auditReport.basicCount} basic`
      );
    }

    if (finalizeResult.errors.length > 0) {
      for (const { step, error } of finalizeResult.errors) {
        logger.warn(`收尾步骤 [${step}] 失败: ${error}`);
      }
    }
  } catch (err) {
    logger.warn(`收尾管道异常: ${err instanceof Error ? err.message : String(err)}`);
  }
```

**Changed files**: `packages/orchestrator/src/wiki/generate-wiki.ts`

**Validation**: `bun run typecheck`

**Time**: 5 min

---

## Phase 4: 集成验证（Task 8）

---

### [x] 4.1 类型检查 + Lint

**Goal**: 所有改动通过 TypeScript 类型检查和 ESLint

**Steps**:
1. 运行 `bun run typecheck`
2. 如有错误，修复
3. 运行 `bun run lint`
4. 如有 lint 错误，运行 `bun run lint:fix`
5. 再次运行 `bun run lint` 确认

**Validation**: `bun run typecheck` + `bun run lint` 退出码为 0

**Depends on**: Phase 1-3 全部完成

**Time**: 5 min

---

## 改动的文件汇总

| 文件 | 操作 | Phase |
|------|------|-------|
| `packages/orchestrator/src/prompts/page-agent.ts` | 编辑（溯源增强） | 1 |
| `packages/types/src/facts.ts` | 新建 | 1 |
| `packages/types/src/index.ts` | 编辑（新增导出） | 1 |
| `packages/utils/src/output/quality-audit.ts` | 新建 | 1 |
| `packages/repo-analyzer/src/repo-map/module-facts.ts` | 新建 | 2 |
| `packages/repo-analyzer/src/repo-map/index.ts` | 编辑（新增导出） | 2 |
| `packages/orchestrator/src/wiki/generate-wiki.ts` | 编辑（Facts + finalize） | 2, 3 |
| `packages/orchestrator/src/wiki/types.ts` | 编辑（GenerateWikiOptions） | 2 |
| `packages/utils/src/output/finalize.ts` | 新建 | 3 |
| `packages/utils/src/index.ts` | 编辑（新增导出） | 1, 3 |
