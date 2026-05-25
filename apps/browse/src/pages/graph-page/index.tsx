import { useEffect, useState } from 'react';
import { GraphView } from './GraphView';
import { X } from 'lucide-react';

interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  kind: 'import' | 'refers' | 'links';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_LEGEND = [
  { color: '#3B82F6', label: 'Source File' },
  { color: '#10B981', label: 'Wiki Document' },
];

const EDGE_LEGEND = [
  { color: '#94A3B8', label: 'Import' },
  { color: '#F59E0B', label: 'Refers' },
  { color: '#8B5CF6', label: 'Links' },
];

export function GraphPage() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodeEdges, setNodeEdges] = useState<{ incoming: GraphEdge[]; outgoing: GraphEdge[] }>({ incoming: [], outgoing: [] });

  useEffect(() => {
    fetch('/api/wiki/graph')
      .then(res => res.json())
      .then((d: GraphData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    const incoming = data.edges.filter(e => {
      const t = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
      return t === node.id;
    });
    const outgoing = data.edges.filter(e => {
      const s = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
      return s === node.id;
    });
    setNodeEdges({ incoming, outgoing });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading graph...</div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 px-4 py-3 text-xs space-y-2">
        <div className="font-semibold text-gray-700 mb-1">Nodes</div>
        {NODE_LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
        <div className="font-semibold text-gray-700 mt-2 mb-1">Edges</div>
        {EDGE_LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="w-4 h-0.5 inline-block" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
      </div>

      <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 px-4 py-3 text-xs text-gray-500">
        {data.nodes.length} nodes · {data.edges.length} edges
      </div>

      <GraphView data={data} onNodeClick={handleNodeClick} />

      {selectedNode && (
        <div className="absolute bottom-4 left-4 z-10 bg-white rounded-lg shadow-md border border-gray-200 p-4 w-72">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{selectedNode.label}</h3>
            <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-1 text-xs text-gray-500">
            <div>Type: <span className="text-gray-700">{selectedNode.type}</span></div>
            <div>Group: <span className="text-gray-700">{selectedNode.group || '—'}</span></div>
            <div>ID: <span className="text-gray-700 font-mono text-[10px]">{selectedNode.id}</span></div>
            <div className="mt-2">Incoming: <span className="text-gray-700">{nodeEdges.incoming.length}</span></div>
            <div>Outgoing: <span className="text-gray-700">{nodeEdges.outgoing.length}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
