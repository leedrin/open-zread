/**
 * Mermaid 语法校验器
 *
 * 从 markdown 中提取 ```mermaid 代码块，检查常见语法错误。
 * 纯正则实现，零外部依赖。
 */

export interface MermaidIssue {
  severity: 'warn' | 'error';
  line: number;
  message: string;
  suggestion: string;
}

const RESERVED_KEYWORDS = [
  'class', 'graph', 'digraph', 'subgraph', 'end',
  'click', 'style', 'state', 'note',
];

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

/**
 * 校验单个 mermaid 块
 */
function validateBlock(block: { startLine: number; content: string }): MermaidIssue[] {
  const issues: MermaidIssue[] = [];
  const lines = block.content.split('\n');

  // 收集所有 node ID 和 subgraph ID
  const nodeIds = new Set<string>();
  const subgraphIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 收集 subgraph ID
    const subgraphMatch = line.match(/^subgraph\s+(\w+)/);
    if (subgraphMatch) {
      subgraphIds.add(subgraphMatch[1]);
    }

    // 收集 node ID（不包含 subgraph 行）
    const nodeMatch = line.match(/^(\w+)\s*[[{(]/);
    if (nodeMatch && !line.startsWith('subgraph')) {
      nodeIds.add(nodeMatch[1]);
    }
  }

  // 1. 检测 subgraph ID 与 node ID 冲突
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

  // 2. 检测标签中未转义的双引号（在 [...] 内部，不含 &quot; 或 \" 转义）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = block.startLine + 1 + i;
    // 匹配 [...] 内有双引号且未转义的情况
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

  // 3. 检测保留字作为节点 ID
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
  const nodeCount = nodeIds.size;
  if (nodeCount > 20) {
    issues.push({
      severity: 'warn',
      line: block.startLine + 1,
      message: `图表包含 ${nodeCount} 个节点，建议拆分为多个图`,
      suggestion: '考虑按功能域拆分为 2–3 个独立图表',
    });
  }

  return issues;
}

/**
 * 校验 markdown 文档中的所有 Mermaid 代码块
 */
export function validateMermaidBlocks(mdContent: string): MermaidIssue[] {
  const blocks = extractMermaidBlocks(mdContent);
  const allIssues: MermaidIssue[] = [];
  for (const block of blocks) {
    allIssues.push(...validateBlock(block));
  }
  return allIssues;
}
