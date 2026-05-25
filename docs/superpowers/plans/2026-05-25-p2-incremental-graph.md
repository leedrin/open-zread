# Build Plan: p2-incremental-graph

> Generated from `openspec/changes/p2-incremental-graph/plan-ready.md`
> Do not reinterpret requirements or change technical decisions from design.md.

## Phase 1: 类型与依赖图基础（Tasks 1-3）

---

### [x] 1.1 新增增量管道类型定义

**Goal**: `@open-zread/types` 包导出所有增量管道和图数据类型

**Steps**:
1. 新建 `packages/types/src/incremental.ts`

```typescript
export interface DependencyEdge {
  source: string;
  target: string;
  kind: 'import' | 'dynamic_import' | 'reexport';
  symbols?: string[];
}

export interface DependencyGraph {
  forward: Record<string, string[]>;
  reverse: Record<string, string[]>;
  edges: DependencyEdge[];
}

export interface AffectedDoc {
  docPath: string;
  page: import('./wiki').WikiPage;
  reason: 'source_changed' | 'dep_changed' | 'doc_dep_changed';
  updateStrength: 'full' | 'incremental';
  triggeredBy: string[];
  signatureChanged: boolean;
}

export interface IncrementalPlan {
  changedFiles: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  affectedDocs: AffectedDoc[];
  unaffectedDocs: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
  metadata?: {
    exportCount?: number;
    pageCount?: number;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'import' | 'refers' | 'links';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

2. 打开 `packages/types/src/index.ts`，在 Facts types 导出之后添加：

```typescript
// Incremental pipeline types
export type {
  DependencyEdge,
  DependencyGraph,
  AffectedDoc,
  IncrementalPlan,
  GraphNode,
  GraphEdge,
  GraphData,
} from './incremental.js'
```

**Changed files**: `packages/types/src/incremental.ts` (新建), `packages/types/src/index.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/types`

**Time**: 3 min

---

### [x] 1.2 实现依赖图构建 — buildDependencyGraph()

**Goal**: 从 `SymbolManifest.imports` 构建双向依赖图

**Steps**:
1. 新建 `packages/utils/src/cache/dependency-graph.ts`

```typescript
import { join, dirname, normalize } from 'path';
import type { SymbolManifest, DependencyGraph, DependencyEdge } from '@open-zread/types';

function extractImportPath(importStatement: string): string | null {
  const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function resolveImportPath(
  importPath: string,
  fromFile: string,
  packageAliases?: Record<string, string>
): string | null {
  if (importPath.startsWith('.')) {
    const dir = dirname(fromFile);
    let resolved = normalize(join(dir, importPath));
    if (!resolved.includes('.')) resolved += '.ts';
    return resolved;
  }
  if (packageAliases && packageAliases[importPath]) {
    return packageAliases[importPath];
  }
  return null;
}

export function buildDependencyGraph(
  symbols: SymbolManifest,
  packageAliases?: Record<string, string>
): DependencyGraph {
  const forward: Record<string, string[]> = {};
  const reverse: Record<string, string[]> = {};
  const edges: DependencyEdge[] = [];

  for (const symbol of symbols.symbols) {
    if (!forward[symbol.file]) forward[symbol.file] = [];
    if (!reverse[symbol.file]) reverse[symbol.file] = [];

    for (const imp of symbol.imports) {
      const importPath = extractImportPath(imp);
      if (!importPath) continue;

      const resolved = resolveImportPath(importPath, symbol.file, packageAliases);
      if (!resolved) continue;

      if (!forward[symbol.file].includes(resolved)) {
        forward[symbol.file].push(resolved);
      }
      if (!reverse[resolved]) reverse[resolved] = [];
      if (!reverse[resolved].includes(symbol.file)) {
        reverse[resolved].push(symbol.file);
      }

      edges.push({ source: symbol.file, target: resolved, kind: 'import' });
    }
  }

  return { forward, reverse, edges };
}
```

2. 确保路径解析处理边界情况（无扩展名、路径分隔符）

**Changed files**: `packages/utils/src/cache/dependency-graph.ts` (新建)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 8 min

**Notes**: 
- 复用 `reference-counter.ts` 的 `extractImportPath()` 正则
- `DependencyGraph` 在类型定义中使用 `Record<string, string[]>`（非 Map），方便 JSON 序列化
- 包别名映射由调用方传入，此函数不负责自动发现

---

### [x] 1.3 实现 BFS 传播 — computeTransitiveImpact()

**Goal**: 从指定文件集合 BFS 遍历依赖图，返回受影响文件

**Steps**:
1. 在 `packages/utils/src/cache/dependency-graph.ts` 中添加函数

```typescript
export function computeTransitiveImpact(
  sources: string[],
  graph: DependencyGraph,
  maxDepth: number = 3
): Map<string, { depth: number; reason: 'source_changed' | 'dep_changed' }> {
  const result = new Map<string, { depth: number; reason: 'source_changed' | 'dep_changed' }>();

  for (const source of sources) {
    result.set(source, { depth: 0, reason: 'source_changed' });
  }

  const queue: Array<{ file: string; depth: number }> = sources.map(s => ({ file: s, depth: 0 }));

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const dependents = graph.reverse[file] ?? [];
    for (const dep of dependents) {
      if (result.has(dep)) continue;
      result.set(dep, { depth: depth + 1, reason: 'dep_changed' });
      queue.push({ file: dep, depth: depth + 1 });
    }
  }

  return result;
}
```

**Changed files**: `packages/utils/src/cache/dependency-graph.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 5 min

