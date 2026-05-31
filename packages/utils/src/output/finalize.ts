import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { WikiPage, PageFacts } from '@open-zread/types';
import { logger } from '../logger.js';
import { analyzeWiki } from './quality-audit.js';
import type { QualityReport } from './quality-audit.js';

export interface FinalizeOptions {
  audit?: boolean;
  pages?: WikiPage[];
  factsMap?: Map<string, PageFacts>;
}

export interface FinalizeResult {
  linksSanitized: number;
  docIndexBuilt: boolean;
  sidebarGenerated: boolean;
  auditReport?: QualityReport;
  errors: Array<{ step: string; error: string }>;
}

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

function sanitizeLinks(outputDir: string): number {
  const files = collectMdFiles(outputDir);
  let total = 0;
  const pattern = /file:\/\/[^\s)\]]+/g;

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    let count = 0;
    const updated = content.replace(pattern, (match) => {
      const pathPart = match.replace('file://', '');
      const slashIdx = pathPart.indexOf('/', 1);
      if (slashIdx >= 0) {
        count++;
        return pathPart.slice(slashIdx);
      }
      return match;
    });
    if (count > 0) {
      writeFileSync(filePath, updated, 'utf-8');
      total += count;
    }
  }

  return total;
}

function buildDocIndex(outputDir: string): void {
  const files = collectMdFiles(outputDir);
  const sourceToDocs: Record<string, string[]> = {};
  const docToSources: Record<string, string[]> = {};

  const codeBlockSourceRe = /\[Source:\s*([^\]]+)\]\(([^)]+)\)/g;
  const sectionSourceRe = /Sources:\s*\[([^\]]+)\]\(([^)]+)\)/g;

  for (const filePath of files) {
    const rel = relative(outputDir, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const sources: string[] = [];

    let match: RegExpExecArray | null;
    codeBlockSourceRe.lastIndex = 0;
    while ((match = codeBlockSourceRe.exec(content)) !== null) {
      const src = match[2];
      sources.push(src);
      if (!sourceToDocs[src]) sourceToDocs[src] = [];
      if (!sourceToDocs[src].includes(rel)) sourceToDocs[src].push(rel);
    }

    sectionSourceRe.lastIndex = 0;
    while ((match = sectionSourceRe.exec(content)) !== null) {
      const src = match[2];
      sources.push(src);
      if (!sourceToDocs[src]) sourceToDocs[src] = [];
      if (!sourceToDocs[src].includes(rel)) sourceToDocs[src].push(rel);
    }

    docToSources[rel] = sources;
  }

  const indexPath = join(outputDir, 'source-files-index.json');
  writeFileSync(indexPath, JSON.stringify({ sourceToDocs, docToSources }, null, 2), 'utf-8');
}

function generateSidebar(outputDir: string, pages: WikiPage[]): void {
  const sections = new Map<string, Map<string, WikiPage[]>>();

  for (const page of pages) {
    if (!sections.has(page.section)) {
      sections.set(page.section, new Map());
    }
    const groups = sections.get(page.section);
    if (!groups) continue;
    const groupKey = page.group ?? '';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)?.push(page);
  }

  const lines: string[] = [];

  for (const [section, groups] of sections) {
    lines.push(`- **${section}**`);
    for (const [group, groupPages] of groups) {
      if (group) {
        lines.push(`  - ${group}`);
        for (const page of groupPages) {
          lines.push(`    - [${page.title}](${page.file})`);
        }
      } else {
        for (const page of groupPages) {
          lines.push(`  - [${page.title}](${page.file})`);
        }
      }
    }
  }

  const sidebarPath = join(outputDir, '_sidebar.md');
  writeFileSync(sidebarPath, lines.join('\n') + '\n', 'utf-8');
}

export async function finalizeWiki(
  wikiPath: string,
  options?: FinalizeOptions,
): Promise<FinalizeResult> {
  const result: FinalizeResult = {
    linksSanitized: 0,
    docIndexBuilt: false,
    sidebarGenerated: false,
    errors: [],
  };

  try {
    result.linksSanitized = sanitizeLinks(wikiPath);
    logger.info(`[finalize] Sanitized ${result.linksSanitized} file:// links`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push({ step: 'sanitizeLinks', error: msg });
    logger.error(`[finalize] sanitizeLinks failed: ${msg}`);
  }

  try {
    buildDocIndex(wikiPath);
    result.docIndexBuilt = true;
    logger.info('[finalize] Built source-files-index.json');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push({ step: 'buildDocIndex', error: msg });
    logger.error(`[finalize] buildDocIndex failed: ${msg}`);
  }

  if (options?.pages?.length) {
    try {
      generateSidebar(wikiPath, options.pages);
      result.sidebarGenerated = true;
      logger.info('[finalize] Generated _sidebar.md');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ step: 'generateSidebar', error: msg });
      logger.error(`[finalize] generateSidebar failed: ${msg}`);
    }
  }

  if (options?.audit) {
    try {
      result.auditReport = analyzeWiki(wikiPath, options.pages, options.factsMap);
      logger.info(`[finalize] Audit complete: ${result.auditReport.totalDocs} docs analyzed`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ step: 'audit', error: msg });
      logger.error(`[finalize] audit failed: ${msg}`);
    }
  }

  return result;
}
