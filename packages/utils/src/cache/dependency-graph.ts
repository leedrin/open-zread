import { join, dirname, normalize } from 'path';
import type { SymbolManifest, DependencyGraph, DependencyEdge } from '@open-zread/types';
import { getCacheDir, readJsonFile, writeJsonFile, ensureDir } from '../file-io.js';
import { CACHE_FILES } from './constants.js';

function extractImportPath(importStatement: string): string | null {
  const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function resolveImportPath(
  importPath: string,
  fromFile: string,
  packageAliases?: Record<string, string>,
): string | null {
  if (importPath.startsWith('.')) {
    const dir = dirname(fromFile);
    let resolved = normalize(join(dir, importPath));
    if (!/\.[a-z]+$/.test(resolved)) {
      resolved += '.ts';
    }
    return resolved;
  }

  if (packageAliases) {
    const basePath = packageAliases[importPath];
    if (basePath) return basePath;
    for (const [alias, target] of Object.entries(packageAliases)) {
      if (importPath.startsWith(alias + '/')) {
        return normalize(join(target, importPath.slice(alias.length + 1)));
      }
    }
  }

  return null;
}

export function buildDependencyGraph(
  symbols: SymbolManifest,
  packageAliases?: Record<string, string>,
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

export function computeTransitiveImpact(
  sources: string[],
  graph: DependencyGraph,
  maxDepth: number = 3,
): Map<string, { depth: number; reason: 'source_changed' | 'dep_changed' }> {
  const result = new Map<string, { depth: number; reason: 'source_changed' | 'dep_changed' }>();

  for (const source of sources) {
    result.set(source, { depth: 0, reason: 'source_changed' });
  }

  const queue: Array<{ file: string; depth: number }> = sources.map(s => ({ file: s, depth: 0 }));

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth >= maxDepth) continue;

    const dependents = graph.reverse[item.file] ?? [];
    for (const dep of dependents) {
      if (result.has(dep)) continue;
      result.set(dep, { depth: item.depth + 1, reason: 'dep_changed' });
      queue.push({ file: dep, depth: item.depth + 1 });
    }
  }

  return result;
}

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