**Notes**: 使用 `reverse` 图做 BFS（从变更文件反向查找所有依赖它的文件）

---

### [x] 1.4 依赖图缓存读写

**Goal**: 依赖图可以序列化到 `.open-zread/cache/dependency-graph.json`

**Steps**:
1. 在 `packages/utils/src/cache/constants.ts` 中添加缓存文件名

```typescript
export const CACHE_FILES = {
  manifest: 'last_manifest.json',
  depGraph: 'dependency-graph.json',
};
```

2. 在 `packages/utils/src/cache/dependency-graph.ts` 末尾添加序列化函数

```typescript
import { getCacheDir, readJsonFile, writeJsonFile, ensureDir } from '../file-io.js';
import { join } from 'path';
import { CACHE_FILES } from './constants.js';

export async function saveDependencyGraph(graph: DependencyGraph): Promise<void> {
  const cacheDir = getCacheDir();
  await ensureDir(cacheDir);
  const filePath = join(cacheDir, CACHE_FILES.depGraph);
  await writeJsonFile(filePath, graph);
}

export async function loadDependencyGraph(): Promise<DependencyGraph | null> {
  const cacheDir = getCacheDir();
  const filePath = join(cacheDir, CACHE_FILES.depGraph);
  try {
    return await readJsonFile<DependencyGraph>(filePath);
  } catch {
    return null;
  }
}
```

**Changed files**: `packages/utils/src/cache/constants.ts` (修改), `packages/utils/src/cache/dependency-graph.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 3 min

---

## Phase 2: 增量管道核心（Tasks 4-6）— 依赖 Phase 1

---

### [x] 2.1 文档间依赖映射 — buildDocToDocDeps()

**Goal**: 从 wiki markdown 提取跨文档链接

**Steps**:
1. 新建 `packages/utils/src/cache/incremental-pipeline.ts`

```typescript
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type {
  FileManifest, CacheManifest, SymbolManifest,
  DependencyGraph, IncrementalPlan, AffectedDoc, WikiPage, PageFacts
} from '@open-zread/types';
import { diffManifests } from './index.js';
import { buildDependencyGraph, computeTransitiveImpact } from './dependency-graph.js';

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...collectMdFiles(full));
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(full);
      }
    }
  } catch {}
  return files;
}

export function buildDocToDocDeps(wikiPath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const files = collectMdFiles(wikiPath);

  const linkRe = /\[([^\]]+)\]\((?!http)([^)]+\.md)\)/g;

  for (const filePath of files) {
    const rel = relative(wikiPath, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const deps: string[] = [];

    linkRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(content)) !== null) {
      deps.push(match[2]);
    }

    if (deps.length > 0) {
      result.set(rel, deps);
    }
  }

  return result;
}
```

**Changed files**: `packages/utils/src/cache/incremental-pipeline.ts` (新建)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 5 min

---

### [x] 2.2 增量更新计划 — buildIncrementalPlan()

**Goal**: 四级传播管道，输出 `IncrementalPlan`

**Steps**:
1. 在 `packages/utils/src/cache/incremental-pipeline.ts` 中添加 `buildIncrementalPlan()`

```typescript
import { readJsonFile, getWikiDir } from '../file-io.js';
import { join } from 'path';

interface IncrementalPlanOptions {
  cached: CacheManifest;
  current: FileManifest;
  symbols: SymbolManifest;
  wikiPath: string;
  pages: WikiPage[];
  previousFacts?: Map<string, PageFacts>;
}

