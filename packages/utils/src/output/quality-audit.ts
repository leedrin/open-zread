import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { scanSecrets } from './audit-docs.js';
import type { SecretLeak } from './audit-docs.js';
import type { WikiPage } from '@open-zread/types';

export interface MermaidIssue {
  severity: 'warn' | 'error';
  line: number;
  message: string;
  suggestion: string;
}

export type QualityLevel = 'professional' | 'standard' | 'basic';

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

export interface DocQuality {
  filePath: string;
  metrics: DocMetrics;
  level: QualityLevel;
  score: number;
}

export interface QualityReport {
  totalDocs: number;
  professionalCount: number;
  standardCount: number;
  basicCount: number;
  docs: DocQuality[];
  summary: {
    totalDiagrams: number;
    totalCodeBlocks: number;
    totalSourceLinks: number;
    totalSecretLeaks: number;
    totalMermaidIssues: number;
  };
}

const MERMAID_KEYWORDS = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
]);

const RESERVED_KEYWORDS = new Set([
  'end',
  'else',
  'opt',
  'loop',
  'par',
  'alt',
  'rect',
  'critical',
  'break',
  'and',
  'or',
  'not',
  'as',
  'is',
  'to',
  'of',
  'in',
  'for',
  'if',
  'then',
  'else',
  'while',
  'switch',
  'case',
  'default',
  'do',
  'try',
  'catch',
  'finally',
  'class',
  'public',
  'private',
  'protected',
]);

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

function extractMermaidBlocks(lines: string[]): Array<{ startLine: number; content: string[] }> {
  const blocks: Array<{ startLine: number; content: string[] }> = [];
  let inMermaid = false;
  let currentBlock: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```mermaid')) {
      inMermaid = true;
      startLine = i + 1;
      currentBlock = [];
    } else if (trimmed === '```' && inMermaid) {
      inMermaid = false;
      blocks.push({ startLine, content: [...currentBlock] });
      currentBlock = [];
    } else if (inMermaid) {
      currentBlock.push(lines[i]);
    }
  }

  return blocks;
}

function extractDiagramTypes(mermaidBlocks: Array<{ startLine: number; content: string[] }>): string[] {
  const types = new Set<string>();
  for (const block of mermaidBlocks) {
    for (const line of block.content) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('---')) continue;
      const keyword = trimmed.split(/\s/)[0]?.split('[')[0]?.split('(')[0] ?? '';
      if (MERMAID_KEYWORDS.has(keyword)) {
        types.add(keyword);
      }
      break;
    }
  }
  return [...types];
}

function validateMermaidBlock(block: { startLine: number; content: string[] }): MermaidIssue[] {
  const issues: MermaidIssue[] = [];
  const { startLine, content } = block;
  const allIds = new Set<string>();
  const subgraphIds = new Set<string>();

  let nodeCount = 0;

  for (let i = 0; i < content.length; i++) {
    const trimmed = content[i].trim();
    const lineNum = startLine + i;

    if (!trimmed || trimmed.startsWith('%%')) continue;

    const subgraphMatch = trimmed.match(/^subgraph\s+(\S+)/);
    if (subgraphMatch) {
      const id = subgraphMatch[1];
      subgraphIds.add(id);
      if (allIds.has(id)) {
        issues.push({
          severity: 'error',
          line: lineNum,
          message: `Subgraph ID "${id}" conflicts with an existing node ID`,
          suggestion: `Rename the subgraph to a unique identifier`,
        });
      }
      allIds.add(id);
      continue;
    }

    if (trimmed === 'end') continue;

    const nodeMatches = trimmed.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(?:\[|\(|\{|\(|<|--|-->|---|->|-\.|==|::)/g);
    for (const match of nodeMatches) {
      const nodeId = match[1];
      if (RESERVED_KEYWORDS.has(nodeId.toLowerCase())) {
        issues.push({
          severity: 'warn',
          line: lineNum,
          message: `Node ID "${nodeId}" uses a reserved keyword`,
          suggestion: `Use a descriptive name instead of a reserved keyword`,
        });
      }
      allIds.add(nodeId);
      nodeCount++;
    }

    const labelMatches = trimmed.matchAll(/["']([^"']*["'])/g);
    for (const labelMatch of labelMatches) {
      const full = labelMatch[0];
      if (full.startsWith('"') && full.endsWith('"')) {
        const inner = full.slice(1, -1);
        if (inner.includes('"')) {
          issues.push({
            severity: 'error',
            line: lineNum,
            message: `Unescaped double quote inside label: ${full}`,
            suggestion: `Use &quot; or #quot; to escape quotes in labels`,
          });
        }
      }
    }
  }

  if (nodeCount > 20) {
    issues.push({
      severity: 'warn',
      line: startLine,
      message: `Diagram has ${nodeCount} nodes, which may be hard to read`,
      suggestion: `Consider splitting into multiple smaller diagrams`,
    });
  }

  return issues;
}

export function analyzeDoc(filePath: string): DocMetrics {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const lineCount = lines.length;

  const mermaidBlocks = extractMermaidBlocks(lines);
  const diagramCount = mermaidBlocks.length;
  const diagramTypes = extractDiagramTypes(mermaidBlocks);

  let codeBlockCount = 0;
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        if (trimmed !== '```mermaid' && !trimmed.startsWith('```mermaid ')) {
          codeBlockCount++;
        }
      } else if (trimmed === '```') {
        inFence = false;
      }
    }
  }

  const sourceMatches = content.match(/Sources:|\[Source:/g);
  const sourceLinkCount = sourceMatches ? sourceMatches.length : 0;

  let codeBlockSourceLinks = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\[Source:/.test(lines[i].trim())) {
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        if (lines[i + j].trim().startsWith('```')) {
          codeBlockSourceLinks++;
          break;
        }
      }
    }
  }

  const emptySections: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{2,3})\s+(.+)/);
    if (headingMatch) {
      const headingText = headingMatch[0];
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
        nextNonEmpty++;
      }
      if (
        nextNonEmpty >= lines.length ||
        /^#{1,6}\s+/.test(lines[nextNonEmpty])
      ) {
        emptySections.push(headingText.trim());
      }
    }
  }

  const secretLeaks = scanSecrets(filePath, content);

  const mermaidIssues: MermaidIssue[] = [];
  for (const block of mermaidBlocks) {
    mermaidIssues.push(...validateMermaidBlock(block));
  }

  return {
    filePath,
    lineCount,
    diagramCount,
    diagramTypes,
    codeBlockCount,
    sourceLinkCount,
    codeBlockSourceLinks,
    emptySections,
    secretLeaks,
    mermaidIssues,
  };
}

