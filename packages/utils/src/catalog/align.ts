import type { WikiPage } from '@open-zread/types';

/** Identity-alignment thresholds (conservative defaults; tunable). */
export const CONCEPT_THRESHOLD = 0.5;
export const FINGERPRINT_THRESHOLD = 0.5;

/** Jaccard similarity of two string sets. Empty/empty returns 0. */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Compare the CONTENT fields of two pages (ignores id/origin/locked/status). */
export function pageContentEqual(a: WikiPage, b: WikiPage): boolean {
  return (
    a.title === b.title &&
    a.section === b.section &&
    (a.group ?? '') === (b.group ?? '') &&
    a.level === b.level &&
    (a.docType ?? '') === (b.docType ?? '') &&
    (a.depth ?? '') === (b.depth ?? '') &&
    arrEq(a.associatedFiles ?? [], b.associatedFiles ?? []) &&
    arrEq(a.concepts ?? [], b.concepts ?? [])
  );
}

function arrEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Candidate {
  page: WikiPage;
  used: boolean;
}

/**
 * Resolve each REMOTE page's identity against `existing` pages (typically LOCAL),
 * returning REMOTE pages whose `id` is set to the matched existing id (or kept when new).
 * Priority: exact id -> concept-set overlap -> associatedFiles fingerprint -> new.
 * Each existing page is matched at most once.
 */
export function alignRemote(remote: WikiPage[], existing: WikiPage[]): WikiPage[] {
  const candidates: Candidate[] = existing.map((page) => ({ page, used: false }));

  const matchById = (r: WikiPage) =>
    candidates.find((c) => !c.used && c.page.id && c.page.id === r.id);

  const bestByScore = (r: WikiPage, score: (c: WikiPage) => number, threshold: number) => {
    let best: Candidate | undefined;
    let bestScore = threshold;
    for (const c of candidates) {
      if (c.used) continue;
      const s = score(c.page);
      if (s >= bestScore) {
        if (!best || s > bestScore) {
          best = c;
          bestScore = s;
        }
      }
    }
    return best;
  };

  return remote.map((r) => {
    let match = matchById(r);
    if (!match && (r.concepts?.length ?? 0) > 0) {
      match = bestByScore(r, (c) => jaccard(r.concepts ?? [], c.concepts ?? []), CONCEPT_THRESHOLD);
    }
    if (!match && (r.associatedFiles?.length ?? 0) > 0) {
      match = bestByScore(
        r,
        (c) => jaccard(r.associatedFiles ?? [], c.associatedFiles ?? []),
        FINGERPRINT_THRESHOLD,
      );
    }
    if (match) {
      match.used = true;
      return { ...r, id: match.page.id };
    }
    return r;
  });
}