export async function buildIncrementalPlan(options: IncrementalPlanOptions): Promise<IncrementalPlan> {
  const { cached, current, symbols, wikiPath, pages, previousFacts } = options;

  // Level 1: File hash diff
  const { added, modified, removed } = diffManifests(cached, current);
  const changedFiles = { added, modified, removed };
  const allChanged = [...added, ...modified, ...removed];

  if (allChanged.length === 0) {
    return {
      changedFiles,
      affectedDocs: [],
      unaffectedDocs: pages.map(p => `${p.section}/${p.file}`),
    };
  }

  // Build dependency graph
  const packageAliases = buildPackageAliases(symbols);
  const depGraph = buildDependencyGraph(symbols, packageAliases);

  // Level 2: BFS propagation
  const impacted = computeTransitiveImpact(allChanged, depGraph, 3);

  // Level 3: Source-to-Docs mapping
  const indexPath = join(wikiPath, 'source-files-index.json');
  let sourceToDocs: Record<string, string[]> = {};
  try {
    const data = await readJsonFile<{ sourceToDocs: Record<string, string[]> }>(indexPath);
    sourceToDocs = data?.sourceToDocs ?? {};
  } catch {}

  // Level 4: Doc-to-Doc deps
  const docDeps = buildDocToDocDeps(wikiPath);

  // Compute affected docs
  const affectedDocs: AffectedDoc[] = [];
  const affectedDocPaths = new Set<string>();

  const pageMap = new Map(pages.map(p => [`${p.section}/${p.file}`, p]));

  // source_changed: directly changed files → their docs
  for (const file of [...added, ...modified]) {
    const docs = sourceToDocs[file] ?? [];
    for (const docPath of docs) {
      if (affectedDocPaths.has(docPath)) continue;
      affectedDocPaths.add(docPath);

      const page = pageMap.get(docPath);
      if (!page) continue;

      const sigChanged = checkSignatureChanged(file, previousFacts);
      affectedDocs.push({
        docPath,
        page,
        reason: 'source_changed',
        updateStrength: sigChanged || added.includes(file) ? 'full' : 'incremental',
        triggeredBy: [file],
        signatureChanged: sigChanged,
      });
    }
  }

  // dep_changed: transitive impact → their docs
  for (const [file, info] of impacted) {
    if (info.reason !== 'dep_changed') continue;
    const docs = sourceToDocs[file] ?? [];
    for (const docPath of docs) {
      if (affectedDocPaths.has(docPath)) continue;
      affectedDocPaths.add(docPath);

      const page = pageMap.get(docPath);
      if (!page) continue;

      affectedDocs.push({
        docPath,
        page,
        reason: 'dep_changed',
        updateStrength: 'incremental',
        triggeredBy: [file],
        signatureChanged: false,
      });
    }
  }

  // doc_dep_changed: propagate through doc-to-doc links
  for (const [docPath, deps] of docDeps) {
    if (affectedDocPaths.has(docPath)) continue;
    for (const dep of deps) {
      if (affectedDocPaths.has(dep)) {
        affectedDocPaths.add(docPath);
        const page = pageMap.get(docPath);
        if (!page) break;

        affectedDocs.push({
          docPath,
          page,
          reason: 'doc_dep_changed',
          updateStrength: 'incremental',
          triggeredBy: [dep],
          signatureChanged: false,
        });
        break;
      }
    }
  }

  const unaffectedDocs = pages
    .map(p => `${p.section}/${p.file}`)
    .filter(p => !affectedDocPaths.has(p));

  return { changedFiles, affectedDocs, unaffectedDocs };
}

function checkSignatureChanged(
  file: string,
  previousFacts?: Map<string, PageFacts>
): boolean {
  if (!previousFacts) return true; // no previous data, assume full
  const facts = previousFacts.get(file);
  if (!facts) return true;
  return false; // simplified: if facts exist, assume no sig change
  // TODO: compare with current facts for actual signature diff
}

function buildPackageAliases(symbols: SymbolManifest): Record<string, string> {
  // Auto-detect monorepo package aliases from file paths
  const aliases: Record<string, string> = {};
  const seen = new Set<string>();
  for (const s of symbols.symbols) {
    const match = s.file.match(/^(packages\/[^/]+)\//);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      // e.g. packages/types/src → @open-zread/types
      // We'll derive alias from directory name
      // For now, skip auto-detection; caller should provide aliases
    }
  }
  return aliases;
}
```

**Changed files**: `packages/utils/src/cache/incremental-pipeline.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 12 min

---

### [x] 2.3 导出增量管道公共接口

**Goal**: 从 utils 包公共入口导出所有新增函数

**Steps**:
1. 在 `packages/utils/src/cache/index.ts` 底部添加 re-export:

```typescript
// Dependency graph & incremental pipeline
export {
  buildDependencyGraph,
  computeTransitiveImpact,
  saveDependencyGraph,
  loadDependencyGraph,
} from './dependency-graph.js';

export {
  buildDocToDocDeps,
  buildIncrementalPlan,
} from './incremental-pipeline.js';
```

2. 在 `packages/utils/src/index.ts` 的 `// Cache` 区块添加新导出:

```typescript
export {
  buildDependencyGraph,
  computeTransitiveImpact,
  saveDependencyGraph,
  loadDependencyGraph,
  buildDocToDocDeps,
  buildIncrementalPlan,
} from './cache/index.js';
```