export function scoreByComplexity(
  metrics: DocMetrics,
  page?: WikiPage,
): { level: QualityLevel; score: number } {
  let diagramScore = 1;
  if (metrics.diagramCount >= 2 && metrics.diagramTypes.length >= 2) {
    diagramScore = 3;
  } else if (metrics.diagramCount >= 1) {
    diagramScore = 2;
  }

  let codeBlockScore = 1;
  if (metrics.codeBlockCount >= 5) {
    codeBlockScore = 3;
  } else if (metrics.codeBlockCount >= 2) {
    codeBlockScore = 2;
  }

  let sourceLinkScore = 1;
  if (metrics.sourceLinkCount >= 3 && metrics.codeBlockSourceLinks >= 1) {
    sourceLinkScore = 3;
  } else if (metrics.sourceLinkCount >= 1) {
    sourceLinkScore = 2;
  }

  const securityScore = metrics.secretLeaks.length === 0 ? 3 : 1;

  let mermaidScore = 3;
  const errorCount = metrics.mermaidIssues.filter((i) => i.severity === 'error').length;
  const warnCount = metrics.mermaidIssues.filter((i) => i.severity === 'warn').length;
  if (errorCount > 0) {
    mermaidScore = 1;
  } else if (warnCount <= 1) {
    mermaidScore = 2;
  }

  const targetLines = page
    ? (page.level === 'Advanced' || (page.associatedFiles?.length ?? 0) >= 5)
      ? 400
      : (page.level === 'Beginner' && (page.associatedFiles?.length ?? 0) <= 2)
        ? 80
        : 200
    : 200;
  let lengthScore = 1;
  if (metrics.lineCount >= targetLines) {
    lengthScore = 3;
  } else if (metrics.lineCount >= targetLines * 0.5) {
    lengthScore = 2;
  }

  const totalScore = diagramScore + codeBlockScore + sourceLinkScore + securityScore + mermaidScore + lengthScore;

  let level: QualityLevel;

  const associatedFilesCount = page?.associatedFiles?.length ?? 0;

  if (
    page?.level === 'Advanced' ||
    associatedFilesCount >= 5
  ) {
    if (totalScore >= 15) level = 'professional';
    else if (totalScore >= 10) level = 'standard';
    else level = 'basic';
  } else if (
    page?.level === 'Beginner' &&
    associatedFilesCount <= 2
  ) {
    if (totalScore >= 7) level = 'professional';
    else if (totalScore >= 5) level = 'standard';
    else level = 'basic';
  } else {
    if (totalScore >= 12) level = 'professional';
    else if (totalScore >= 8) level = 'standard';
    else level = 'basic';
  }

  return { level, score: totalScore };
}

export function analyzeWiki(wikiPath: string, pages?: WikiPage[]): QualityReport {
  if (!existsSync(wikiPath)) {
    return {
      totalDocs: 0,
      professionalCount: 0,
      standardCount: 0,
      basicCount: 0,
      docs: [],
      summary: {
        totalDiagrams: 0,
        totalCodeBlocks: 0,
        totalSourceLinks: 0,
        totalSecretLeaks: 0,
        totalMermaidIssues: 0,
      },
    };
  }

  const mdFiles = collectMdFiles(wikiPath);

  const pageMap = new Map<string, WikiPage>();
  if (pages) {
    for (const p of pages) {
      pageMap.set(p.file, p);
    }
  }

  const docs: DocQuality[] = [];
  let professionalCount = 0;
  let standardCount = 0;
  let basicCount = 0;
  let totalDiagrams = 0;
  let totalCodeBlocks = 0;
  let totalSourceLinks = 0;
  let totalSecretLeaks = 0;
  let totalMermaidIssues = 0;

  for (const filePath of mdFiles) {
    try {
      const metrics = analyzeDoc(filePath);
      const relativeFile = filePath.replace(wikiPath + '/', '').replace(wikiPath + '\\', '');
      const page = pageMap.get(relativeFile);
      const { level, score } = scoreByComplexity(metrics, page);

      docs.push({ filePath, metrics, level, score });

      if (level === 'professional') professionalCount++;
      else if (level === 'standard') standardCount++;
      else basicCount++;

      totalDiagrams += metrics.diagramCount;
      totalCodeBlocks += metrics.codeBlockCount;
      totalSourceLinks += metrics.sourceLinkCount;
      totalSecretLeaks += metrics.secretLeaks.length;
      totalMermaidIssues += metrics.mermaidIssues.length;
    } catch {
      // skip unreadable files
    }
  }

  return {
    totalDocs: docs.length,
    professionalCount,
    standardCount,
    basicCount,
    docs,
    summary: {
      totalDiagrams,
      totalCodeBlocks,
      totalSourceLinks,
      totalSecretLeaks,
      totalMermaidIssues,
    },
  };
}
