import type { ImportInfo } from '@open-zread/types';
import type { LanguageExtractor, TreeSitterNode, ExtractionResult } from './types.js';
import { findChild } from './base-extractor.js';

function extractUsingSource(node: TreeSitterNode): string | null {
  if (findChild(node, '=')) {
    const qualifiedName = findChild(node, 'qualified_name');
    return qualifiedName ? qualifiedName.text : null;
  }
  const qualifiedName = findChild(node, 'qualified_name');
  if (qualifiedName) return qualifiedName.text;
  const identifier = findChild(node, 'identifier');
  return identifier ? identifier.text : null;
}

function lastComponent(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

export class CSharpExtractor implements LanguageExtractor {
  readonly languageIds = ['csharp'];

  extractStructure(rootNode: TreeSitterNode): ExtractionResult {
    const imports: ImportInfo[] = [];
    this.walkTopLevel(rootNode, imports);
    return { imports };
  }

  private walkTopLevel(node: TreeSitterNode, imports: ImportInfo[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (child.type === 'using_directive') {
        const source = extractUsingSource(child);
        if (source) {
          imports.push({
            source,
            specifiers: [lastComponent(source)],
            lineNumber: child.startPosition.row + 1,
          });
        }
      } else if (child.type === 'namespace_declaration') {
        const body = child.childForFieldName('body');
        if (body) this.walkTopLevel(body, imports);
      }
    }
  }
}