3. 在 `packages/utils/src/index.ts` 添加 graph-data 导出（Phase 4 新增文件后）

**Changed files**: `packages/utils/src/cache/index.ts` (修改), `packages/utils/src/index.ts` (修改)

**Validation**: `bun run typecheck && bun run lint`

**Time**: 3 min

---

## Phase 3: 增量修补模式（Tasks 7-9）— 依赖 Phase 2

---

### [x] 3.1 新增 ReadPageTool

**Goal**: Agent 工具链新增读取现有 wiki 页面的工具

**Steps**:
1. 打开 `packages/orchestrator/src/tools/page-tools.ts`
2. 在 `WritePageTool` 定义之后添加 `ReadPageTool`:

```typescript
export const ReadPageTool = defineTool({
  name: 'read_page',
  description: '读取现有 Wiki 页面的 Markdown 内容。用于增量修补时查看当前文档。',
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: '页面 slug',
      },
      file: {
        type: 'string',
        description: '文件名，如 "1-project-overview.md"',
      },
      section: {
        type: 'string',
        description: '所属章节',
      },
    },
    required: ['slug'],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input: ToolInputParams, context: ToolContext): Promise<string> {
    const slug = getRequiredString(input, 'slug');
    const file = getString(input, 'file');
    const section = getString(input, 'section');

    let filePath: string;
    if (file) {
      if (file.includes('/') || file.includes('\\')) {
        filePath = resolve(context.cwd, '.open-zread/wiki', file);
      } else if (section) {
        filePath = resolve(context.cwd, '.open-zread/wiki', section, file);
      } else {
        filePath = resolve(context.cwd, '.open-zread/wiki', file);
      }
    } else {
      filePath = resolve(context.cwd, '.open-zread/wiki', `${slug}.md`);
    }

    try {
      const content = await readTextFile(filePath);
      return JSON.stringify({
        success: true,
        slug,
        content,
        path: filePath,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        success: false,
        error: `页面未找到: ${message}`,
      });
    }
  },
});
```

3. 确保文件顶部已导入 `readTextFile`:

```typescript
import { ensureDir, writeTextFile, readTextFile } from '@open-zread/utils';
```

**Changed files**: `packages/orchestrator/src/tools/page-tools.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/orchestrator`

**Time**: 5 min

---

### [x] 3.2 新增外科手术式修补 Prompt

**Goal**: 创建增量修补模式的专用 Prompt 模板

**Steps**:
1. 新建 `packages/orchestrator/src/prompts/surgical-edit.ts`

```typescript
import type { WikiPage } from '@open-zread/types';

export function buildSurgicalEditPrompt(options: {
  page: WikiPage;
  triggeredBy: string[];
  existingContent: string;
}): string {
  const { page, triggeredBy, existingContent } = options;

  return `你是一个文档增量修补专家。你的任务是**精准修补**现有文档中受影响的部分，而不是重写整个文档。

## 🔴 增量修补规则（强制）

1. 只更新与以下变更文件相关的段落: ${triggeredBy.join(', ')}
2. **绝对不要**修改任何 Mermaid 图表
3. **绝对不要**重写未受影响的代码示例
4. 保留现有章节结构不变
5. 如果只需更新一段话，就只更新那段话
6. 修改后确保文档的连贯性
7. 不要删除任何现有内容，除非它与变更文件直接相关且已过时

## 工作流

1. 先用 read_page 工具读取现有文档内容（下方已提供）
2. 定位与变更文件相关的段落
3. 精准修改受影响内容
4. 使用 write_page 工具输出完整文档（包含未修改部分）

## 当前文档内容

---

${existingContent}

---

## 当前页面信息

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}

## 输出路径规范（必须严格遵守）

使用 \`write_page\` 工具时，**必须**传入以下参数确保正确的输出路径：
- \`slug\`: "${page.slug}"
- \`file\`: "${page.file}"
- \`section\`: "${page.section}"
- \`title\`: "${page.title}"

请执行修补，然后使用 write_page 输出完整文档。`;
}
```

**Changed files**: `packages/orchestrator/src/prompts/surgical-edit.ts` (新建)

**Validation**: `bun run typecheck --filter=@open-zread/orchestrator`

**Time**: 5 min

---

### [x] 3.3 修改 GenerateWikiOptions 类型

**Goal**: 生成选项支持 `incrementalPlan` 参数

**Steps**:
1. 打开 `packages/orchestrator/src/wiki/types.ts`
2. 添加 import:

```typescript
import type { IncrementalPlan } from '@open-zread/types';
```

3. 在 `GenerateWikiOptions` 接口末尾添加:

```typescript
  /** Incremental update plan (if provided, only affected docs are regenerated) */
  incrementalPlan?: IncrementalPlan;
