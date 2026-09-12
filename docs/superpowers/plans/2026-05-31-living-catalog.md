# Living Catalog — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the catalog an editable, identity-stable artifact — every page carries a stable `id`, provenance, lock, soft-delete, and owned glossary concepts — and render a deterministic unified-glossary page. (Phase A of the `living-catalog` OpenSpec change.)

**Architecture:** Extend `WikiPage` with metadata; backfill it on load via an idempotent migration keyed by a deterministic id derived from `slug`; add a pure `packages/utils/src/catalog/` module for node operations reused later by the TUI editor and the merge engine; render the glossary page deterministically from `glossary[]` + each page's `concepts` during finalize. No LLM, no live-app dependency — all of Phase A is unit-testable.

**Tech Stack:** TypeScript (Bun monorepo, Turborepo), `bun:test`, Node `crypto` for deterministic ids.

**Source (locked handoff):**
- plan-ready.md: `openspec/changes/living-catalog/plan-ready.md` (Tasks 1–9, 13)
- design.md: `openspec/changes/living-catalog/design.md` (D1, D5, D6, D9, D-lock 1/3)
- specs: `catalog-editable-model`, `catalog-glossary-page`

**Scope note:** This plan covers **Phase A only**. Phases B (reconciliation) and C (topic scopes + deep-dive) depend on A's concrete types and the merge engine; they will each get their own plan after A merges (see plan-ready.md Tasks 14–29). Do not implement B/C from this file.

**Do not edit OpenSpec artifacts during build.** If a spec problem surfaces, append a note to `openspec/changes/living-catalog/implementation-notes.md`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/types/src/wiki.ts` (modify) | `WikiPage` metadata fields; `PageOrigin`, `PageStatus`, `TopicScope`, `CatalogMergePlan` types |
| `packages/utils/src/catalog/migrate.ts` (create) | `deriveId`, `migrateCatalog` (idempotent backfill) |
| `packages/utils/src/catalog/node-ops.ts` (create) | pure page CRUD: add/update/tombstone/move/toggleLock/setDepth |
| `packages/utils/src/catalog/index.ts` (create) | barrel export for the catalog module |
| `packages/utils/src/output/glossary-page.ts` (create) | `ensureGlossaryPage`, `renderGlossaryPage` (deterministic) |
| `packages/utils/src/output/wiki-content.ts` (modify) | `loadWikiBlueprint` runs migration |
| `packages/utils/src/output/finalize.ts` (modify) | skip tombstones in sidebar/index; render glossary page |
| `packages/utils/src/index.ts` (modify) | re-export catalog module + glossary-page |
| `packages/orchestrator/src/tools/output-tools.ts` (modify) | `GenerateBlueprintTool` accepts new page fields |
| `packages/utils/src/catalog/__tests__/*.test.ts` (create) | unit tests |
| `packages/utils/src/output/__tests__/glossary-page.test.ts` (create) | unit tests |

---

## Task 1: Extend WikiPage type

**Files:**
- Modify: `packages/types/src/wiki.ts`

- [ ] **Step 1: Add metadata fields and supporting types**

In `packages/types/src/wiki.ts`, add above `WikiPage`:

```typescript
export type PageOrigin = 'ai' | 'human';
export type PageStatus = 'active' | 'tombstone';
```

Add these fields to the `WikiPage` interface (after `docType?`):

```typescript
  /** Stable identity, independent of title/slug. Backfilled on load by migrateCatalog. Merge key. */
  id?: string;
  /** Who created this page. */
  origin?: PageOrigin;
  /** Hard protection: locked pages are never touched by AI operations. */
  locked?: boolean;
  /** Soft-delete state. Tombstoned pages stay in wiki.json but are excluded from derived artifacts. */
  status?: PageStatus;
  /** Depth directive for content generation. */
  depth?: 'standard' | 'deep';
  /** Canonical glossary terms this page is the authoritative home for (page -> many terms). */
  concepts?: string[];
```

Add at the end of the file:

```typescript
/** A named, themed selection of pages (references by id, never copies content). */
export interface TopicScope {
  name: string;
  description?: string;
  pageIds: string[];
  createdAt: string;
}

