# Build Plan: nium-wiki-p0-improvements

> Generated from `openspec/changes/nium-wiki-p0-improvements/plan-ready.md`
> Do not reinterpret requirements or change technical decisions from design.md.

## Phase 1: Prompt 增强 + 独立模块（Tasks 1–4，可并行）

---

### [x] 1.1 增强 page-agent.ts — 注入 Mermaid 图表规范块

**Goal**: `page-agent.ts` 的「架构设计与模块划分」段落后包含完整的 Mermaid 类型映射、分组策略和语法安全规则。

**Steps**:
1. 打开 `packages/orchestrator/src/prompts/page-agent.ts`
2. 定位现有的 `2. **架构设计与模块划分** (Architecture & Modules)` 段落
3. 在该段落的 `- **必须**使用 Mermaid` 行之后，插入 Mermaid 规范块：

```markdown

## 📊 Mermaid 图表规范（强制）

### 图表类型选择

| 内容类型 | 图表类型 | 方向 | 条件 |
|----------|----------|------|------|
| 系统架构 / 模块分层 | `flowchart TB` + `subgraph` | TB | 始终 |
| 请求 / 数据流 | `sequenceDiagram` | — | 始终 |
| 生命周期 / 状态转换 | `stateDiagram-v2` | — | 仅状态化模块 |
| 模块依赖 / 类型关系 | `flowchart LR` | LR | 始终 |
| 数据模型 / ORM | `erDiagram` | — | 项目有 DB/ORM 时 |

**图表多样性要求**：核心模块至少使用 2 种不同图表类型。三个相同类型 flowchart 不满足要求。

### 复杂度分组策略

| 节点数 | 策略 |
|--------|------|
| ≤ 6 | 线形排列，无需分组 |
| 7–12 | `subgraph` 分组，每组 2–4 节点 |
| 13–20 | 分层抽象（概览图 + 细节图各一张） |
| > 20 | 拆分为多个独立图表 |

### 语法安全规则

| 类别 | 规则 | 错误示例 | 正确示例 |
|------|------|----------|----------|
| 🔴 硬错误 | subgraph ID 不能与任何 node ID 重复 | `subgraph CLI[...]\nCLI[...]` | `subgraph CL[...]\nCLI[...]` |
| 🔴 硬错误 | 标签中双引号必须转义 | `A[Config "x"]` | `A[Config &quot;x&quot;]` |
| ⚠️ 建议 | 节点 ID 不使用 Mermaid 保留字（class / graph / subgraph / end / style / state / note） | `class[class]` | `NodeClass[class]` |
| ⚠️ 建议 | 简单标签优先用方括号而非引号 | `A["Label"]` | `A[Label]` |

### 图表溯源（强制）

每个 Mermaid 图下方必须标注数据来源：

```markdown
**Diagram sources**
- [file.ts](/src/path/file.ts#L1-L100)
```
```

4. 保存文件

**Changed files**: `packages/orchestrator/src/prompts/page-agent.ts`

**Validation**: 阅读 `page-agent.ts`，确认 `## 📊 Mermaid 图表规范（强制）` 块存在，包含类型映射表、分组策略、语法安全规则、溯源要求

**Time**: 5 min

**Notes**: 参考 nium-wiki SKILL.md Diagram Requirements 段落的措辞。不删除现有 `2. **架构设计与模块划分**` 段落，在其后追加。

---

### [x] 1.2 增强 page-agent.ts — 注入密钥脱敏规则块

**Goal**: `page-agent.ts` 包含密钥/凭证脱敏规则，AI 在生成代码示例时自动替换敏感值。

**Steps**:
1. 打开 `packages/orchestrator/src/prompts/page-agent.ts`
2. 在代码示例规范之前（`## 🔍 绝对纪律：精准溯源` 段之前）插入脱敏规则块：

```markdown

## 🔴 密钥与凭证脱敏（强制）

**规则**：在代码示例中，绝对不要包含真实的密钥、密码或 Token。使用以下占位符替换：

| 原始模式 | 替换为 |
|----------|--------|
| `sk_live_*` / `sk-*` 格式的 API Key | `sk_live_XXXXXXXX` |
| `pk_test_*` / `pk-*` 格式的公钥 | `pk_test_XXXXXXXX` |
| `ghp_*` / `gho_*` / `ghu_*` GitHub Token | `ghp_XXXXXXXX` |
| `password: "xxx"` / `passwd: "xxx"` | `password: "***REDACTED***"` |
| `TOKEN=xxx` / `SECRET=xxx` | `TOKEN=<your-token-here>` |
| 其他 8 字符以上敏感字符串 | `<sensitive-data>` |

**脱敏不影响结构**：仅替换字符串值，保持代码块语法结构不变。
```

3. 保存文件

**Changed files**: `packages/orchestrator/src/prompts/page-agent.ts`

**Validation**: 阅读 `page-agent.ts`，确认 `## 🔴 密钥与凭证脱敏（强制）` 块存在，覆盖 6 种脱敏模式

**Time**: 3 min

**Notes**: 脱敏规则块放在代码示例规范之前，确保 AI 在写代码之前就知道脱敏要求。

---

### [x] 1.3 新增 mermaid-validator.ts — 语法校验器

**Goal**: 提供 `validateMermaidBlocks()` 函数，从 markdown 中提取 mermaid 代码块并检查 4 条核心语法规则。

**Steps**:
1. 新建 `packages/repo-analyzer/src/repo-map/mermaid-validator.ts`

2. 实现以下接口和函数：

```typescript
export interface MermaidIssue {
  severity: 'warn' | 'error';
  line: number;
  message: string;
  suggestion: string;
}

/**
 * 提取 markdown 中的 ```mermaid 代码块
 */
function extractMermaidBlocks(mdContent: string): Array<{ startLine: number; content: string }> {
  const blocks: Array<{ startLine: number; content: string }> = [];
  const lines = mdContent.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inBlock && trimmed.startsWith('```mermaid')) {
      inBlock = true;
      blockStart = i;
      blockLines = [];
    } else if (inBlock && trimmed === '```') {
      inBlock = false;
      blocks.push({ startLine: blockStart, content: blockLines.join('\n') });
    } else if (inBlock) {
      blockLines.push(lines[i]);
    }
  }
  return blocks;
}

