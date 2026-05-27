import type { LanguageExtractor } from './types.js';
import { TypeScriptExtractor } from './typescript-extractor.js';
import { GoExtractor } from './go-extractor.js';
import { PythonExtractor } from './python-extractor.js';
import { CSharpExtractor } from './csharp-extractor.js';

export type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
export { findChild, findChildren, getStringValue, hasChildOfType } from './base-extractor.js';
export { TypeScriptExtractor } from './typescript-extractor.js';
export { GoExtractor } from './go-extractor.js';
export { PythonExtractor } from './python-extractor.js';
export { CSharpExtractor } from './csharp-extractor.js';

const builtinExtractors: LanguageExtractor[] = [
  new TypeScriptExtractor(),
  new GoExtractor(),
  new PythonExtractor(),
  new CSharpExtractor(),
];

const extractorMap = new Map<string, LanguageExtractor>();
for (const extractor of builtinExtractors) {
  for (const langId of extractor.languageIds) {
    extractorMap.set(langId, extractor);
  }
}

export function getExtractorForLanguage(language: string): LanguageExtractor | null {
  return extractorMap.get(language) ?? null;
}
