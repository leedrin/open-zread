import type { ResolutionContext } from './context.js';

function resolveDottedFqn(
  fqn: string,
  ext: string,
  suffixIndex: Map<string, string[]>,
): string[] {
  if (!fqn || typeof fqn !== 'string') return [];
  const trimmed = fqn.replace(/\.\*$/, '');
  if (!trimmed) return [];
  const filePart = trimmed.replace(/\./g, '/') + ext;
  const matches = suffixIndex.get(filePart);
  return matches ? [...matches] : [];
}

export function resolveCSharpImport(
  source: string,
  _filePath: string,
  ctx: ResolutionContext,
): string[] {
  if (!source || typeof source !== 'string') return [];
  const fqn = source.replace(/\.\*$/, '').trim();
  if (!fqn) return [];

  const slashPath = fqn.replace(/\./g, '/');

  const dirMatch = ctx.csFilesByDir.get(slashPath);
  if (dirMatch && dirMatch.length > 0) return [...dirMatch];

  const literalMatch = ctx.csFilesByDir.get(fqn);
  if (literalMatch && literalMatch.length > 0) return [...literalMatch];

  for (const [dirPath, files] of ctx.csFilesByDir) {
    if (dirPath.endsWith('/' + slashPath) || dirPath.endsWith('/' + fqn)) {
      return [...files];
    }
  }

  const singleFile = resolveDottedFqn(fqn, '.cs', ctx.csSuffixIndex);
  if (singleFile.length > 0) return singleFile;

  return [];
}