const RESERVED_KEYWORDS = ['class', 'graph', 'digraph', 'subgraph', 'end', 'click', 'style', 'state', 'note'];

/**
 * 校验单个 mermaid 块，返回 MermaidIssue[]
 */
function validateBlock(block: { startLine: number; content: string }): MermaidIssue[] {
  const issues: MermaidIssue[] = [];
  const lines = block.content.split('\n');

  // 收集所有 node ID 和 subgraph ID
  const nodeIds = new Set<string>();
  const subgraphIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = block.startLine + 1 + i;

    // 1. 检测 subgraph ID 与 node ID 冲突
    const subgraphMatch = line.match(/^subgraph\s+(\w+)/);
    if (subgraphMatch) {
      subgraphIds.add(subgraphMatch[1]);
    }

    // 收集 node ID
    const nodeMatch = line.match(/(\w+)\s*[[{(]/);
    if (nodeMatch && !line.startsWith('subgraph')) {
      nodeIds.add(nodeMatch[1]);
    }
  }

  // 检查冲突
  for (const id of subgraphIds) {
    if (nodeIds.has(id)) {
      issues.push({
        severity: 'error',
        line: block.startLine + 1,
        message: `subgraph ID "${id}" 与 node ID 冲突`,
        suggestion: `将 subgraph ID 改为其他名称，如 "${id}_sg" 或 "${id[0]}G"`,
      });
    }
  }

  // 2. 检测标签中未转义的双引号（在 [...] 内部）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = block.startLine + 1 + i;
    const labelMatch = line.match(/\[([^\]]*)"([^"]*)"([^\]]*)\]/);
    if (labelMatch && !line.includes('&quot;') && !line.includes('\\"')) {
      issues.push({
        severity: 'error',
        line: lineNum,
        message: '标签内存在未转义的双引号',
        suggestion: '将 " 替换为 &quot; 或使用 \\"',
      });
    }
  }

  // 3. 检测保留字作为 ID
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = block.startLine + 1 + i;
    const idMatch = line.match(/^(\w+)\s*[[{(]/);
    if (idMatch && RESERVED_KEYWORDS.includes(idMatch[1].toLowerCase())) {
      issues.push({
        severity: 'warn',
        line: lineNum,
        message: `"${idMatch[1]}" 是 Mermaid 保留字，不应作为节点 ID`,
        suggestion: `将节点 ID 改为 "Node${idMatch[1]}" 或 "My${idMatch[1]}"`,
      });
    }
  }

  // 4. 检测节点数超过 20
  const nodeCount = [...nodeIds].length;
  if (nodeCount > 20) {
    issues.push({
      severity: 'warn',
      line: block.startLine + 1,
      message: `图表包含 ${nodeCount} 个节点，建议拆分为多个图`,
      suggestion: '考虑按功能域拆分为 2-3 个独立图表',
    });
  }

  return issues;
}

export function validateMermaidBlocks(mdContent: string): MermaidIssue[] {
  const blocks = extractMermaidBlocks(mdContent);
  const allIssues: MermaidIssue[] = [];
  for (const block of blocks) {
    allIssues.push(...validateBlock(block));
  }
  return allIssues;
}
```

3. 打开 `packages/repo-analyzer/src/repo-map/index.ts`，在 export 段添加：
   ```typescript
   export { validateMermaidBlocks } from './mermaid-validator.js';
   export type { MermaidIssue } from './mermaid-validator.js';
   ```

**Changed files**:
- `packages/repo-analyzer/src/repo-map/mermaid-validator.ts`（新建）
- `packages/repo-analyzer/src/repo-map/index.ts`

**Validation**:
```bash
cd packages/repo-analyzer && bun test -- mermaid-validator
```
或创建测试文件手动验证以下场景：
1. 空文档 → `[]`
2. subgraph ID 冲突 → 1 error
3. 未转义引号 → 1 error
4. 保留字 ID → 1 warn
5. 超 20 节点 → 1 warn
6. 混合错误 → 正确数量
7. 非 mermaid 块文本 → 跳过

**Time**: 8 min

**Notes**: 纯正则实现，零外部依赖。后续可扩展更多规则。

---

### [x] 1.4 实现 getQualityTargets + 集成到 buildPagePrompt

**Goal**: Page Agent Prompt 包含根据页面 `level` 和 `associatedFiles` 动态计算的质量目标表格。

**Steps**:
1. 打开 `packages/orchestrator/src/wiki/generate-wiki.ts`

2. 在 `buildPagePrompt` 函数上方新增 `QualityTargets` 接口和 `getQualityTargets` 函数：

```typescript
interface QualityTargets {
  minLines: number;
  minDiagrams: number;
  minDiagramTypes: number;
  minExamples: number;
}

function getQualityTargets(page: WikiPage): QualityTargets {
  const fileCount = page.associatedFiles?.length ?? 0;

  // core: Advanced 或关联文件 ≥ 5
  if (page.level === 'Advanced' || fileCount >= 5) {
    return { minLines: 400, minDiagrams: 2, minDiagramTypes: 2, minExamples: 5 };
  }

  // simple: Beginner 且关联文件 ≤ 2
  if (page.level === 'Beginner' && fileCount <= 2) {
    return { minLines: 80, minDiagrams: 1, minDiagramTypes: 1, minExamples: 1 };
  }

  // standard: 其他所有情况
  return { minLines: 200, minDiagrams: 1, minDiagramTypes: 1, minExamples: 2 };
}
```

3. 修改 `buildPagePrompt` 函数，在系统 Prompt (`PageAgentPrompt`) 之后、页面任务信息之前插入质量目标块：

```typescript
function buildPagePrompt(page: WikiPage): string {
  // ... existing code ...

  const targets = getQualityTargets(page);

  return `${PageAgentPrompt}

---

## 🎯 本文档质量目标

根据页面难度（\`${page.level}\`）和关联文件数自动计算：

| 指标 | 最低要求 |
|------|----------|
| 文档行数 | ${targets.minLines}+ |
| Mermaid 图表 | ${targets.minDiagrams} 个 |
| 不同图表类型 | ${targets.minDiagramTypes} 种 |
| 代码示例 | ${targets.minExamples} 个 |
| 源文件溯源 | 每个章节 + 每个代码块 |

---

## 当前页面任务

**标题**: ${page.title}
// ... rest of existing template ...
`;
}
```

**Changed files**: `packages/orchestrator/src/wiki/generate-wiki.ts`

**Validation**:
```bash
cd packages/orchestrator && bun run typecheck
```
手动验证以下场景（可通过单元测试或代码审查）：
1. `level='Advanced'`, `associatedFiles=[...6项]` → core（400/2/2/5）
2. `level='Advanced'`, `associatedFiles=[...1项]` → core（level 优先）
3. `level='Beginner'`, `associatedFiles=[...1项]` → simple（80/1/1/1）
4. `level='Intermediate'`, `associatedFiles=[...3项]` → standard（200/1/1/2）
5. 缺失 `level` → 降级 standard
6. 缺失 `associatedFiles` → fileCount=0

**Time**: 5 min

**Notes**: 不修改并发控制和错误处理逻辑。`QualityTargets` 接口和函数为内部使用，不需要导出。

---

### [x] 1.5 新增 audit-docs.ts — 密钥扫描器

**Goal**: 提供 `scanSecrets()` 函数和 `scanWikiForSecrets()` 入口，检测 markdown 中的密钥泄漏。

**Steps**:
1. 新建 `packages/utils/src/output/audit-docs.ts`

2. 实现以下代码：

```typescript
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';

export interface SecretLeak {
  filePath: string;
  line: number;
  matchedText: string; // 前 4 字符 + '***'
  severity: 'error';
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{10,}/g,
    label: 'API Key / Token',
  },
  {
    pattern: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    label: 'Config Secret',
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    label: 'Password',
  },
];

function maskText(text: string): string {
  if (text.length <= 4) return '****';
  return text.slice(0, 4) + '***';
}

function isInsideMermaidBlock(lines: string[], lineIndex: number): boolean {
  let inMermaid = false;
  for (let i = 0; i <= lineIndex; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```mermaid')) {
      inMermaid = true;
    } else if (trimmed === '```' && inMermaid) {
      inMermaid = false;
    }
  }
  return inMermaid && lines[lineIndex]?.trim() !== '```mermaid' && lines[lineIndex]?.trim() !== '```';
}

