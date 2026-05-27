/**
 * Symbol Manifest Types
 *
 * Parser output - extracted symbols from source files
 */

/**
 * Structured import information extracted from AST.
 * Language-specific extractors produce this instead of raw text.
 */
export interface ImportInfo {
  source: string;
  specifiers: string[];
  lineNumber?: number;
}

/**
 * SymbolManifest - Parser output
 */
export interface SymbolManifest {
  symbols: Array<{
    file: string;
    exports: string[];
    functions: Array<{ name: string; signature: string }>;
    imports: string[];
    docstrings: string[];
    structuredImports?: ImportInfo[];
    language?: string;
  }>;
  loadedParsers: string[];
}

/**
 * SymbolInfo - Single file symbols
 */
export interface SymbolInfo {
  file: string;
  exports: string[];
  functions: Array<{ name: string; signature: string }>;
  imports: string[];
  docstrings: string[];
  structuredImports?: ImportInfo[];
  language?: string;
}
