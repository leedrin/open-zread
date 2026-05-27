import { posix } from 'path';
import { toPosix, dirOf, resolveRelative } from './context.js';
import type { ResolutionContext } from './context.js';

const TS_EXT_PROBES = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
];

function probeWithExtensions(basePath: string, fileSet: Set<string>): string | null {
  if (!basePath) return null;
  if (fileSet.has(basePath)) return basePath;
  for (const ext of TS_EXT_PROBES) {
    const candidate = basePath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function matchTsAlias(alias: string, src: string): string | null {
  const starIdx = alias.indexOf('*');
  if (starIdx === -1) {
    return src === alias ? '' : null;
  }
  const prefix = alias.slice(0, starIdx);
  const suffix = alias.slice(starIdx + 1);
  if (!src.startsWith(prefix)) return null;
  if (!src.endsWith(suffix)) return null;
  if (src.length < prefix.length + suffix.length) return null;
  return src.slice(prefix.length, src.length - suffix.length);
}

function applyTsAlias(target: string, wildcard: string): string {
  const starIdx = target.indexOf('*');
  if (starIdx === -1) return target;
  return target.slice(0, starIdx) + wildcard + target.slice(starIdx + 1);
}

export function resolveTsJsImport(
  source: string,
  filePath: string,
  ctx: ResolutionContext,
): string | null {
  if (!source || typeof source !== 'string') return null;
  const src = source.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(filePath));

  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  const tsConfigDir = ctx.findNearestConfigDir(importerDir, ctx.tsConfigs as unknown as Map<string, unknown>);
  if (tsConfigDir !== undefined) {
    const tsConfig = ctx.tsConfigs.get(tsConfigDir);
    if (tsConfig && tsConfig.paths && tsConfig.paths.size > 0) {
      const { baseUrl, paths } = tsConfig;
      for (const [alias, targets] of paths) {
        const aliasMatch = matchTsAlias(alias, src);
        if (aliasMatch === null) continue;
        for (const target of targets) {
          const mapped = applyTsAlias(target, aliasMatch);
          const normalizedBase = baseUrl === '.' || baseUrl === '' ? '' : toPosix(baseUrl);
          const relativeToConfig = normalizedBase ? posix.join(normalizedBase, mapped) : mapped;
          const candidate = posix.normalize(
            tsConfigDir ? posix.join(tsConfigDir, relativeToConfig) : relativeToConfig,
          );
          if (candidate.startsWith('..')) continue;
          const probed = probeWithExtensions(candidate, ctx.fileSet);
          if (probed) return probed;
        }
      }
    }
  }

  return null;
}
