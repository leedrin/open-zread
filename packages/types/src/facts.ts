export interface ExportFact {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'unknown';
  signature: string;
  file: string;
  line?: number;
  doc?: string;
}

export interface FileSummary {
  file: string;
  lineCount?: number;
  symbolCount: number;
  exports: string[];
}

export interface PageFacts {
  pageSlug: string;
  exports: ExportFact[];
  fileSummaries: FileSummary[];
  internalDeps: string[];
  externalDeps: string[];
  confidence: number;
}