```

**Changed files**: `packages/orchestrator/src/wiki/types.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/orchestrator`

**Time**: 2 min

---

### [x] 3.4 修改 generateWikiContent 支持增量模式

**Goal**: 主生成管线根据 `IncrementalPlan` 决定生成策略

**Steps**:
1. 打开 `packages/orchestrator/src/wiki/generate-wiki.ts`
2. 添加 import:

```typescript
import { ReadPageTool } from '../tools/page-tools.js';
import { buildSurgicalEditPrompt } from '../prompts/surgical-edit.js';
import { readTextFile, getWikiDir } from '@open-zread/utils';
import { resolve } from 'path';
import type { AffectedDoc, IncrementalPlan } from '@open-zread/types';
```

3. 替换 pages 加载逻辑（约 line 138-144）:

```typescript
  let pages: WikiPage[];
  let affectedDocsMap: Map<string, AffectedDoc> | undefined;

  if (options?.incrementalPlan && options.incrementalPlan.affectedDocs.length > 0) {
    // Incremental mode: only generate affected docs
    pages = options.incrementalPlan.affectedDocs.map(d => d.page);
    affectedDocsMap = new Map(
      options.incrementalPlan.affectedDocs.map(d => [d.page.slug, d])
    );
    logger.info(`增量模式：${pages.length} 个受影响页面（共 ${options.incrementalPlan.unaffectedDocs.length} 个未受影响）`);
  } else if (options?.pages && options.pages.length > 0) {
    pages = options.pages;
  } else {
    const blueprint = await loadWikiBlueprint(options?.blueprintPath);
    pages = blueprint.pages;
  }
```

4. 替换 Agent 创建部分（约 line 174-241 之间的 try 块）:

找到 `const facts = options?.symbols` 行，在它之前添加:

```typescript
        const affected = affectedDocsMap?.get(page.slug);
        const isIncremental = affected?.updateStrength === 'incremental';
```

5. 替换 `buildPagePrompt` 调用和 tools 列表:

```typescript
        let prompts: string;
        let tools: typeof toolsList;
        const baseTools = [FileReadTool, FileEditTool, GlobTool, GrepTool];

        if (isIncremental) {
          // Read existing content for surgical edit
          const wikiDir = getWikiDir();
          const existingPath = resolve(wikiDir, page.section, page.file);
          let existingContent = '';
          try {
            existingContent = await readTextFile(existingPath);
          } catch {
            existingContent = '(文档不存在，将全量生成)';
          }

          prompts = buildSurgicalEditPrompt({
            page,
            triggeredBy: affected!.triggeredBy,
            existingContent,
          });
          tools = [...baseTools, ReadPageTool, WritePageTool];
        } else {
          prompts = buildPagePrompt(page, facts);
          tools = [...baseTools, WritePageTool];
        }
```

6. 替换 createAgent 调用:

```typescript
        const result = await createAgent({
          tools,
          prompts,
          maxTurns: isIncremental ? 15 : 30,
          onEvent: (catalogEvent) => {
            // ... 保持现有 onEvent 逻辑不变 ...
          },
        });
