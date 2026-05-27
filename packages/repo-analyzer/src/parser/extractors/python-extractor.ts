import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild, findChildren } from './base-extractor.js';

export class PythonExtractor implements LanguageExtractor {
  readonly languageIds = ['python'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_statement') {
        this.extractImport(node, imports);
      } else if (node.type === 'import_from_statement') {
        this.extractFromImport(node, imports);
      }
    }
    return { imports };
  }

  private extractImport(node: TreeSitterNode, imports: ImportInfo[]): void {
    const dottedNames = findChildren(node, 'dotted_name');
    const aliasedImports = findChildren(node, 'aliased_import');
    for (const dn of dottedNames) {
      imports.push({
        source: dn.text,
        specifiers: [dn.text],
        lineNumber: node.startPosition.row + 1,
      });
    }
    for (const ai of aliasedImports) {
      const dottedName = findChild(ai, 'dotted_name');
      const alias = ai.children.find((c) => c.type === 'identifier');
      if (dottedName) {
        imports.push({
          source: dottedName.text,
          specifiers: [alias ? alias.text : dottedName.text],
          lineNumber: node.startPosition.row + 1,
        });
      }
    }
  }

  private extractFromImport(node: TreeSitterNode, imports: ImportInfo[]): void {
    const moduleNode = node.childForFieldName('module_name');
    const source = moduleNode ? moduleNode.text : '';
    const moduleNodeId = moduleNode?.id;
    const specifiers: string[] = [];
    const allDottedNames = findChildren(node, 'dotted_name');
    for (const dn of allDottedNames) {
      if (dn.id === moduleNodeId) continue;
      specifiers.push(dn.text);
    }
    const aliasedImports = findChildren(node, 'aliased_import');
    for (const ai of aliasedImports) {
      const alias = ai.children.find((c) => c.type === 'identifier');
      if (alias) specifiers.push(alias.text);
    }
    if (findChild(node, 'wildcard_import')) {
      specifiers.push('*');
    }
    imports.push({
      source,
      specifiers,
      lineNumber: node.startPosition.row + 1,
    });
  }
}
