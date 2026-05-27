import type { ImportInfo } from '@open-zread/types';
import type { ResolutionContext } from './context.js';
import { resolveTsJsImport } from './ts-resolver.js';
import { resolveGoImport } from './go-resolver.js';
import { resolvePythonImport } from './python-resolver.js';
import { resolveCSharpImport } from './csharp-resolver.js';

const TS_JS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'vue']);

export function resolveImport(
  importInfo: ImportInfo,
  filePath: string,
  language: string,
  ctx: ResolutionContext,
): string[] {
  const src = importInfo.source;
  if (TS_JS_LANGS.has(language)) {
    const out = resolveTsJsImport(src, filePath, ctx);
    return out ? [out] : [];
  }
  if (language === 'python') {
    return resolvePythonImport(src, importInfo.specifiers, filePath, ctx);
  }
  if (language === 'go') {
    return resolveGoImport(src, filePath, ctx);
  }
  if (language === 'csharp') {
    return resolveCSharpImport(src, filePath, ctx);
  }
  return [];
}
