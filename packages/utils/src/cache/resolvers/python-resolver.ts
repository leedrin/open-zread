import { toPosix, dirOf } from './context.js';
import type { ResolutionContext } from './context.js';

function resolvePythonProbe(
  moduleParts: string[],
  specifiers: string[],
  ctx: ResolutionContext,
): string[] {
  if (moduleParts.length === 0) return [];
  const base = moduleParts.join('/');
  const matches: string[] = [];

  const moduleFile = `${base}.py`;
  const packageInit = `${base}/__init__.py`;

  if (ctx.fileSet.has(moduleFile)) {
    matches.push(moduleFile);
    return matches;
  }
  if (ctx.fileSet.has(packageInit)) {
    matches.push(packageInit);
    if (Array.isArray(specifiers)) {
      for (const spec of specifiers) {
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = `${base}/${spec}.py`;
        const subInit = `${base}/${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
    }
    return matches;
  }
  return [];
}

export function resolvePythonImport(
  source: string,
  specifiers: string[],
  filePath: string,
  ctx: ResolutionContext,
): string[] {
  if (typeof source !== 'string') return [];
  const src = source;
  const importerDir = dirOf(toPosix(filePath));

  let dots = 0;
  while (dots < src.length && src.charCodeAt(dots) === 0x2e) dots++;
  const tail = src.slice(dots);
  const tailSegments = tail ? tail.split('.').filter(Boolean) : [];

  if (dots > 0) {
    const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
    const dropLevels = dots - 1;
    if (dropLevels > importerParts.length) return [];
    const baseParts = importerParts.slice(0, importerParts.length - dropLevels);

    if (tailSegments.length === 0) {
      if (!Array.isArray(specifiers) || specifiers.length === 0) return [];
      const base = baseParts.join('/');
      const matches: string[] = [];
      for (const spec of specifiers) {
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = base ? `${base}/${spec}.py` : `${spec}.py`;
        const subInit = base ? `${base}/${spec}/__init__.py` : `${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
      return matches;
    }

    const moduleParts = baseParts.concat(tailSegments);
    return resolvePythonProbe(moduleParts, specifiers, ctx);
  }

  if (tailSegments.length === 0) return [];

  const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
  for (let i = importerParts.length; i >= 0; i--) {
    const rootParts = importerParts.slice(0, i);
    const candidateModule = rootParts.concat(tailSegments);
    const matches = resolvePythonProbe(candidateModule, specifiers, ctx);
    if (matches.length > 0) return matches;
  }
  return [];
}
