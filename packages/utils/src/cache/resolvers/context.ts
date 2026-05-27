import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

function toPosix(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).join('/');
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function resolveRelative(dir: string, rel: string): string {
  const parts = (dir ? dir.split('/').filter(Boolean) : []).concat(
    rel.split('/').filter(Boolean),
  );
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return '';
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function findNearestConfigDir(startDir: string, configMap: Map<string, unknown>): string | undefined {
  if (configMap.size === 0) return undefined;
  const parts = startDir ? startDir.split('/').filter(Boolean) : [];
  for (let i = parts.length; i >= 0; i--) {
    const ancestor = parts.slice(0, i).join('/');
    if (configMap.has(ancestor)) return ancestor;
  }
  return undefined;
}

interface TsConfig {
  baseUrl: string;
  paths: Map<string, string[]>;
}

function parseTsConfigText(raw: string): TsConfig | null {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const compilerOptions = (parsed?.compilerOptions ?? {}) as Record<string, unknown>;
  const baseUrl = (typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.') as string;
  const paths = new Map<string, string[]>();
  if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
    for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
      if (Array.isArray(targets)) {
        paths.set(alias, targets);
      }
    }
  }
  return { baseUrl, paths };
}

function loadTsConfigs(projectRoot: string, filePaths: string[]): Map<string, TsConfig> {
  const out = new Map<string, TsConfig>();
  for (const p of filePaths) {
    const posixPath = toPosix(p);
    const base = posixPath.includes('/') ? posixPath.slice(posixPath.lastIndexOf('/') + 1) : posixPath;
    if (base !== 'tsconfig.json') continue;
    const absPath = join(projectRoot, posixPath);
    if (!existsSync(absPath)) continue;
    try {
      const raw = readFileSync(absPath, 'utf-8');
      const parsed = parseTsConfigText(raw);
      if (parsed) out.set(dirOf(posixPath), parsed);
    } catch {
      // skip unreadable tsconfig
    }
  }
  return out;
}

function loadGoModules(projectRoot: string, filePaths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of filePaths) {
    const posixPath = toPosix(p);
    const base = posixPath.includes('/') ? posixPath.slice(posixPath.lastIndexOf('/') + 1) : posixPath;
    if (base !== 'go.mod') continue;
    const absPath = join(projectRoot, posixPath);
    if (!existsSync(absPath)) continue;
    try {
      const raw = readFileSync(absPath, 'utf-8');
      let moduleName = '';
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.replace(/\/\/.*$/, '').trim();
        if (!trimmed.startsWith('module ')) continue;
        moduleName = trimmed.slice('module '.length).trim();
        break;
      }
      if (moduleName) out.set(dirOf(posixPath), moduleName);
    } catch {
      // skip unreadable go.mod
    }
  }
  return out;
}

function buildSuffixIndex(
  filePaths: string[],
  extPredicate: (p: string) => boolean,
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const p of filePaths) {
    const posixPath = toPosix(p);
    if (!extPredicate(posixPath)) continue;
    const parts = posixPath.split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      if (!idx.has(suffix)) idx.set(suffix, []);
      idx.get(suffix)?.push(posixPath);
    }
  }
  for (const arr of idx.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }
  return idx;
}

export interface ResolutionContext {
  fileSet: Set<string>;
  tsConfigs: Map<string, TsConfig>;
  goModules: Map<string, string>;
  goFilesByDir: Map<string, string[]>;
  csSuffixIndex: Map<string, string[]>;
  csFilesByDir: Map<string, string[]>;
  findNearestConfigDir: (startDir: string, configMap: Map<string, unknown>) => string | undefined;
}

export function buildResolutionContext(
  projectRoot: string,
  filePaths: string[],
): ResolutionContext {
  const fileSet = new Set(filePaths.map((p) => toPosix(p)));
  const tsConfigs = loadTsConfigs(projectRoot, filePaths);
  const goModules = loadGoModules(projectRoot, filePaths);

  const goFilesByDir = new Map<string, string[]>();
  for (const p of filePaths) {
    if (!p.endsWith('.go')) continue;
    const posixPath = toPosix(p);
    const d = dirOf(posixPath);
    if (!goFilesByDir.has(d)) goFilesByDir.set(d, []);
    goFilesByDir.get(d)?.push(posixPath);
  }
  for (const arr of goFilesByDir.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  const csSuffixIndex = buildSuffixIndex(filePaths, (p) => p.endsWith('.cs'));

  const csFilesByDir = new Map<string, string[]>();
  for (const p of filePaths) {
    if (!p.endsWith('.cs')) continue;
    const posixPath = toPosix(p);
    const d = dirOf(posixPath);
    if (!csFilesByDir.has(d)) csFilesByDir.set(d, []);
    csFilesByDir.get(d)?.push(posixPath);
  }
  for (const arr of csFilesByDir.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  return {
    fileSet,
    tsConfigs,
    goModules,
    goFilesByDir,
    csSuffixIndex,
    csFilesByDir,
    findNearestConfigDir,
  };
}

export { toPosix, dirOf, resolveRelative, findNearestConfigDir };