/**
 * 扫描单个 markdown 字符串，返回发现的所有密钥泄漏
 */
export function scanSecrets(filePath: string, content: string): SecretLeak[] {
  const leaks: SecretLeak[] = [];
  const lines = content.split('\n');

  for (const { pattern, label: _label } of SECRET_PATTERNS) {
    // 重新创建正则以重置 lastIndex
    const re = new RegExp(pattern.source, pattern.flags);
    for (let i = 0; i < lines.length; i++) {
      // 跳过 Mermaid 代码块
      if (isInsideMermaidBlock(lines, i)) continue;

      re.lastIndex = 0;
      const line = lines[i];
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        // 检查是否已脱敏（占位符）
        const matched = match[0];
        if (/^<[^>]+>$/.test(matched)) continue; // 跳过 <your-token-here> 类占位符
        if (matched.startsWith('***')) continue;
        if (/^[X*]{3,}$/.test(matched)) continue;

        leaks.push({
          filePath,
          line: i + 1,
          matchedText: maskText(matched),
          severity: 'error',
        });
      }
    }
  }

  return leaks;
}

/**
 * 收集目录下所有 .md 文件（递归）
 */
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
  } catch {
    // skip unreadable dirs
  }
  return files;
}

/**
 * 扫描 wiki/ 目录下所有 .md 文件
 */
