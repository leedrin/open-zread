import { useRef, useEffect, useState, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force';
import type { SimulationNodeDatum, Simulation as D3Simulation } from 'd3-force';

interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: 'source' | 'doc';
  group?: string;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: string;
}

const NODE_COLORS: Record<string, string> = {
  source: '#3B82F6',
  doc: '#10B981',
};

const EDGE_COLORS: Record<string, string> = {
  import: '#94A3B8',
  refers: '#F59E0B',
  links: '#8B5CF6',
};

interface GraphViewProps {
  data: { nodes: GraphNode[]; edges: Array<{ source: string | GraphNode; target: string | GraphNode; kind: string }> };
  onNodeClick?: (node: GraphNode) => void;
}

export function GraphView({ data, onNodeClick }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const simulationRef = useRef<D3Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const stableOnNodeClick = useCallback((node: GraphNode) => { onNodeClick?.(node); }, [onNodeClick]);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

    const svg = svgRef.current;
    const { width, height } = dimensions;

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const nodes: SimNode[] = data.nodes.map((n: GraphNode) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 300,
      y: height / 2 + (Math.random() - 0.5) * 300,
    }));

    const nodeMap = new Map<string, SimNode>(nodes.map((n: SimNode) => [n.id, n]));

    const links: SimLink[] = data.edges
      .map((e: { source: string | GraphNode; target: string | GraphNode; kind: string }) => {
        const sId = typeof e.source === 'string' ? e.source : e.source.id;
        const tId = typeof e.target === 'string' ? e.target : e.target.id;
        const sNode = nodeMap.get(sId);
        const tNode = nodeMap.get(tId);
        if (!sNode || !tNode) return null;
        return { source: sNode, target: tNode, kind: e.kind };
      })
      .filter((l: SimLink | null): l is SimLink => l !== null);

    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    svg.appendChild(g);

    const transform = { x: 0, y: 0, k: 1 };
    const applyTransform = () => {
      g.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`);
    };

    svg.onwheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      transform.k = Math.max(0.1, Math.min(5, transform.k * delta));
      applyTransform();
    };

    const linkEls = links.map((l: SimLink) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('stroke', EDGE_COLORS[l.kind] || '#94A3B8');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', '0.4');
      g.appendChild(line);
      return line;
    });

    let dragNode: SimNode | null = null;
    let dragStart = { x: 0, y: 0 };

    const nodeEls = nodes.map((n: SimNode) => {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', n.type === 'doc' ? '8' : '6');
      circle.setAttribute('fill', NODE_COLORS[n.type]);
      circle.setAttribute('cursor', 'pointer');

      circle.onmousedown = (e: MouseEvent) => {
        e.stopPropagation();
        dragNode = n;
        dragStart = { x: e.clientX, y: e.clientY };
        simulationRef.current?.alphaTarget(0.3).restart();
      };

      circle.onclick = () => stableOnNodeClick(n);

      const text = document.createElementNS(ns, 'text');
      text.textContent = n.label.length > 25 ? n.label.slice(0, 25) + '…' : n.label;
      text.setAttribute('font-size', '9');
      text.setAttribute('fill', '#6B7280');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '16');
      text.setAttribute('pointer-events', 'none');

      g.appendChild(circle);
      g.appendChild(text);
      return { circle, text, node: n };
    });

    svg.onmousemove = (e: MouseEvent) => {
      if (!dragNode) return;
      const dx = (e.clientX - dragStart.x) / transform.k;
      const dy = (e.clientY - dragStart.y) / transform.k;
      if (dragNode.x != null) dragNode.x += dx;
      if (dragNode.y != null) dragNode.y += dy;
      dragStart = { x: e.clientX, y: e.clientY };
      simulationRef.current?.alpha(0.3).restart();
    };

    svg.onmouseup = () => {
      if (dragNode) {
        dragNode = null;
        simulationRef.current?.alphaTarget(0);
      }
    };

    const simulation = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d: SimNode) => d.id).distance(80))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius(25));

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      nodeEls.forEach(({ circle, text, node: n }) => {
        circle.setAttribute('cx', String(n.x));
        circle.setAttribute('cy', String(n.y));
        text.setAttribute('x', String(n.x));
        text.setAttribute('y', String(n.y));
      });

      links.forEach((l: SimLink, i: number) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        linkEls[i].setAttribute('x1', String(s.x));
        linkEls[i].setAttribute('y1', String(s.y));
        linkEls[i].setAttribute('x2', String(t.x));
        linkEls[i].setAttribute('y2', String(t.y));
      });
    });

    return () => {
      simulation.stop();
    };
  }, [data, dimensions, stableOnNodeClick]);

  if (data.nodes.length === 0) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-full text-gray-400">
        No graph data available. Run wiki generation first.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="bg-gray-50 block"
      />
    </div>
  );
}
