import { createHash } from 'node:crypto';
import type { WikiOutput, WikiPage } from '@open-zread/types';

/** Deterministic, stable id derived from a page's slug. */
export function deriveId(slug: string): string {
  return createHash('sha1').update(slug).digest('hex').slice(0, 12);
}

/** Backfill identity/provenance/lock/status on pages. Idempotent — never overwrites existing values. */
export function migrateCatalog(output: WikiOutput): WikiOutput {
  const pages: WikiPage[] = output.pages.map((p) => ({
    ...p,
    id: p.id ?? deriveId(p.slug),
    origin: p.origin ?? 'ai',
    locked: p.locked ?? false,
    status: p.status ?? 'active',
  }));
  return { ...output, pages };
}