export function scanWikiForSecrets(wikiPath: string): SecretLeak[] {
  if (!existsSync(wikiPath)) return [];

  const mdFiles = collectMdFiles(wikiPath);
  const allLeaks: SecretLeak[] = [];

  for (const filePath of mdFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const leaks = scanSecrets(filePath, content);
      allLeaks.push(...leaks);
    } catch {
      // skip unreadable files
    }
  }

  return allLeaks;
}
```

3. 打开 `packages/utils/src/index.ts`，在 export 段添加：
   ```typescript
   export { scanSecrets, scanWikiForSecrets } from './output/audit-docs.js';
   export type { SecretLeak } from './output/audit-docs.js';
   ```

**Changed files**:
- `packages/utils/src/output/audit-docs.ts`（新建）
- `packages/utils/src/index.ts`

**Validation**:
```bash
cd packages/utils && bun run typecheck
```
手动验证以下场景（可编写简单测试脚本）：
1. 含 `sk_live_abc123def456` → 检测到
2. 含 `password: "mysecret123"` → 检测到
3. 含 `TOKEN=<your-token-here>` 占位符 → 不误报
4. \`\`\`mermaid 代码块内的 `sk-xxx` → 跳过
5. 普通 \`\`\`typescript 代码块内的 `sk-xxx` → 检测到
6. 空文档 → `[]`

**Time**: 8 min

**Notes**: 正则模式来源 design.md §3.1。这是审计模块的种子文件，P1 将扩展 `audit-docs.ts` 增加更多审计维度。

---

## Phase 2: 集成验证（Task 5）

---

### [x] 2.1 类型检查 + Lint

**Goal**: 所有 4 个改动文件通过 TypeScript 类型检查和 ESLint。

**Steps**:
1. 确保 1.1–1.5 全部完成
2. 运行类型检查：
   ```bash
   cd /Users/lijun/Documents/open-zread && bun run typecheck
   ```
3. 如有 lint 错误，运行自动修复：
   ```bash
   cd /Users/lijun/Documents/open-zread && bun run lint:fix
   ```
4. 再次运行 lint 确认通过：
   ```bash
   cd /Users/lijun/Documents/open-zread && bun run lint
   ```

**Changed files**: n/a

**Validation**:
- `bun run typecheck` 退出码 0
- `bun run lint` 退出码 0

**Depends on**: 1.1, 1.2, 1.3, 1.4, 1.5

**Time**: 3 min

**Notes**: 如 1.1–1.5 中有遗漏的 export 或类型定义错误，回退到对应步骤修复。

---

## 改动的文件汇总

| 文件 | 操作 | Phase |
|------|------|-------|
| `packages/orchestrator/src/prompts/page-agent.ts` | 编辑（插入 Mermaid 规范块 + 脱敏规则块） | 1 |
| `packages/repo-analyzer/src/repo-map/mermaid-validator.ts` | 新建 | 1 |
| `packages/repo-analyzer/src/repo-map/index.ts` | 编辑（新增 export） | 1 |
| `packages/orchestrator/src/wiki/generate-wiki.ts` | 编辑（新增 getQualityTargets + 修改 buildPagePrompt） | 1 |
| `packages/utils/src/output/audit-docs.ts` | 新建 | 1 |
| `packages/utils/src/index.ts` | 编辑（新增 export） | 1 |
