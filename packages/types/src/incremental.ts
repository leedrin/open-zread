export interface DependencyEdge {
  source: string;
  target: string;
  kind: 'import' | 'dynamic_import' | 'reexport';
  symbols?: string[];
}

export interface DependencyGraph {
  forward: Record<string, string[]>;
  reverse: Record<string, string[]>;
  edges: DependencyEdge[];
}

export interface AffectedDoc {
  docPath: string;
  page: import('./wiki').WikiPage;
  reason: 'source_changed' | 'dep_changed' | 'doc_dep_changed';
  updateStrength: 'full' | 'incremental';
  triggeredBy: string[];
  signatureChanged: boolean;
}

export interface IncrementalPlan {
  changedFiles: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  affectedDocs: AffectedDoc[];
  unaffectedDocs: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
  metadata?: {
    exportCount?: number;
    pageCount?: number;
  };
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'import' | 'refers' | 'links';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
