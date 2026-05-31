import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TopicScope, WikiPage } from '@open-zread/types';
import { getWikiDir } from '../file-io.js';

function scopesDir(): string {
  return join(getWikiDir(), 'scopes');
}
function sanitize(name: string): string {
  return name.replace(/[^\w一-龥-]/g, '_');
}
function scopeFile(name: string): string {
  return join(scopesDir(), `${sanitize(name)}.json`);
}

/** Persist a topic scope to <wiki>/scopes/<name>.json. */
export function saveScope(scope: TopicScope): void {
  const dir = scopesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(scopeFile(scope.name), JSON.stringify(scope, null, 2), 'utf-8');
}

/** List all saved topic scopes (unreadable/invalid files are skipped). */
export function listScopes(): TopicScope[] {
  const dir = scopesDir();
  if (!existsSync(dir)) return [];
  const out: TopicScope[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TopicScope);
    } catch {
      // skip invalid scope file
    }
  }
  return out;
}

/** Load one topic scope by name; null when missing/invalid. */
export function loadScope(name: string): TopicScope | null {
  const file = scopeFile(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as TopicScope;
  } catch {
    return null;
  }
}

/** Resolve a scope's pageIds against current pages, ignoring stale ids. */
export function resolveScope(scope: TopicScope, pages: WikiPage[]): WikiPage[] {
  const byId = new Map<string, WikiPage>();
  for (const p of pages) if (p.id) byId.set(p.id, p);
  const out: WikiPage[] = [];
  for (const id of scope.pageIds) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}
