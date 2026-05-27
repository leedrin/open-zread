import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild, findChildren } from './base-extractor.js';

export class GoExtractor implements LanguageExtractor {
  readonly languageIds = ['go'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;
      if (node.type === 'import_declaration') {
        const specList = findChild(node, 'import_spec_list');
        if (specList) {
          const specs = findChildren(specList, 'import_spec');
          for (const spec of specs) {
            const imp = this.extractImportSpec(spec);
            if (imp) imports.push(imp);
          }
        } else {
          const spec = findChild(node, 'import_spec');
          if (spec) {
            const imp = this.extractImportSpec(spec);
            if (imp) imports.push(imp);
          }
        }
      }
    }
    return { imports };
  }

  private extractImportSpec(spec: TreeSitterNode): ImportInfo | null {
    const pathNode = spec.childForFieldName('path');
    if (!pathNode) return null;
    const pathContent = findChild(pathNode, 'interpreted_string_literal_content');
    const source = pathContent ? pathContent.text : pathNode.text.replace(/^"|"$/g, '');
    const nameNode = spec.childForFieldName('name');
    let specifier: string;
    if (nameNode) {
      specifier = nameNode.text;
    } else {
      const parts = source.split('/');
      specifier = parts[parts.length - 1];
    }
    return { source, specifiers: [specifier], lineNumber: spec.startPosition.row + 1 };
  }
}
