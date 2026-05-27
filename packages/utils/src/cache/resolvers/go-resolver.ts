import { toPosix, dirOf } from './context.js';

import type { ResolutionContext } from './context.js';

export function resolveGoImport(
  source: string,
  filePath: string,
  ctx: ResolutionContext,
): string[] {
  if (!source || typeof source !== 'string') return [];
  const src = source.trim();
  if (!src) return [];

  const importerDir = dirOf(toPosix(filePath));

  const nearestModuleDir = ctx.findNearestConfigDir(
    importerDir,
    ctx.goModules as unknown as Map<string, unknown>,
  );
  if (nearestModuleDir === undefined) return [];

  const moduleName = ctx.goModules.get(nearestModuleDir);
  if (!moduleName) return [];

  let remainder: string;
  if (src === moduleName) {
    remainder = '';
  } else if (src.startsWith(moduleName + '/')) {
    remainder = src.slice(moduleName.length + 1);
  } else {
    return [];
  }

  const subDir = toPosix(remainder);
  const targetDir = nearestModuleDir
    ? subDir ? `${nearestModuleDir}/${subDir}` : nearestModuleDir
    : subDir;
  const files = ctx.goFilesByDir.get(targetDir);
  return files ? [...files] : [];
}
