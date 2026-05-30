import type { WikiPage, SymbolManifest, PageFacts, ExportFact, FileSummary } from '@open-zread/types';

export function extractPageFacts(page: WikiPage, symbols: SymbolManifest): PageFacts {
  const associatedFiles = page.associatedFiles ?? [];

  const matchedSymbols = symbols.symbols.filter(s =>
    associatedFiles.some(af => {
      const normalizedAf = af.replace(/\/$/, '');
      return s.file === af || s.file === normalizedAf || s.file.startsWith(normalizedAf + '/');
    })
  );

  const seen = new Set<string>();
  const exports: ExportFact[] = [];
  for (const sym of matchedSymbols) {
    for (const fn of sym.functions) {
      if (!seen.has(fn.name)) {
        seen.add(fn.name);
        exports.push({
          name: fn.name,
          kind: 'function',
          signature: fn.signature,
          file: sym.file,
          ...(fn.doc ? { doc: fn.doc } : {}),
        });
      }
    }
    for (const exp of sym.exports) {
      if (!seen.has(exp)) {
        seen.add(exp);
        exports.push({
          name: exp,
          kind: 'unknown',
          signature: exp,
          file: sym.file,
        });
      }
    }
  }

  const fileSummaries: FileSummary[] = matchedSymbols.map(sym => ({
    file: sym.file,
    symbolCount: sym.functions.length + sym.exports.length,
    exports: sym.exports,
  }));

  const internalDepsSet = new Set<string>();
  const externalDepsSet = new Set<string>();
  for (const sym of matchedSymbols) {
    for (const imp of sym.imports) {
      if (imp.startsWith('.') || imp.startsWith('/')) {
        internalDepsSet.add(imp);
      } else if (!imp.startsWith('@open-zread')) {
        externalDepsSet.add(imp);
      }
    }
  }

  const matchedFiles = matchedSymbols.length;
  const confidence = associatedFiles.length > 0 ? Math.min(matchedFiles / associatedFiles.length, 1) : 0;

  return {
    pageSlug: page.slug,
    exports,
    fileSummaries,
    internalDeps: [...internalDepsSet],
    externalDeps: [...externalDepsSet],
    confidence,
  };
}
