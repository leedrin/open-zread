import type { ImportInfo } from '@open-zread/types';

export type TreeSitterNode = {
  type: string;
  text: string;
  id: number;
  childCount: number;
  children: TreeSitterNode[];
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
  previousSibling: TreeSitterNode | null;
  previousNamedSibling: TreeSitterNode | null;
  nextSibling: TreeSitterNode | null;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
};

export interface ExtractionResult {
  imports: ImportInfo[];
}

export interface LanguageExtractor {
  readonly languageIds: string[];
  extractStructure(rootNode: TreeSitterNode): ExtractionResult;
}
