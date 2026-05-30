import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Parser from 'web-tree-sitter';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { normalizeDoc, truncateDoc, getDocExtractorForLanguage } from '../doc-extractor';
import type { TreeSitterNode } from '../extractors/types';

let tsParser: Parser;
let jsParser: Parser;
let csharpParser: Parser;

function getTreeSitterDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  let current = dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const bunCandidate = join(current, 'node_modules', '.bun', 'web-tree-sitter@0.20.8', 'node_modules', 'web-tree-sitter');
    if (existsSync(join(bunCandidate, 'tree-sitter.wasm'))) return bunCandidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

async function initParsers(): Promise<void> {
  const treeSitterDir = getTreeSitterDir();

  await Parser.init({
    locateFile: (fileName: string) => join(treeSitterDir, fileName)
  });

  const wasmDir = join(homedir(), '.zread', 'parsers');

  const tsWasm = readFileSync(join(wasmDir, 'tree-sitter-typescript.wasm'));
  const tsLang = await Parser.Language.load(new Uint8Array(tsWasm));
  tsParser = new Parser();
  tsParser.setLanguage(tsLang);

  const jsWasm = readFileSync(join(wasmDir, 'tree-sitter-javascript.wasm'));
  const jsLang = await Parser.Language.load(new Uint8Array(jsWasm));
  jsParser = new Parser();
  jsParser.setLanguage(jsLang);

  const csWasm = readFileSync(join(wasmDir, 'tree-sitter-c_sharp.wasm'));
  const csLang = await Parser.Language.load(new Uint8Array(csWasm));
  csharpParser = new Parser();
  csharpParser.setLanguage(csLang);
}

function getFirstFunctionNode(tree: Parser.Tree): Parser.SyntaxNode | null {
  for (const child of tree.rootNode.children) {
    if (child.type === 'function_declaration') return child;
  }
  return null;
}

function getFirstMethodNode(tree: Parser.Tree): Parser.SyntaxNode | null {
  for (const child of tree.rootNode.children) {
    if (child.type === 'class_declaration') {
      const body = child.childForFieldName('body');
      if (body) {
        for (const inner of body.children) {
          if (inner.type === 'method_declaration') return inner;
        }
      }
    }
  }
  return null;
}

