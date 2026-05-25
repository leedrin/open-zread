import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { DependencyGraph, GraphData, GraphNode, GraphEdge, WikiPage } from '@open-zread/types';

export function buildGraphData(
  wikiPath: string,
  depGraph: DependencyGraph,
  pages: WikiPage[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const [source, targets] of Object.entries(depGraph.forward)) {
    if (!nodeIds.has(source)) {
      nodeIds.add(source);
      const pkgMatch = source.match(/^packages\/([^/]+)/);
      nodes.push({
        id: source,
        label: basename(source),
        type: 'source',
        group: pkgMatch ? `packages/${pkgMatch[1]}` : undefined,
      });
    }

    for (const target of targets) {
      if (!nodeIds.has(target)) {
        nodeIds.add(target);
        const pkgMatch = target.match(/^packages\/([^/]+)/);
        nodes.push({
          id: target,
          label: basename(target),
          type: 'source',
          group: pkgMatch ? `packages/${pkgMatch[1]}` : undefined,
        });
      }

      edges.push({ source, target, kind: 'import' });
    }
  }

  for (const page of pages) {
    const docId = page.slug;
    if (!nodeIds.has(docId)) {
      nodeIds.add(docId);
      nodes.push({
        id: docId,
        label: page.title,
        type: 'doc',
        group: page.section,
        metadata: { pageCount: page.associatedFiles?.length ?? 0 },
      });
    }
  }

  const indexPath = join(wikiPath, 'source-files-index.json');
  if (existsSync(indexPath)) {
    try {
      const raw = JSON.parse(readFileSync(indexPath, 'utf-8'));
      const sourceToDocs: Record<string, string[]> = raw.sourceToDocs ?? {};
      for (const [source, docs] of Object.entries(sourceToDocs)) {
        for (const docRelPath of docs) {
          const page = pages.find(p => docRelPath.endsWith(p.file) || docRelPath.includes(p.slug));
          if (page && nodeIds.has(source)) {
            edges.push({ source, target: page.slug, kind: 'refers' });
          }
        }
      }
    } catch { /* source index may not exist */ }
  }

  const linkRe = /\[([^\]]+)\]\((?!http|#)([^)]+\.md)\)/g;
  for (const page of pages) {
    const sectionPath = join(wikiPath, page.section, page.file);
    const directPath = join(wikiPath, page.file);

    let content: string;
    try {
      const p = existsSync(sectionPath) ? sectionPath : directPath;
      content = readFileSync(p, 'utf-8');
    } catch { continue; }

    linkRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(content)) !== null) {
      const targetFile = match[2];
      const targetPage = pages.find(p =>
        targetFile.includes(p.file) || targetFile.includes(p.slug)
      );
      if (targetPage) {
        edges.push({ source: page.slug, target: targetPage.slug, kind: 'links' });
      }
    }
  }

  const edgeSet = new Set<string>();
  const dedupedEdges = edges.filter(e => {
    const key = `${e.source}|${e.target}|${e.kind}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: dedupedEdges };
}
