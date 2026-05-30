import type { TreeSitterNode } from './extractors/types.js';

type DocStyle = 'jsdoc' | 'python' | 'go' | 'csharp';

export interface DocExtractor {
  readonly languageIds: string[];
  extractDocForNode(node: TreeSitterNode, source: string): string | undefined;
}

export function normalizeDoc(raw: string, style: DocStyle): string {
  let text = raw.trim();

  if (style === 'jsdoc') {
    if (text.startsWith('/**') && text.endsWith('*/')) {
      text = text.slice(3, -2);
    } else if (text.startsWith('/*') && text.endsWith('*/')) {
      text = text.slice(2, -2);
    }
    text = text
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n');
  } else if (style === 'python') {
    if ((text.startsWith('"""') && text.endsWith('"""')) ||
        (text.startsWith("'''") && text.endsWith("'''"))) {
      text = text.slice(3, -3);
    }
  } else if (style === 'go') {
    text = text
      .split('\n')
      .map(line => line.replace(/^\/\/\s?/, ''))
      .join('\n');
  } else if (style === 'csharp') {
    text = text
      .split('\n')
      .map(line => line.replace(/^\/\/\/\s?/, ''))
      .join('\n');
  }

  return text.trim();
}

const MAX_DOC_CHARS = 800;

export function truncateDoc(doc: string, maxChars = MAX_DOC_CHARS): string {
  if (doc.length <= maxChars) return doc;
  return doc.slice(0, maxChars) + '...（已截断）';
}

class TypeScriptDocExtractor implements DocExtractor {
  readonly languageIds = ['typescript', 'javascript', 'tsx', 'jsx'];

  extractDocForNode(node: TreeSitterNode, _source: string): string | undefined {
    let sibling = node.previousNamedSibling ?? node.previousSibling;
    while (sibling) {
      if (sibling.type === 'comment') {
        const text = sibling.text;
        if (text.startsWith('/**')) {
          return truncateDoc(normalizeDoc(text, 'jsdoc'));
        }
        return undefined;
      }
      if (sibling.type !== '\n' && sibling.text.trim() !== '') {
        return undefined;
      }
      sibling = sibling.previousSibling;
    }
    return undefined;
  }
}

class PythonDocExtractor implements DocExtractor {
  readonly languageIds = ['python'];

  extractDocForNode(node: TreeSitterNode, _source: string): string | undefined {
    const body = node.childForFieldName('body');
    if (!body || body.childCount === 0) return undefined;

    const firstStmt = body.child(0);
    if (!firstStmt || firstStmt.type !== 'expression_statement') return undefined;

    const stringNode = firstStmt.child(0);
    if (!stringNode || stringNode.type !== 'string') return undefined;

    const text = stringNode.text;
    if ((text.startsWith('"""') || text.startsWith("'''"))) {
      return truncateDoc(normalizeDoc(text, 'python'));
    }
    return undefined;
  }
}

class GoDocExtractor implements DocExtractor {
  readonly languageIds = ['go'];

  extractDocForNode(node: TreeSitterNode, _source: string): string | undefined {
    const lines: string[] = [];
    let sibling = node.previousNamedSibling ?? node.previousSibling;

    while (sibling) {
      if (sibling.type === 'comment' && sibling.text.startsWith('//')) {
        lines.unshift(sibling.text);
        sibling = sibling.previousSibling;
      } else if (sibling.type === '\n' || sibling.text.trim() === '') {
        sibling = sibling.previousSibling;
      } else {
        break;
      }
    }

    if (lines.length === 0) return undefined;

    const joined = lines.join('\n');
    return truncateDoc(normalizeDoc(joined, 'go'));
  }
}

class CSharpDocExtractor implements DocExtractor {
  readonly languageIds = ['csharp'];

  extractDocForNode(node: TreeSitterNode, _source: string): string | undefined {
    const lines: string[] = [];
    let sibling = node.previousNamedSibling ?? node.previousSibling;

    while (sibling) {
      if (sibling.type === 'comment' && sibling.text.startsWith('///')) {
        lines.unshift(sibling.text);
        sibling = sibling.previousSibling;
      } else if (sibling.type === '\n' || sibling.text.trim() === '') {
        sibling = sibling.previousSibling;
      } else {
        break;
      }
    }

    if (lines.length === 0) return undefined;

    const joined = lines.join('\n');
    return truncateDoc(normalizeDoc(joined, 'csharp'));
  }
}

const builtinDocExtractors: DocExtractor[] = [
  new TypeScriptDocExtractor(),
  new PythonDocExtractor(),
  new GoDocExtractor(),
  new CSharpDocExtractor(),
];

const docExtractorMap = new Map<string, DocExtractor>();
for (const extractor of builtinDocExtractors) {
  for (const langId of extractor.languageIds) {
    docExtractorMap.set(langId, extractor);
  }
}

export function getDocExtractorForLanguage(language: string): DocExtractor | undefined {
  return docExtractorMap.get(language);
}