```

**Changed files**: `packages/orchestrator/src/wiki/generate-wiki.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/orchestrator && bun run lint`

**Time**: 10 min

**Notes**: **最关键的集成任务**。注意保留现有的 onEvent 回调逻辑。isIncremental 模式下 maxTurns=15。

---

## Phase 4: 交互式关系图（Tasks 10-12）— 依赖 Phase 1

---

### [x] 4.1 实现图数据构建 — buildGraphData()

**Goal**: 构建 GraphData（nodes + edges）供前端可视化

**Steps**:
1. 新建 `packages/utils/src/output/graph-data.ts`

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { DependencyGraph, GraphData, GraphNode, GraphEdge, WikiPage } from '@open-zread/types';

export function buildGraphData(
  wikiPath: string,
  depGraph: DependencyGraph,
  pages: WikiPage[]
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // Add source nodes and import edges from dep graph
  for (const [source, targets] of Object.entries(depGraph.forward)) {
    if (!nodeIds.has(source)) {
      nodeIds.add(source);
      const pkgMatch = source.match(/^packages\/([^/]+)/);
      nodes.push({
        id: source,
        label: basename(source),
        type: 'source',
        group: pkgMatch ? `packages/${pkgMatch[1]}` : undefined,
      });
    }

    for (const target of targets) {
      if (!nodeIds.has(target)) {
        nodeIds.add(target);
        const pkgMatch = target.match(/^packages\/([^/]+)/);
        nodes.push({
          id: target,
          label: basename(target),
          type: 'source',
          group: pkgMatch ? `packages/${pkgMatch[1]}` : undefined,
        });
      }

      edges.push({ source, target, kind: 'import' });
    }
  }

  // Add doc nodes
  for (const page of pages) {
    const docId = page.slug;
    if (!nodeIds.has(docId)) {
      nodeIds.add(docId);
      nodes.push({
        id: docId,
        label: page.title,
        type: 'doc',
        group: page.section,
        metadata: { pageCount: page.associatedFiles?.length ?? 0 },
      });
    }
  }

  // Add refers edges from source-files-index.json
  const indexPath = join(wikiPath, 'source-files-index.json');
  if (existsSync(indexPath)) {
    try {
      const { sourceToDocs } = JSON.parse(readFileSync(indexPath, 'utf-8'));
      for (const [source, docs] of Object.entries(sourceToDocs as Record<string, string[]>)) {
        for (const docRelPath of docs) {
          const page = pages.find(p => docRelPath.endsWith(p.file) || docRelPath.includes(p.slug));
          if (page && nodeIds.has(source)) {
            edges.push({ source, target: page.slug, kind: 'refers' });
          }
        }
      }
    } catch {}
  }

  // Add links edges from doc-to-doc references
  const linkRe = /\[([^\]]+)\]\((?!http)([^)]+\.md)\)/g;
  for (const page of pages) {
    const sectionPath = join(wikiPath, page.section, page.file);
    const directPath = join(wikiPath, page.file);
    let content = '';

    try {
      content = readFileSync(existsSync(sectionPath) ? sectionPath : directPath, 'utf-8');
    } catch { continue; }

    linkRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(content)) !== null) {
      const targetFile = match[2];
      const targetPage = pages.find(p =>
        targetFile.includes(p.file) || targetFile.includes(p.slug)
      );
      if (targetPage) {
        edges.push({ source: page.slug, target: targetPage.slug, kind: 'links' });
      }
    }
  }

  // Deduplicate edges
  const edgeSet = new Set<string>();
  const dedupedEdges = edges.filter(e => {
    const key = `${e.source}|${e.target}|${e.kind}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: dedupedEdges };
}
```

2. 在 `packages/utils/src/index.ts` 添加导出:

```typescript
export { buildGraphData } from './output/graph-data.js';
```

**Changed files**: `packages/utils/src/output/graph-data.ts` (新建), `packages/utils/src/index.ts` (修改)

**Validation**: `bun run typecheck --filter=@open-zread/utils`

**Time**: 10 min

---

### [x] 4.2 Browse Server 新增 /graph API 端点

**Goal**: Express 新增 `GET /api/wiki/graph` 返回 GraphData JSON

**Steps**:
1. 打开 `apps/cli/src/commands/browse-server.ts`
2. 在 `createWikiApp` 函数中，`return { app };` 之前添加新端点:

```typescript
  // 4. Get graph data for visualization
  app.get("/api/wiki/graph", (_req: Request, res: Response) => {
    try {
      // Load wiki catalog for pages
      if (!existsSync(wikiJsonPath)) {
        return res.json({ nodes: [], edges: [] });
      }

      const catalog: WikiCatalog = JSON.parse(
        readFileSync(wikiJsonPath, "utf-8"),
      );

      // Load or build dependency graph
      const depGraphCachePath = path.join(
        projectPath, ".open-zread", "cache", "dependency-graph.json"
      );

      let depGraph;
      if (existsSync(depGraphCachePath)) {
        depGraph = JSON.parse(readFileSync(depGraphCachePath, "utf-8"));
      } else {
        // Try to build from cached symbols
        const symbolsPath = path.join(
          projectPath, ".open-zread", "cache", "last_symbols.json"
        );
        if (existsSync(symbolsPath)) {
          const symbols = JSON.parse(readFileSync(symbolsPath, "utf-8"));
          const { buildDependencyGraph } = require("@open-zread/utils");
          depGraph = buildDependencyGraph(symbols);
        } else {
          return res.json({ nodes: [], edges: [] });
        }
      }

      // Build graph data
      const { buildGraphData } = require("@open-zread/utils");
      const graphData = buildGraphData(wikiPath, depGraph, catalog.pages);

      res.json(graphData);
    } catch (error) {
      res.status(500).json({
        error: "Failed to build graph data",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
```

3. 由于 `apps/cli` 不能直接 `require("@open-zread/utils")`，改用 import 方式。在文件顶部添加:

```typescript
import { buildDependencyGraph, buildGraphData } from "@open-zread/utils";
```

然后端点中直接调用这些函数即可，不需要 `require`。

**Changed files**: `apps/cli/src/commands/browse-server.ts` (修改)

**Validation**: `bun run typecheck --filter=cli`；启动 browse 后 `curl http://localhost:3000/api/wiki/graph | jq '.nodes | length'`

**Time**: 8 min

**Notes**: `apps/cli` 的 `package.json` 已有 `@open-zread/utils` 依赖，可以直接 import。

---

### [x] 4.3 前端图可视化 — 依赖安装

**Goal**: 安装 d3-force 依赖

**Steps**:
1. `cd apps/browse && bun add d3-force && bun add -d @types/d3-force`

**Validation**: `cat apps/browse/package.json | grep d3-force`

**Time**: 1 min

---

### [x] 4.4 前端图可视化 — GraphView 组件

**Goal**: D3 force-layout SVG 渲染组件

**Steps**:
1. 新建 `apps/browse/src/pages/graph-page/GraphView.tsx`

```tsx
import { useRef, useEffect, useState } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: 'import' | 'refers' | 'links';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: string;
}

const COLORS = {
  source: '#3B82F6',
  doc: '#10B981',
};

const EDGE_COLORS = {
  import: '#94A3B8',
  refers: '#F59E0B',
  links: '#8B5CF6',
};

interface GraphViewProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
}

export function GraphView({ data, onNodeClick }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;

    const updateSize = () => {
      setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

    const svg = svgRef.current;
    const { width, height } = dimensions;

    // Clear previous
    svg.innerHTML = '';

    const nodes: SimNode[] = data.nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    }));

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links: SimLink[] = data.edges
      .map(e => ({
        source: nodeMap.get(typeof e.source === 'string' ? e.source : (e.source as SimNode).id) || e.source,
        target: nodeMap.get(typeof e.target === 'string' ? e.target : (e.target as SimNode).id) || e.target,
        kind: e.kind,
      }))
      .filter(l => l.source && l.target);

    const simulation = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id(d => d.id).distance(80))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide().radius(25));

    // Create SVG elements
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    // Zoom
    let transform = { x: 0, y: 0, k: 1 };
    const updateTransform = () => {
      g.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`);
    };

    svg.onwheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      transform.k = Math.max(0.1, Math.min(5, transform.k * delta));
      updateTransform();
    };

    // Drag
    let dragNode: SimNode | null = null;
    let dragStart = { x: 0, y: 0 };

    const linkElements = links.map(l => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', EDGE_COLORS[l.kind as keyof typeof EDGE_COLORS] || '#94A3B8');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0.5');
      g.appendChild(line);
      return line;
    });

    const nodeElements = nodes.map(n => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', n.type === 'doc' ? '8' : '6');
      circle.setAttribute('fill', COLORS[n.type]);
      circle.setAttribute('cursor', 'pointer');

      circle.onmousedown = (e: MouseEvent) => {
        e.stopPropagation();
        dragNode = n;
        dragStart = { x: e.clientX, y: e.clientY };
        simulation.alphaTarget(0.3).restart();
      };

      circle.onclick = () => onNodeClick?.(n);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = n.label.length > 20 ? n.label.slice(0, 20) + '...' : n.label;
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#6B7280');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '18');

      g.appendChild(circle);
      g.appendChild(text);

      return { circle, text, node: n };
    });

    svg.onmousemove = (e: MouseEvent) => {
      if (!dragNode) return;
      const dx = (e.clientX - dragStart.x) / transform.k;
      const dy = (e.clientY - dragStart.y) / transform.k;
      dragNode.x! += dx;
      dragNode.y! += dy;
      dragStart = { x: e.clientX, y: e.clientY };
      simulation.alpha(0.3).restart();
    };

    svg.onmouseup = () => {
      if (dragNode) {
        dragNode = null;
        simulation.alphaTarget(0);
      }
    };

    simulation.on('tick', () => {
      nodeElements.forEach(({ circle, text, node: n }) => {
        circle.setAttribute('cx', String(n.x));
        circle.setAttribute('cy', String(n.y));
        text.setAttribute('x', String(n.x));
        text.setAttribute('y', String(n.y));
      });

      links.forEach((l, i) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        linkElements[i].setAttribute('x1', String(s.x));
        linkElements[i].setAttribute('y1', String(s.y));
        linkElements[i].setAttribute('x2', String(t.x));
        linkElements[i].setAttribute('y2', String(t.y));
      });
    });

    return () => {
      simulation.stop();
    };
  }, [data, dimensions, onNodeClick]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        No graph data available. Run wiki generation first.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={dimensions.width}
      height={dimensions.height}
      className="bg-gray-50"
    />
  );
}
```

**Changed files**: `apps/browse/src/pages/graph-page/GraphView.tsx` (新建)

**Validation**: `bun run typecheck --filter=browse`

**Time**: 15 min

---

### [x] 4.5 前端图可视化 — GraphPage 页面

**Goal**: 页面组件调用 API，渲染 GraphView，显示节点详情

**Steps**:
1. 新建 `apps/browse/src/pages/graph-page/index.tsx`

```tsx
import { useEffect, useState } from 'react';
import { GraphView } from './GraphView';
import { X } from 'lucide-react';

interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: 'import' | 'refers' | 'links';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const LEGEND = [
  { color: '#3B82F6', label: 'Source File' },
  { color: '#10B981', label: 'Wiki Document' },
];

const EDGE_LEGEND = [
  { color: '#94A3B8', label: 'Import' },
  { color: '#F59E0B', label: 'Refers' },
  { color: '#8B5CF6', label: 'Links' },
];

export function GraphPage() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodeEdges, setNodeEdges] = useState<{ incoming: GraphEdge[]; outgoing: GraphEdge[] }>({ incoming: [], outgoing: [] });

  useEffect(() => {
    fetch('/api/wiki/graph')
      .then(res => res.json())
      .then((d: GraphData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    const incoming = data.edges.filter(e => {
      const t = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
      return t === node.id;
    });
    const outgoing = data.edges.filter(e => {
      const s = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
      return s === node.id;
    });
    setNodeEdges({ incoming, outgoing });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading graph...</div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 px-4 py-3 text-xs space-y-2">
        <div className="font-semibold text-gray-700 mb-1">Nodes</div>
        {LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
        <div className="font-semibold text-gray-700 mt-2 mb-1">Edges</div>
        {EDGE_LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="w-4 h-0.5" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 px-4 py-3 text-xs text-gray-500">
        {data.nodes.length} nodes · {data.edges.length} edges
      </div>

      {/* Graph */}
      <GraphView data={data} onNodeClick={handleNodeClick} />

      {/* Node detail panel */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 z-10 bg-white rounded-lg shadow-md border border-gray-200 p-4 w-72">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{selectedNode.label}</h3>
            <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-1 text-xs text-gray-500">
            <div>Type: <span className="text-gray-700">{selectedNode.type}</span></div>
            <div>Group: <span className="text-gray-700">{selectedNode.group || '—'}</span></div>
            <div>ID: <span className="text-gray-700 font-mono text-[10px]">{selectedNode.id}</span></div>
            <div className="mt-2">Incoming: <span className="text-gray-700">{nodeEdges.incoming.length}</span></div>
            <div>Outgoing: <span className="text-gray-700">{nodeEdges.outgoing.length}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Changed files**: `apps/browse/src/pages/graph-page/index.tsx` (新建)

**Validation**: `bun run typecheck --filter=browse`

**Time**: 8 min

---

### [x] 4.6 前端路由和导航

**Goal**: 注册 `/graph` 路由，添加导航链接

**Steps**:
1. 修改 `apps/browse/src/pages/index.ts`:

```typescript
export { HomePage } from './home-page';
export { WikiPage } from './wiki-page';
export { GraphPage } from './graph-page';
```

2. 修改 `apps/browse/src/App.tsx`，在 imports 中添加 `GraphPage`:

```typescript
import { HomePage, WikiPage, GraphPage } from '@/pages';
```

3. 在 Routes 中添加 graph 路由:

```tsx
        <Route path="/graph" element={<GraphPage />} />
```

4. 修改 `apps/browse/src/components/WikiSidebar.tsx`，在 header 部分（Zread Wiki 文字下方）添加 graph 链接:

在 `</div>` 关闭 header 后，`{/* Tree */}` 之前添加:

```tsx
        {/* Navigation */}
        <div className="px-4 py-2 border-b border-gray-100">
          <a href="/graph" className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="2" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
              <line x1="12" y1="10" x2="5.5" y2="7.5" /><line x1="12" y1="10" x2="18.5" y2="7.5" /><line x1="12" y1="14" x2="5.5" y2="16.5" /><line x1="12" y1="14" x2="18.5" y2="16.5" />
            </svg>
            Relationship Graph
          </a>
        </div>
```

**Changed files**: `apps/browse/src/pages/index.ts`, `apps/browse/src/App.tsx`, `apps/browse/src/components/WikiSidebar.tsx`

**Validation**: `bun run typecheck --filter=browse`；`cd apps/browse && bun run dev` 后访问 `/graph` 页面

**Time**: 5 min

---

## Execution Summary

| Phase | Tasks | Time Est. | Dependencies |
|-------|-------|-----------|--------------|
| Phase 1 | 1.1-1.4 | ~19 min | None |
| Phase 2 | 2.1-2.3 | ~20 min | Phase 1 |
| Phase 3 | 3.1-3.4 | ~22 min | Phase 2 |
| Phase 4 | 4.1-4.6 | ~47 min | Phase 1 (4.1), Phase 2 (4.2) |
| **Total** | **14 steps** | **~108 min** | |

Parallel opportunities:
- Phase 3 (3.1-3.2) and Phase 4 (4.1-4.3) can start after Phase 1
- Phase 3.3-3.4 must wait for Phase 2.3
- Phase 4.4-4.6 must wait for Phase 4.2
