import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WikiOutput, WikiPage } from '@open-zread/types';
import { getWikiDir } from '../file-io.js';
import { migrateCatalog } from './migrate.js';

/**
 * Load the BASE catalog pages for a 3-way merge: the wiki.json from the most
 * recent version snapshot (`<wiki>/versions/<name>/wiki.json`). Snapshot names
 * are sortable (YYYY-MM-DD_HHMM_hash), so the lexicographically largest is newest.
 * Returns migrated pages (ids backfilled), or null when no usable snapshot exists.
 */
export async function loadBaseFromSnapshot(): Promise<WikiPage[] | null> {
  const versionsDir = join(getWikiDir(), 'versions');
  if (!existsSync(versionsDir)) return null;

  let names: string[];
  try {
    names = readdirSync(versionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }

  for (const name of names) {
    const wikiJson = join(versionsDir, name, 'wiki.json');
    if (!existsSync(wikiJson)) continue;
    try {
      const output = JSON.parse(readFileSync(wikiJson, 'utf-8')) as WikiOutput;
      if (output?.pages && Array.isArray(output.pages)) {
        return migrateCatalog(output).pages;
      }
    } catch {
      // skip unreadable snapshot, try the next
    }
  }
  return null;
}