describe('DocExtractor', () => {
  beforeAll(async () => {
    await initParsers();
  });

  afterAll(() => {
    tsParser?.delete();
    jsParser?.delete();
    csharpParser?.delete();
  });

  describe('normalizeDoc', () => {
    test('JSDoc style: strips /** */ and * prefixes', () => {
      const raw = '/**\n * Hello world\n * @param x the value\n */';
      const result = normalizeDoc(raw, 'jsdoc');
      expect(result).toBe('Hello world\n@param x the value');
    });

    test('Python style: strips triple quotes', () => {
      const raw = '"""Hello world\n\nSecond paragraph"""';
      const result = normalizeDoc(raw, 'python');
      expect(result).toBe('Hello world\n\nSecond paragraph');
    });

    test('Go style: strips // prefixes', () => {
      const raw = '// Hello world\n// Second line';
      const result = normalizeDoc(raw, 'go');
      expect(result).toBe('Hello world\nSecond line');
    });

    test('C# style: strips /// prefixes, preserves XML tags', () => {
      const raw = '/// <summary>\n/// Hello world\n/// </summary>';
      const result = normalizeDoc(raw, 'csharp');
      expect(result).toBe('<summary>\nHello world\n</summary>');
    });
  });

  describe('truncateDoc', () => {
    test('short doc unchanged', () => {
      const doc = 'Hello world';
      expect(truncateDoc(doc)).toBe('Hello world');
    });

    test('long doc truncated to 800 chars', () => {
      const doc = 'a'.repeat(900);
      const result = truncateDoc(doc);
      expect(result.length).toBe(800 + '...（已截断）'.length);
      expect(result.endsWith('...（已截断）')).toBe(true);
    });
  });

  describe('TypeScriptDocExtractor', () => {
    test('function with JSDoc above → extracts normalized text', () => {
      const code = `/**
 * Builds the repo map.
 * @param opts the options
 */
function buildRepoMap(opts: BuildOpts): RepoMap {
  return {} as RepoMap;
}`;
      const tree = tsParser.parse(code);
      const fnNode = getFirstFunctionNode(tree);
      expect(fnNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('typescript');
      expect(extractor).toBeDefined();
      const doc = extractor?.extractDocForNode(fnNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toContain('Builds the repo map.');
      expect(doc).toContain('@param opts the options');

      tree.delete();
    });

    test('function without comment → returns undefined', () => {
      const code = `function noComment(): void {}`;
      const tree = tsParser.parse(code);
      const fnNode = getFirstFunctionNode(tree);
      expect(fnNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('typescript');
      const doc = extractor?.extractDocForNode(fnNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toBeUndefined();

      tree.delete();
    });

    test('function with // inline comment above → returns undefined', () => {
      const code = `// this is inline
function inlineComment(): void {}`;
      const tree = tsParser.parse(code);
      const fnNode = getFirstFunctionNode(tree);
      expect(fnNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('typescript');
      const doc = extractor?.extractDocForNode(fnNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toBeUndefined();

      tree.delete();
    });

    test('multi-paragraph JSDoc preserves newlines', () => {
      const code = `/**
 * First paragraph.
 *
 * Second paragraph.
 */
function multi(): void {}`;
      const tree = tsParser.parse(code);
      const fnNode = getFirstFunctionNode(tree);
      expect(fnNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('typescript');
      const doc = extractor?.extractDocForNode(fnNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toContain('First paragraph.');
      expect(doc).toContain('Second paragraph.');

      tree.delete();
    });
  });

  describe('CSharpDocExtractor', () => {
    test('method with /// summary → extracts doc', () => {
      const code = `using System;
/// <summary>
/// Calculates the total.
/// </summary>
/// <param name="items">The items.</param>
class Calculator {
    /// <summary>
    /// Does the thing.
    /// </summary>
    void DoThing() {}
}`;
      const tree = csharpParser.parse(code);
      const methodNode = getFirstMethodNode(tree);
      expect(methodNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('csharp');
      expect(extractor).toBeDefined();
      const doc = extractor?.extractDocForNode(methodNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toContain('Does the thing.');

      tree.delete();
    });

    test('method without doc → returns undefined', () => {
      const code = `class Foo {
    void NoDoc() {}
}`;
      const tree = csharpParser.parse(code);
      const methodNode = getFirstMethodNode(tree);
      expect(methodNode).not.toBeNull();

      const extractor = getDocExtractorForLanguage('csharp');
      const doc = extractor?.extractDocForNode(methodNode as Parser.SyntaxNode as unknown as TreeSitterNode, code);
      expect(doc).toBeUndefined();

      tree.delete();
    });
  });

  describe('getDocExtractorForLanguage', () => {
    test('returns TypeScriptDocExtractor for typescript', () => {
      const extractor = getDocExtractorForLanguage('typescript');
      expect(extractor).toBeDefined();
      if (extractor) {
        expect(extractor.languageIds).toContain('typescript');
      }
    });

    test('returns TypeScriptDocExtractor for javascript', () => {
      const extractor = getDocExtractorForLanguage('javascript');
      expect(extractor).toBeDefined();
      if (extractor) {
        expect(extractor.languageIds).toContain('javascript');
      }
    });

    test('returns CSharpDocExtractor for csharp', () => {
      const extractor = getDocExtractorForLanguage('csharp');
      expect(extractor).toBeDefined();
    });

    test('returns undefined for unknown language', () => {
      const extractor = getDocExtractorForLanguage('brainfuck');
      expect(extractor).toBeUndefined();
    });
  });
});
