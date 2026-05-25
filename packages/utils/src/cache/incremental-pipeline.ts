import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type {
  FileManifest, CacheManifest, SymbolManifest,
  IncrementalPlan, AffectedDoc, WikiPage, PageFacts,
} from '@open-zread/types';
import { diffManifests } from './index.js';
import { buildDependencyGraph, computeTransitiveImpact } from './dependency-graph.js';
import { readJsonFile } from '../file-io.js';

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
  } catch { /* skip unreadable dirs */ }
  return files;
}

export function buildDocToDocDeps(wikiPath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const files = collectMdFiles(wikiPath);

  const linkRe = /\[([^\]]+)\]\((?!http|#)([^)]+\.md)\)/g;

  for (const filePath of files) {
    const rel = relative(wikiPath, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const deps: string[] = [];

    linkRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(content)) !== null) {
      const linkTarget = match[2];
      if (!linkTarget.startsWith('Source:') && !linkTarget.startsWith('/')) {
        deps.push(linkTarget);
      }
    }

    if (deps.length > 0) {
      result.set(rel, deps);
    }
  }

  return result;
}

function checkSignatureChanged(
  file: string,
  previousFacts?: Map<string, PageFacts>,
): boolean {
  if (!previousFacts) return true;
  return !previousFacts.has(file);
}

interface IncrementalPlanOptions {
  cached: CacheManifest;
  current: FileManifest;
  symbols: SymbolManifest;
  wikiPath: string;
  pages: WikiPage[];
  packageAliases?: Record<string, string>;
  previousFacts?: Map<string, PageFacts>;
}

export async function buildIncrementalPlan(options: IncrementalPlanOptions): Promise<IncrementalPlan> {
  const { cached, current, symbols, wikiPath, pages, packageAliases, previousFacts } = options;

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

  const depGraph = buildDependencyGraph(symbols, packageAliases);
  const impacted = computeTransitiveImpact(allChanged, depGraph, 3);

  const indexPath = join(wikiPath, 'source-files-index.json');
  let sourceToDocs: Record<string, string[]> = {};
  try {
    if (existsSync(indexPath)) {
      const data = await readJsonFile<{ sourceToDocs: Record<string, string[]> }>(indexPath);
      sourceToDocs = data?.sourceToDocs ?? {};
    }
  } catch { /* index file may not exist yet */ }

  const docDeps = buildDocToDocDeps(wikiPath);

  const affectedDocs: AffectedDoc[] = [];
  const affectedDocPaths = new Set<string>();

  const pageMap = new Map<string, WikiPage>();
  for (const p of pages) {
    pageMap.set(`${p.section}/${p.file}`, p);
  }

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

  for (const file of removed) {
    const docs = sourceToDocs[file] ?? [];
    for (const docPath of docs) {
      if (affectedDocPaths.has(docPath)) continue;
      affectedDocPaths.add(docPath);

      const page = pageMap.get(docPath);
      if (!page) continue;

      affectedDocs.push({
        docPath,
        page,
        reason: 'source_changed',
        updateStrength: 'full',
        triggeredBy: [file],
        signatureChanged: true,
      });
    }
  }

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