/** Result of a 3-way catalog merge (filled in Phase B). */
export interface CatalogMergePlan {
  adds: WikiPage[];
  updates: Array<{ id: string; from: WikiPage; to: WikiPage }>;
  conflicts: Array<{ id: string; local: WikiPage; remote: WikiPage }>;
  removes: WikiPage[];
  kept: WikiPage[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: PASS (all new fields optional, so existing construction sites still compile).

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/wiki.ts
git commit -m "feat(types): add WikiPage identity/provenance/lock/status/concepts + TopicScope/CatalogMergePlan"
```

---

## Task 2: Deterministic id + idempotent migration

**Files:**
- Create: `packages/utils/src/catalog/migrate.ts`
- Create: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/migrate.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { deriveId, migrateCatalog } from '../migrate.js';
import type { WikiOutput, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage> = {}): WikiPage {
  return { slug: 'x', title: 'X', file: 'x.md', section: 'S', level: 'Intermediate', ...p };
}

function out(pages: WikiPage[]): WikiOutput {
  return { id: 'w', generated_at: 't', language: 'zh', pages };
}

describe('deriveId', () => {
  test('is deterministic for the same slug', () => {
    expect(deriveId('1-overview')).toBe(deriveId('1-overview'));
  });
  test('differs for different slugs', () => {
    expect(deriveId('a')).not.toBe(deriveId('b'));
  });
});

describe('migrateCatalog', () => {
  test('backfills id/origin/locked/status on legacy pages', () => {
    const m = migrateCatalog(out([page({ slug: 's1' })]));
    const p = m.pages[0];
    expect(p.id).toBe(deriveId('s1'));
    expect(p.origin).toBe('ai');
    expect(p.locked).toBe(false);
    expect(p.status).toBe('active');
  });
  test('is idempotent and preserves existing metadata', () => {
    const once = migrateCatalog(out([page({ slug: 's1', id: 'fixed', origin: 'human', locked: true })]));
    const twice = migrateCatalog(once);
    expect(twice.pages[0].id).toBe('fixed');
    expect(twice.pages[0].origin).toBe('human');
    expect(twice.pages[0].locked).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/migrate.test.ts`
Expected: FAIL (`Cannot find module '../migrate.js'`).

- [ ] **Step 3: Implement migrate.ts**

Create `packages/utils/src/catalog/migrate.ts`:

```typescript
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
```

- [ ] **Step 4: Create the barrel export**

Create `packages/utils/src/catalog/index.ts`:

```typescript
export { deriveId, migrateCatalog } from './migrate.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/migrate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/catalog/
git commit -m "feat(utils): deterministic id + idempotent catalog migration"
```

---

## Task 3: Wire migration into load + persist new fields

**Files:**
- Modify: `packages/utils/src/output/wiki-content.ts`
- Modify: `packages/utils/src/index.ts`
- Modify: `packages/orchestrator/src/tools/output-tools.ts`
- Test: `packages/utils/src/catalog/__tests__/roundtrip.test.ts`

- [ ] **Step 1: Write the failing round-trip test**

Create `packages/utils/src/catalog/__tests__/roundtrip.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'bun:test';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWikiBlueprint } from '../../output/wiki-content.js';

describe('loadWikiBlueprint migration', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('legacy wiki.json gets ids/metadata on load', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wc-'));
    const file = join(dir, 'wiki.json');
    writeFileSync(file, JSON.stringify({
      id: 'w', generated_at: 't', language: 'zh',
      pages: [{ slug: 's1', title: 'T', file: 's1.md', section: 'S', level: 'Beginner' }],
    }), 'utf-8');

    const bp = await loadWikiBlueprint(file);
    const p = bp.pages[0];
    expect(p.id).toBeDefined();
    expect(p.origin).toBe('ai');
    expect(p.status).toBe('active');
  });

  test('locked/human metadata survives round-trip', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wc-'));
    const file = join(dir, 'wiki.json');
    writeFileSync(file, JSON.stringify({
      id: 'w', generated_at: 't', language: 'zh',
      pages: [{ slug: 's1', title: 'T', file: 's1.md', section: 'S', level: 'Beginner',
                id: 'fixed', origin: 'human', locked: true, status: 'active' }],
    }), 'utf-8');

    const bp = await loadWikiBlueprint(file);
    expect(bp.pages[0].locked).toBe(true);
    expect(bp.pages[0].origin).toBe('human');
    expect(bp.pages[0].id).toBe('fixed');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/roundtrip.test.ts`
Expected: FAIL (`origin` undefined — migration not wired into load yet).

- [ ] **Step 3: Wire migration into loadWikiBlueprint**

In `packages/utils/src/output/wiki-content.ts`, add the import at the top:

```typescript
import { migrateCatalog } from '../catalog/migrate.js';
```

In `loadWikiBlueprint`, change the success return. Find:

```typescript
    return blueprint;
```

(inside the `try`, after the `pages` validation) and replace with:

```typescript
    return migrateCatalog(blueprint);
```

- [ ] **Step 4: Re-export catalog module from utils index**

In `packages/utils/src/index.ts`, after the Storage exports block, add:

```typescript
// Catalog
export { deriveId, migrateCatalog } from './catalog/index.js';
```

- [ ] **Step 5: GenerateBlueprintTool accepts new fields**

In `packages/orchestrator/src/tools/output-tools.ts`, inside `GenerateBlueprintTool.inputSchema.properties.pages.items.properties`, add these properties alongside the existing ones:

```typescript
            id: { type: 'string', description: '稳定页面 id（可选；缺省由系统生成）' },
            origin: { type: 'string', description: "来源：'ai' 或 'human'（可选）" },
            locked: { type: 'boolean', description: '是否锁定保护（可选）' },
            status: { type: 'string', description: "状态：'active' 或 'tombstone'（可选）" },
            depth: { type: 'string', description: "深度：'standard' 或 'deep'（可选）" },
            concepts: { type: 'array', items: { type: 'string' }, description: '该页归属的规范术语（可选）' },
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/roundtrip.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck the monorepo**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/utils/src/output/wiki-content.ts packages/utils/src/index.ts packages/orchestrator/src/tools/output-tools.ts packages/utils/src/catalog/__tests__/roundtrip.test.ts
git commit -m "feat: migrate catalog on load; persist new page fields via GenerateBlueprintTool"
```

---

## Task 4: finalize excludes tombstoned pages

**Files:**
- Modify: `packages/utils/src/output/finalize.ts`
- Test: `packages/utils/src/output/__tests__/finalize-tombstone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/output/__tests__/finalize-tombstone.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWiki } from '../finalize.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}

describe('finalize tombstone handling', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('tombstoned page is excluded from _sidebar.md', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fin-'));
    const pages = [
      page({ slug: 'alive', title: 'Alive', file: 'alive.md', section: 'Sec', status: 'active' }),
      page({ slug: 'dead', title: 'Dead', file: 'dead.md', section: 'Sec', status: 'tombstone' }),
    ];
    for (const p of pages) {
      mkdirSync(join(dir, p.section), { recursive: true });
      writeFileSync(join(dir, p.section, p.file), '# x\n', 'utf-8');
    }
    await finalizeWiki(dir, { pages });
    const sidebar = readFileSync(join(dir, '_sidebar.md'), 'utf-8');
    expect(sidebar).toContain('Alive');
    expect(sidebar).not.toContain('Dead');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/output/__tests__/finalize-tombstone.test.ts`
Expected: FAIL (sidebar contains "Dead").

- [ ] **Step 3: Filter tombstones in generateSidebar**

In `packages/utils/src/output/finalize.ts`, at the start of `generateSidebar`, filter the input pages. Find the function signature:

```typescript
function generateSidebar(outputDir: string, pages: WikiPage[]): void {
```

and insert as its first statement:

```typescript
  pages = pages.filter((p) => p.status !== 'tombstone');
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/output/__tests__/finalize-tombstone.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/output/finalize.ts packages/utils/src/output/__tests__/finalize-tombstone.test.ts
git commit -m "feat(finalize): exclude tombstoned pages from sidebar"
```

---

## Task 5: Pure catalog node operations

**Files:**
- Create: `packages/utils/src/catalog/node-ops.ts`
- Modify: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/node-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/node-ops.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { addPage, updatePage, tombstonePage, movePage, toggleLock, setDepth } from '../node-ops.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage> = {}): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id1', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('node-ops', () => {
  test('addPage appends a human page with an id', () => {
    const out = addPage([], { slug: 'n', title: 'N', file: 'n.md', section: 'Sec', level: 'Beginner' });
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBe('human');
    expect(out[0].id).toBeTruthy();
    expect(out[0].status).toBe('active');
  });

  test('updatePage preserves id', () => {
    const out = updatePage([page({ id: 'keep' })], 'keep', { title: 'New' });
    expect(out[0].id).toBe('keep');
    expect(out[0].title).toBe('New');
  });

  test('tombstonePage sets status', () => {
    const out = tombstonePage([page({ id: 'a' })], 'a');
    expect(out[0].status).toBe('tombstone');
  });

  test('movePage preserves id and changes section/group', () => {
    const out = movePage([page({ id: 'a' })], 'a', 'NewSec', 'G');
    expect(out[0].id).toBe('a');
    expect(out[0].section).toBe('NewSec');
    expect(out[0].group).toBe('G');
  });

  test('toggleLock flips locked', () => {
    const out = toggleLock([page({ id: 'a', locked: false })], 'a');
    expect(out[0].locked).toBe(true);
  });

  test('setDepth sets depth', () => {
    const out = setDepth([page({ id: 'a' })], 'a', 'deep');
    expect(out[0].depth).toBe('deep');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/node-ops.test.ts`
Expected: FAIL (`Cannot find module '../node-ops.js'`).

- [ ] **Step 3: Implement node-ops.ts**

Create `packages/utils/src/catalog/node-ops.ts`:

```typescript
import type { WikiPage } from '@open-zread/types';
import { deriveId } from './migrate.js';

type NewPageInput = Pick<WikiPage, 'slug' | 'title' | 'file' | 'section' | 'level'> & Partial<WikiPage>;

/** Append a new human-authored page (fresh id, origin 'human', active). */
export function addPage(pages: WikiPage[], input: NewPageInput): WikiPage[] {
  const page: WikiPage = {
    ...input,
    id: input.id ?? deriveId(`${input.slug}-${Date.now()}-${pages.length}`),
    origin: input.origin ?? 'human',
    locked: input.locked ?? false,
    status: input.status ?? 'active',
  };
  return [...pages, page];
}

/** Patch a page by id; id is never changed. */
export function updatePage(pages: WikiPage[], id: string, patch: Partial<WikiPage>): WikiPage[] {
  return pages.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p));
}

/** Soft-delete a page by id. */
export function tombstonePage(pages: WikiPage[], id: string): WikiPage[] {
  return updatePage(pages, id, { status: 'tombstone' });
}

/** Move a page to another section/group; preserves id. */
export function movePage(pages: WikiPage[], id: string, section: string, group?: string): WikiPage[] {
  return updatePage(pages, id, { section, group });
}

/** Flip the locked flag. */
export function toggleLock(pages: WikiPage[], id: string): WikiPage[] {
  return pages.map((p) => (p.id === id ? { ...p, locked: !p.locked } : p));
}

/** Set the depth directive. */
export function setDepth(pages: WikiPage[], id: string, depth: 'standard' | 'deep'): WikiPage[] {
  return updatePage(pages, id, { depth });
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/utils/src/catalog/index.ts`, add:

```typescript
export { addPage, updatePage, tombstonePage, movePage, toggleLock, setDepth } from './node-ops.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/node-ops.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/catalog/node-ops.ts packages/utils/src/catalog/index.ts packages/utils/src/catalog/__tests__/node-ops.test.ts
git commit -m "feat(utils): pure catalog node operations (add/update/tombstone/move/lock/depth)"
```

---

## Task 6: Glossary page deterministic renderer

**Files:**
- Create: `packages/utils/src/output/glossary-page.ts`
- Test: `packages/utils/src/output/__tests__/glossary-page.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/output/__tests__/glossary-page.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { renderGlossaryPage, ensureGlossaryPage, GLOSSARY_PAGE_ID } from '../glossary-page.js';
import type { GlossaryTerm, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

const glossary: GlossaryTerm[] = [
  { term: '技能系统', aliases: ['技能与战斗系统'], definition: '技能的注册与释放', canonicalPage: 'skill' },
];
const pages: WikiPage[] = [
  page({ slug: 'skill', title: '技能系统', concepts: ['技能系统'] }),
  page({ slug: 'combat', title: '战斗', concepts: ['技能系统', '战斗'] }),
];

describe('renderGlossaryPage', () => {
  test('renders term name, aliases, definition', () => {
    const md = renderGlossaryPage(glossary, pages);
    expect(md).toContain('技能系统');
    expect(md).toContain('技能与战斗系统');
    expect(md).toContain('技能的注册与释放');
  });
  test('renders bidirectional appears-in mapping', () => {
    const md = renderGlossaryPage(glossary, pages);
    // both pages own the concept 技能系统 -> both listed under it
    expect(md).toContain('技能系统');
    expect(md).toContain('战斗');
  });
  test('ignores tombstoned pages in appears-in', () => {
    const withDead = [...pages, page({ slug: 'dead', title: 'Dead', concepts: ['技能系统'], status: 'tombstone' })];
    const md = renderGlossaryPage(glossary, withDead);
    expect(md).not.toContain('Dead');
  });
});

describe('ensureGlossaryPage', () => {
  test('injects a reserved glossary page when absent', () => {
    const out = ensureGlossaryPage(pages);
    const g = out.find((p) => p.id === GLOSSARY_PAGE_ID);
    expect(g).toBeDefined();
    expect(g!.docType).toBe('reference');
  });
  test('is idempotent', () => {
    const once = ensureGlossaryPage(pages);
    const twice = ensureGlossaryPage(once);
    expect(twice.filter((p) => p.id === GLOSSARY_PAGE_ID)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/output/__tests__/glossary-page.test.ts`
Expected: FAIL (`Cannot find module '../glossary-page.js'`).

- [ ] **Step 3: Implement glossary-page.ts**

Create `packages/utils/src/output/glossary-page.ts`:

```typescript
import type { GlossaryTerm, WikiPage } from '@open-zread/types';

export const GLOSSARY_PAGE_ID = 'glossary-page';
export const GLOSSARY_PAGE_SLUG = 'glossary';
export const GLOSSARY_PAGE_SECTION = '术语表';
export const GLOSSARY_PAGE_FILE = 'glossary.md';

/** Deterministically render the unified glossary + bidirectional term<->page mapping. No LLM. */
export function renderGlossaryPage(glossary: GlossaryTerm[], pages: WikiPage[]): string {
  const active = pages.filter((p) => p.status !== 'tombstone');
  const lines: string[] = ['# 统一术语表', ''];

  if (glossary.length === 0) {
    lines.push('（暂无术语）', '');
    return lines.join('\n');
  }

  for (const term of glossary) {
    lines.push(`## ${term.term}`, '');
    if (term.aliases && term.aliases.length > 0) {
      lines.push(`**别名**：${term.aliases.join('、')}`, '');
    }
    lines.push(term.definition, '');

    const canonical = term.canonicalPage
      ? active.find((p) => p.slug === term.canonicalPage)
      : undefined;
    if (canonical) {
      lines.push(`**权威页面**：[${canonical.title}](${canonical.section}/${canonical.file})`, '');
    }

    const appearsIn = active.filter((p) => p.concepts?.includes(term.term));
    if (appearsIn.length > 0) {
      lines.push('**出现于**：');
      for (const p of appearsIn) {
        lines.push(`- [${p.title}](${p.section}/${p.file})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Ensure a reserved, stable glossary page exists in the catalog. Idempotent. */
export function ensureGlossaryPage(pages: WikiPage[]): WikiPage[] {
  if (pages.some((p) => p.id === GLOSSARY_PAGE_ID)) return pages;
  const glossaryPage: WikiPage = {
    id: GLOSSARY_PAGE_ID,
    slug: GLOSSARY_PAGE_SLUG,
    title: '统一术语表',
    file: GLOSSARY_PAGE_FILE,
    section: GLOSSARY_PAGE_SECTION,
    level: 'Beginner',
    docType: 'reference',
    origin: 'ai',
    locked: false,
    status: 'active',
  };
  return [...pages, glossaryPage];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/output/__tests__/glossary-page.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/output/glossary-page.ts packages/utils/src/output/__tests__/glossary-page.test.ts
git commit -m "feat(utils): deterministic glossary page renderer + reserved page"
```

---

## Task 7: Render glossary page during finalize

**Files:**
- Modify: `packages/utils/src/output/finalize.ts`
- Modify: `packages/utils/src/index.ts`
- Test: `packages/utils/src/output/__tests__/finalize-glossary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/output/__tests__/finalize-glossary.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWiki } from '../finalize.js';
import { GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE } from '../glossary-page.js';
import type { GlossaryTerm, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('finalize glossary page', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('writes glossary.md and lists it in the sidebar', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fg-'));
    const pages = [page({ slug: 'skill', title: '技能系统', file: 'skill.md', section: 'Sec', concepts: ['技能系统'] })];
    mkdirSync(join(dir, 'Sec'), { recursive: true });
    writeFileSync(join(dir, 'Sec', 'skill.md'), '# x\n', 'utf-8');
    const glossary: GlossaryTerm[] = [{ term: '技能系统', definition: 'def', canonicalPage: 'skill' }];

    await finalizeWiki(dir, { pages, glossary });

    expect(existsSync(join(dir, GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE))).toBe(true);
    const sidebar = readFileSync(join(dir, '_sidebar.md'), 'utf-8');
    expect(sidebar).toContain('统一术语表');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/output/__tests__/finalize-glossary.test.ts`
Expected: FAIL (glossary.md not written; FinalizeOptions has no `glossary`).

- [ ] **Step 3: Extend FinalizeOptions and finalize flow**

In `packages/utils/src/output/finalize.ts`:

Add imports at the top:

```typescript
import { ensureGlossaryPage, renderGlossaryPage, GLOSSARY_PAGE_ID, GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE } from './glossary-page.js';
import type { GlossaryTerm } from '@open-zread/types';
```

Add `glossary?` to `FinalizeOptions`:

```typescript
  glossary?: GlossaryTerm[];
```

In `finalizeWiki`, immediately after the function body begins (before `sanitizeLinks`), inject the glossary page rendering when glossary + pages are present. Insert:

```typescript
  // Glossary page: deterministically rendered, honors lock (locked => not refreshed).
  if (options?.glossary && options.pages) {
    const withGlossary = ensureGlossaryPage(options.pages);
    const gp = withGlossary.find((p) => p.id === GLOSSARY_PAGE_ID);
    if (gp && !gp.locked) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      mkdirSync(join(wikiPath, GLOSSARY_PAGE_SECTION), { recursive: true });
      writeFileSync(
        join(wikiPath, GLOSSARY_PAGE_SECTION, GLOSSARY_PAGE_FILE),
        renderGlossaryPage(options.glossary, withGlossary),
        'utf-8',
      );
    }
    // Ensure the glossary page is part of the pages used for sidebar generation.
    options = { ...options, pages: withGlossary };
  }
```

> Note: `wikiPath` is the finalize function's first parameter. Confirm the parameter name in `finalizeWiki` and use it (`to confirm` if different).

- [ ] **Step 4: Export glossary-page helpers from utils index**

In `packages/utils/src/index.ts`, add under Output exports:

```typescript
export { renderGlossaryPage, ensureGlossaryPage, GLOSSARY_PAGE_ID } from './output/glossary-page.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/output/__tests__/finalize-glossary.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire glossary into the generation finalize call**

In `packages/orchestrator/src/wiki/generate-wiki.ts`, find the `finalizeWiki(wikiDir, { pages, audit: true })` call and pass the glossary loaded from the blueprint (the blueprint is already loaded earlier as `blueprint`; if not in scope, load via `loadWikiBlueprint`). Change to:

```typescript
    const finalizeResult = await finalizeWiki(wikiDir, {
      pages,
      audit: true,
      glossary: (await loadWikiBlueprint(options?.blueprintPath).catch(() => undefined))?.glossary,
    });
```

> `to confirm`: prefer reusing an already-loaded blueprint variable if present in `generateWikiContent` to avoid a redundant load.

- [ ] **Step 7: Typecheck + full utils tests**

Run: `bun run typecheck && cd packages/utils && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/utils/src/output/finalize.ts packages/utils/src/index.ts packages/utils/src/output/__tests__/finalize-glossary.test.ts packages/orchestrator/src/wiki/generate-wiki.ts
git commit -m "feat(finalize): render unified glossary page from glossary + concepts"
```

---

## Task 8: Phase A green gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: PASS (16 tasks successful).

- [ ] **Step 2: Full lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Full test suites**

Run: `cd packages/utils && bun test` then `cd packages/orchestrator && bun test`
Expected: all pass (new catalog + glossary-page tests included).

- [ ] **Step 4: Update OpenSpec tasks.md checkboxes (allowed: it is a tasks tracker, not a spec contract)**

Mark A1.1–A1.4, A2.1–A2.2, A4.1–A4.4 done in `openspec/changes/living-catalog/tasks.md`. Leave A3.* (TUI editor) for the follow-on UI work.

> Note: A3 (TUI catalog editor) is intentionally NOT in this plan — it is UI with no test infra and is better executed after these foundations land. It will be in the Phase A-UI follow-on plan.

- [ ] **Step 5: Commit**

```bash
git add openspec/changes/living-catalog/tasks.md
git commit -m "chore(living-catalog): mark Phase A foundation tasks complete"
```

---

## Follow-on plans (NOT in this file)

- **Phase A-UI** — TUI catalog editor (plan-ready Tasks 10–12): tree view, mutations wired to `node-ops`, home entry + i18n. Manual `bun run dev` verification.
- **Phase B** — reconciliation (plan-ready Tasks 14–23): BASE-from-snapshot, concept-channel alignment, 3-way merge matrix, hard-lock, regenerate-as-proposal, TUI merge review, glossary-anchored naming. Closes the diataxis-migration gap.
- **Phase C** — topic scopes + deep-dive (plan-ready Tasks 24–29): scope persistence, deep-dive scoped sub-catalog generation merged via the Phase B engine.

Each follow-on gets its own `docs/superpowers/plans/<date>-living-catalog-<phase>.md`, generated after the prior phase merges so it can reference concrete interfaces.

---

## Self-Review

**Spec coverage (Phase A scope):**
- `catalog-editable-model` → Tasks 1 (fields), 2 (migration), 3 (persistence), 4 (tombstone). ✓
- `catalog-glossary-page` → Tasks 6 (renderer + bidirectional mapping + no-LLM), 7 (finalize render + lock honored). ✓
- Shared node ops (design D5) → Task 5. ✓
- `concepts` field + page→many (D1) → Task 1 + used in Task 6. ✓
- Out of Phase-A scope by design: TUI editor (A3), reconciliation (B), scopes/deep-dive (C) → listed as follow-on.

**Placeholder scan:** all code steps contain complete code; `to confirm` markers only on the two finalize integration points (parameter name, reuse of loaded blueprint), which are real discovery items, not vague placeholders.

**Type consistency:** `deriveId`/`migrateCatalog` (Task 2) reused in Tasks 3, 5; `GLOSSARY_PAGE_ID`/`_SECTION`/`_FILE` defined in Task 6 and consumed in Task 7; `WikiPage` fields defined in Task 1 used consistently throughout.
