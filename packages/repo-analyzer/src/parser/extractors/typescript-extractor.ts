import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { getStringValue } from './base-extractor.js';

function extractImportSpecifiers(importClause: TreeSitterNode): string[] {
  const specifiers: string[] = [];
  for (let i = 0; i < importClause.childCount; i++) {
    const child = importClause.child(i);
    if (!child) continue;
    if (child.type === 'named_imports') {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j);
        if (spec && spec.type === 'import_specifier') {
          const alias = spec.childForFieldName('alias');
          const name = spec.childForFieldName('name');
          specifiers.push(alias ? alias.text : name ? name.text : spec.text);
        }
      }
    } else if (child.type === 'namespace_import') {
      const ident = child.children.find((c) => c.type === 'identifier');
      if (ident) specifiers.push('* as ' + ident.text);
    } else if (child.type === 'identifier') {
      specifiers.push(child.text);
    }
  }
  return specifiers;
}

function extractImport(node: TreeSitterNode): ImportInfo | null {
  const sourceNode = node.children.find((c) => c.type === 'string');
  if (!sourceNode) return null;
  const source = getStringValue(sourceNode);
  const specifiers: string[] = [];
  const importClause = node.children.find((c) => c.type === 'import_clause');
  if (importClause) {
    specifiers.push(...extractImportSpecifiers(importClause));
  }
  return { source, specifiers, lineNumber: node.startPosition.row + 1 };
}

export class TypeScriptExtractor implements LanguageExtractor {
  readonly languageIds = ['typescript', 'javascript'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_statement') {
        const imp = extractImport(node);
        if (imp) imports.push(imp);
      } else if (node.type === 'export_statement') {
        for (let j = 0; j < node.childCount; j++) {
          const child = node.child(j);
          if (child && child.type === 'import_statement') {
            const imp = extractImport(child);
            if (imp) imports.push(imp);
          }
        }
      }
    }
    return { imports };
  }
}
