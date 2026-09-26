export interface MarkdownLinkTarget {
  path: string;
  fragment?: string;
}

/** Resolve a Markdown URL against its source document without allowing it to leave the project root. */
export function resolveMarkdownLinkTarget(documentPath: string, href: string): MarkdownLinkTarget | null {
  if (!documentPath || documentPath.includes('\\') || href.includes('\\') || href.includes('\0')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')) return null;

  const documentSegments = documentPath.split('/');
  if (documentSegments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  const hashIndex = href.indexOf('#');
  const beforeFragment = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const fragmentSource = hashIndex < 0 ? undefined : href.slice(hashIndex + 1);
  const queryIndex = beforeFragment.indexOf('?');
  const rawPath = queryIndex < 0 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  let fragment: string | undefined;
  try {
    fragment = fragmentSource === undefined ? undefined : decodeURIComponent(fragmentSource);
  } catch {
    return null;
  }

  const segments = rawPath ? documentSegments.slice(0, -1) : documentSegments.slice();
  if (rawPath) {
    for (const rawSegment of rawPath.split('/')) {
      if (!rawSegment || rawSegment === '.') continue;
      let segment: string;
      try {
        segment = decodeURIComponent(rawSegment);
      } catch {
        return null;
      }
      if (segment === '.') continue;
      if (segment === '..') {
        if (segments.length === 0) return null;
        segments.pop();
        continue;
      }
      if (segment.includes('/') || segment.includes('\\') || segment.includes(':') || segment.includes('\0')) return null;
      segments.push(segment);
    }
  }
  if (segments.length === 0) return null;
  return { path: segments.join('/'), ...(fragment === undefined ? {} : { fragment }) };
}
