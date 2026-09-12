# Living Catalog — Phase A-UI Implementation Plan (TUI Catalog Editor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An interactive Ink TUI catalog editor that lets the user add / rename / move / soft-delete / lock / set-depth pages over the live catalog, then save (write `wiki.json` + re-run finalize). (Phase A-UI of `living-catalog`; plan-ready Tasks 10–12.)

**Architecture:** Keep the editor's pure logic in `packages/utils/src/catalog/` (proven `bun test` infra) — a `buildCatalogTree` tree builder unit-tested there. The Ink view holds the working `pages` in `useState` (migrated from the provider's raw catalog), applies the already-tested pure node-ops (`addPage`/`updatePage`/`tombstonePage`/`movePage`/`toggleLock`/`setDepth`) to produce new state, and on save calls the existing `generateWikiJson` + `finalizeWiki`. The view is verified by typecheck + lint + a manual `bun run dev` smoke (Ink JSX has no proven test path in this repo; `ink-testing-library` exists but is unused).

**Tech Stack:** Ink 4 + React 18, `ink-text-input`, `ink-select-input`, react-router (MemoryRouter), `bun:test` (for the pure tree builder), `@open-zread/utils` (node-ops, generateWikiJson, finalizeWiki, migrateCatalog).

**Source (locked handoff):**
- plan-ready.md: `openspec/changes/living-catalog/plan-ready.md` (Tasks 10–12)
- design.md: D5 (editor reuses node-ops), D-lock 2 (real TUI editor), D-lock 3 (lock)
- specs: `catalog-tui-editor`

**Grounded facts (verified in code):**
- Routes are registered in `apps/cli/src/App.tsx`; Wiki routes live under `<Route element={<WikiProvider />}>`.
- `WikiProvider` (`apps/cli/src/provider/wiki/wiki-provider.tsx`) exposes `useWiki()` → `{ wikiCatalog: WikiOutput | null, reload }`. It reads `wiki.json` RAW (no migration), so the editor MUST run `migrateCatalog` on it to get `id`s before editing.
- Existing view pattern: `apps/cli/src/views/config-concurrency/index.tsx` (TextInput + `useInput` + navigate), `apps/cli/src/views/wiki-home/index.tsx` (SelectInput menu, i18n, navigate).
- i18n: keys typed canonically in `apps/cli/src/i18n/types.ts`; values in `translations/zh-CN.ts` + `en-US.ts`. (Adding a key WITHOUT updating `types.ts` fails typecheck — known gotcha.)
- Node-ops signatures (pure, return new arrays): `addPage(pages, input)`, `updatePage(pages, id, patch)`, `tombstonePage(pages, id)`, `movePage(pages, id, section, group?)`, `toggleLock(pages, id)`, `setDepth(pages, id, depth)`. Exported from `@open-zread/utils`.
- `migrateCatalog`, `generateWikiJson`, `finalizeWiki`, `loadConfig`, `getWikiDir` all exported from `@open-zread/utils`.

**Scope note:** This plan covers the TUI editor only. Phase B (reconciliation) and C (scopes/deep-dive) are separate follow-on plans.

**Do not edit OpenSpec artifacts during build.** Record any spec gaps in `openspec/changes/living-catalog/implementation-notes.md`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/utils/src/catalog/tree.ts` (create) | `buildCatalogTree(pages, opts?)` — pure section→group→page tree + flat nav order |
| `packages/utils/src/catalog/__tests__/tree.test.ts` (create) | unit tests for the tree builder |
| `packages/utils/src/catalog/index.ts` (modify) | export the tree builder |
| `apps/cli/src/views/catalog-editor/index.tsx` (create) | the Ink editor view (render + keys + save) |
| `apps/cli/src/views/catalog-editor/persist.ts` (create) | `persistCatalog(output, pages)` — generateWikiJson + finalizeWiki wrapper |
| `apps/cli/src/App.tsx` (modify) | register `/wiki/catalog-editor` route under WikiProvider |
| `apps/cli/src/views/wiki-home/index.tsx` (modify) | add "目录编辑器" menu entry |
| `apps/cli/src/i18n/types.ts` + `translations/{zh-CN,en-US}.ts` (modify) | i18n keys |

---

## Task UI-1: Pure catalog tree builder (TDD)

**Files:**
- Create: `packages/utils/src/catalog/tree.ts`
- Modify: `packages/utils/src/catalog/index.ts`
- Test: `packages/utils/src/catalog/__tests__/tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/tree.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { buildCatalogTree } from '../tree.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('buildCatalogTree', () => {
  test('groups pages by section then group, preserving first-seen order', () => {
    const pages = [
      page({ id: 'a', section: 'Engine', group: 'Core', title: 'A' }),
      page({ id: 'b', section: 'Engine', title: 'B' }),               // direct (no group)
      page({ id: 'c', section: 'Combat', group: 'Skill', title: 'C' }),
      page({ id: 'd', section: 'Engine', group: 'Core', title: 'D' }),
    ];
    const tree = buildCatalogTree(pages);
    expect(tree.sections.map((s) => s.section)).toEqual(['Engine', 'Combat']);
    const engine = tree.sections[0];
    expect(engine.directPages.map((p) => p.id)).toEqual(['b']);
    expect(engine.groups.map((g) => g.group)).toEqual(['Core']);
    expect(engine.groups[0].pages.map((p) => p.id)).toEqual(['a', 'd']);
  });

  test('flat is the render/nav order: per section, direct pages then grouped pages', () => {
    const pages = [
      page({ id: 'a', section: 'Engine', group: 'Core' }),
      page({ id: 'b', section: 'Engine' }),
      page({ id: 'c', section: 'Combat' }),
    ];
    const tree = buildCatalogTree(pages);
    expect(tree.flat.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('excludes tombstoned pages by default', () => {
    const pages = [page({ id: 'a' }), page({ id: 'dead', status: 'tombstone' })];
    expect(buildCatalogTree(pages).flat.map((p) => p.id)).toEqual(['a']);
  });

  test('includes tombstoned pages when includeTombstoned=true', () => {
    const pages = [page({ id: 'a' }), page({ id: 'dead', status: 'tombstone' })];
    const tree = buildCatalogTree(pages, { includeTombstoned: true });
    expect(tree.flat.map((p) => p.id)).toEqual(['a', 'dead']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/utils && bun test src/catalog/__tests__/tree.test.ts`
Expected: FAIL (`Cannot find module '../tree.js'`).

- [ ] **Step 3: Implement tree.ts**

Create `packages/utils/src/catalog/tree.ts`:

```typescript
import type { WikiPage } from '@open-zread/types';

export interface CatalogTreeGroup {
  group: string;
  pages: WikiPage[];
}

export interface CatalogTreeSection {
  section: string;
  directPages: WikiPage[];
  groups: CatalogTreeGroup[];
}

export interface CatalogTree {
  sections: CatalogTreeSection[];
  /** Flattened render/navigation order: per section, direct pages first, then grouped pages. */
  flat: WikiPage[];
}

/**
 * Build a section -> group -> page tree from a flat pages list, preserving first-seen order.
 * Tombstoned pages are excluded unless opts.includeTombstoned is true.
 */
export function buildCatalogTree(
  pages: WikiPage[],
  opts?: { includeTombstoned?: boolean },
): CatalogTree {
  const visible = opts?.includeTombstoned
    ? pages
    : pages.filter((p) => p.status !== 'tombstone');

  const sections: CatalogTreeSection[] = [];
  const sectionIndex = new Map<string, CatalogTreeSection>();

  for (const page of visible) {
    let sec = sectionIndex.get(page.section);
    if (!sec) {
      sec = { section: page.section, directPages: [], groups: [] };
      sectionIndex.set(page.section, sec);
      sections.push(sec);
    }
    if (page.group) {
      let grp = sec.groups.find((g) => g.group === page.group);
      if (!grp) {
        grp = { group: page.group, pages: [] };
        sec.groups.push(grp);
      }
      grp.pages.push(page);
    } else {
      sec.directPages.push(page);
    }
  }

  const flat: WikiPage[] = [];
  for (const sec of sections) {
    flat.push(...sec.directPages);
    for (const grp of sec.groups) flat.push(...grp.pages);
  }

  return { sections, flat };
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/utils/src/catalog/index.ts`, add:

```typescript
export { buildCatalogTree } from './tree.js';
export type { CatalogTree, CatalogTreeSection, CatalogTreeGroup } from './tree.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/utils && bun test src/catalog/__tests__/tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Re-export from utils index + typecheck**

In `packages/utils/src/index.ts`, extend the Catalog export line to include the tree builder:

```typescript
export { deriveId, migrateCatalog, buildCatalogTree } from './catalog/index.js';
```

Run: `bun run typecheck` (expected PASS), `bun run lint` (expected clean).

- [ ] **Step 7: Commit**

```bash
git add packages/utils/src/catalog/tree.ts packages/utils/src/catalog/index.ts packages/utils/src/catalog/__tests__/tree.test.ts packages/utils/src/index.ts
git commit -m "feat(utils): pure catalog tree builder for the editor view" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task UI-2: Persist helper + editor view skeleton (render + navigation)

**Files:**
- Create: `apps/cli/src/views/catalog-editor/persist.ts`
- Create: `apps/cli/src/views/catalog-editor/index.tsx`
- Modify: `apps/cli/src/App.tsx`

- [ ] **Step 1: Create the persist helper**

Create `apps/cli/src/views/catalog-editor/persist.ts`:

```typescript
import type { WikiOutput, WikiPage } from "@open-zread/types";
import { loadConfig, generateWikiJson, finalizeWiki, getWikiDir } from "@open-zread/utils";

/**
 * Persist edited catalog pages: rewrite wiki.json then re-run finalize
 * (sidebar + index + glossary page). Reuses already-tested utils.
 */
export async function persistCatalog(output: WikiOutput, pages: WikiPage[]): Promise<void> {
  const config = await loadConfig();
  await generateWikiJson(pages, config, output.techStackSummary, output.glossary);
  await finalizeWiki(getWikiDir(), { pages, glossary: output.glossary });
}
```

- [ ] **Step 2: Create the editor view (skeleton: render tree + ↑/↓ nav, no mutations yet)**

Create `apps/cli/src/views/catalog-editor/index.tsx`. Requirements for this step (write idiomatic Ink JSX following the pattern in `apps/cli/src/views/config-concurrency/index.tsx` and `apps/cli/src/views/wiki-home/index.tsx`):

- Import: `useState, useMemo` from react; `Box, Text, useInput` from ink; `useWiki` from `../../provider`; `useI18n` from `../../i18n`; `migrateCatalog, buildCatalogTree` from `@open-zread/utils`; types `WikiPage` from `@open-zread/types`; `Divider` from `../../components/Divider` (check the actual export path/name used by wiki-home — it imports `Divider from '../../components/Divider'`).
- On mount, derive the working pages from the provider catalog WITH migration so ids exist:
  ```typescript
  const { wikiCatalog, reload } = useWiki();
  const [pages, setPages] = useState<WikiPage[]>(() =>
    wikiCatalog ? migrateCatalog(wikiCatalog).pages : []
  );
  ```
- Build the tree INCLUDING tombstoned (so the user can see/undelete them):
  ```typescript
  const tree = useMemo(() => buildCatalogTree(pages, { includeTombstoned: true }), [pages]);
  ```
- Maintain `const [cursor, setCursor] = useState(0)` indexing into `tree.flat`.
- `useInput`: ArrowUp/`k` → `setCursor((c) => Math.max(0, c - 1))`; ArrowDown/`j` → `setCursor((c) => Math.min(tree.flat.length - 1, c + 1))`. (ESC/back is handled by the shared Layout — do NOT handle ESC here.)
- Render: a `Divider` title (use an i18n key `catalogEditor.title`, added in UI-5 — for this step you may temporarily hardcode "目录编辑器" and replace with `t('catalogEditor.title')` in UI-5). Then iterate `tree.sections`: render a bold section header `**section**`; for `directPages` and each group's pages, render one line per page. The selected page (where `tree.flat[cursor].id === page.id`) is highlighted (bold + cyan, like wiki-home's itemComponent). Each page line shows indicators: `🔒` when `locked`, `[deep]` when `depth==='deep'`, and dim/strikethrough style + `(deleted)` when `status==='tombstone'`.
- A footer line listing keybindings (will be finalized in UI-3/UI-4): for now `↑/↓ 导航 | ESC 返回`.

Keep the component focused; it's one file with one responsibility (the editor). Do not add mutation handlers yet (those are UI-3/UI-4).

- [ ] **Step 3: Register the route**

In `apps/cli/src/App.tsx`:
- Add import near the other Wiki imports: `import CatalogEditorPage from "./views/catalog-editor";`
- Inside `<Route element={<WikiProvider />}>`, add: `<Route path="/wiki/catalog-editor" element={<CatalogEditorPage />} />`

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck` (expected PASS), `bun run lint` (expected clean). Fix anything introduced.

- [ ] **Step 5: Manual smoke (note in report; do not block commit on interactivity)**

Note for the report: the route exists and the view typechecks. Full interactive verification is done at UI-5 via `bun run dev`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/views/catalog-editor/ apps/cli/src/App.tsx
git commit -m "feat(cli): catalog editor view skeleton (tree render + navigation)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task UI-3: Toggle mutations + save

**Files:**
- Modify: `apps/cli/src/views/catalog-editor/index.tsx`

- [ ] **Step 1: Add toggle mutations wired to node-ops**

Import the node-ops from `@open-zread/utils`: `toggleLock, tombstonePage, setDepth, updatePage`. Also import `persistCatalog` from `./persist.js`.

In the editor, add a `const selected = tree.flat[cursor]` convenience. Extend `useInput` with these keys (each updates `pages` via a node-op, producing new state; cursor stays put):
- `l` → `setPages((ps) => toggleLock(ps, selected.id!))`
- `x` → if `selected.status !== 'tombstone'`: `setPages((ps) => tombstonePage(ps, selected.id!))`
- `u` (undelete) → if `selected.status === 'tombstone'`: `setPages((ps) => updatePage(ps, selected.id!, { status: 'active' }))`
- `p` (depth) → `setPages((ps) => setDepth(ps, selected.id!, selected.depth === 'deep' ? 'standard' : 'deep'))`

Guard every handler with `if (!selected?.id) return;`.

- [ ] **Step 2: Add save (`s`) + a dirty/saved status**

Add `const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')` and a `dirty` flag (`useState(false)`, set true on any mutation).

On `s`: if `wikiCatalog` and `status === 'idle'`:
```typescript
setStatus('saving');
persistCatalog(wikiCatalog, pages)
  .then(() => reload())
  .then(() => { setStatus('saved'); setDirty(false); setTimeout(() => setStatus('idle'), 1500); })
  .catch(() => { setStatus('failed'); setTimeout(() => setStatus('idle'), 2500); });
```

Render the status next to the title (e.g. `saving… / saved ✓ / save failed`) and a `*` dirty marker.

Update the footer keybinding hint to include: `l 锁定 | x 删除 | u 恢复 | p 深度 | s 保存`.

- [ ] **Step 2.5: Self-check the lock semantics**

`toggleLock` flips `locked`; locked pages still display and are editable in the editor (the hard-lock guarantee applies to AI reconciliation in Phase B, NOT to manual editing — the user owns their own edits). Confirm you did not block manual edits on locked pages.

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck`, `bun run lint`. Fix anything introduced.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/views/catalog-editor/index.tsx
git commit -m "feat(cli): catalog editor lock/delete/depth toggles + save" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task UI-4: Text-edit mutations (add / rename) + move

**Files:**
- Modify: `apps/cli/src/views/catalog-editor/index.tsx`

- [ ] **Step 1: Add an edit sub-mode state machine**

Introduce `const [mode, setMode] = useState<'browse' | 'add' | 'rename' | 'move'>('browse')` and `const [draft, setDraft] = useState('')`. While `mode !== 'browse'`, the main `useInput` navigation/toggle keys must be INERT (early-return at the top of the handler when `mode !== 'browse'`), so typing goes to the sub-mode input.

- [ ] **Step 2: Rename (`r`) via TextInput**

In `browse` mode, `r` → `setDraft(selected.title); setMode('rename')`.
When `mode === 'rename'`, render `<TextInput value={draft} onChange={setDraft} onSubmit={...}/>` (import `TextInput from 'ink-text-input'`). On submit: `setPages((ps) => updatePage(ps, selected.id!, { title: draft.trim() || selected.title })); setDirty(true); setMode('browse')`. (Do not change slug/file — only the display title, per the spec "rename keeps identity".)

- [ ] **Step 3: Add (`a`) via TextInput**

In `browse` mode, `a` → `setDraft(''); setMode('add')`.
When `mode === 'add'`, render a TextInput prompting for the new page title. On submit, create a page in the selected page's section using `addPage` (import from `@open-zread/utils`):
```typescript
const title = draft.trim();
if (title) {
  const slug = `custom-${Date.now()}`;
  setPages((ps) => addPage(ps, {
    slug, title, file: `${slug}.md`,
    section: selected?.section ?? '未分类',
    group: selected?.group,
    level: 'Intermediate',
  }));
  setDirty(true);
}
setMode('browse');
```
`addPage` already sets `origin: 'human'`, fresh `id`, `status: 'active'`.

- [ ] **Step 4: Move (`m`) via section SelectInput**

In `browse` mode, `m` → `setMode('move')`.
When `mode === 'move'`, render `<SelectInput items={...} onSelect={...}/>` (import `SelectInput from 'ink-select-input'`) whose items are the distinct existing section names (`[...new Set(pages.filter(p=>p.status!=='tombstone').map(p=>p.section))]`) mapped to `{ label, value }`. On select: `setPages((ps) => movePage(ps, selected.id!, value)); setDirty(true); setMode('browse')`. (Group move can stay undefined for v1 — moving clears the group; acceptable.)

- [ ] **Step 5: Footer + mode hints**

Update footer: in browse mode show `a 新增 | r 重命名 | m 移动 | l 锁定 | x 删除 | u 恢复 | p 深度 | s 保存`; in edit modes show a short hint like `输入后回车确认`.

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck`, `bun run lint`. Fix anything introduced.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/views/catalog-editor/index.tsx
git commit -m "feat(cli): catalog editor add/rename/move via text + section select" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task UI-5: Home entry + i18n + green gate

**Files:**
- Modify: `apps/cli/src/i18n/types.ts`, `apps/cli/src/i18n/translations/zh-CN.ts`, `apps/cli/src/i18n/translations/en-US.ts`
- Modify: `apps/cli/src/views/wiki-home/index.tsx`
- Modify: `apps/cli/src/views/catalog-editor/index.tsx` (swap hardcoded strings for i18n)

- [ ] **Step 1: Add i18n keys**

In `apps/cli/src/i18n/types.ts`, inside the `wiki` block add `catalogEditor: string;` AND add a new top-level block type:
```typescript
  catalogEditor: {
    title: string;
    saving: string;
    saved: string;
    failed: string;
    hintBrowse: string;
    hintEdit: string;
  };
```
In `translations/zh-CN.ts`: add `catalogEditor: '目录编辑器'` inside the `wiki` block (the menu label), and a top-level `catalogEditor` object:
```typescript
  catalogEditor: {
    title: '目录编辑器',
    saving: '保存中…',
    saved: '已保存 ✓',
    failed: '保存失败',
    hintBrowse: 'a 新增 | r 重命名 | m 移动 | l 锁定 | x 删除 | u 恢复 | p 深度 | s 保存 | ESC 返回',
    hintEdit: '输入后回车确认 | ESC 取消',
  },
```
In `translations/en-US.ts`: mirror with English (`wiki.catalogEditor: 'Catalog Editor'`, and a top-level `catalogEditor` block with English strings).

- [ ] **Step 2: Add the home menu entry**

In `apps/cli/src/views/wiki-home/index.tsx` `buildNormalSelectItems`, where the completed-wiki entries are pushed (manage/browse/incremental), add:
```typescript
    items.push({ label: t('wiki.catalogEditor'), value: 'catalog-editor' });
```
and in `handleSelect`, add a case:
```typescript
      case 'catalog-editor':
        navigate('/wiki/catalog-editor');
        break;
```

- [ ] **Step 3: Swap editor hardcoded strings for i18n**

In `catalog-editor/index.tsx`, replace the hardcoded title/status/footer strings with `t('catalogEditor.title')`, `t('catalogEditor.saving' | 'saved' | 'failed')`, `t('catalogEditor.hintBrowse')`, `t('catalogEditor.hintEdit')`.

- [ ] **Step 4: Green gate**

Run from `F:/open-zread`:
- `bun run typecheck` → expect 16/16 PASS (i18n keys must exist in `TranslationKeys` or this fails).
- `bun run lint` → expect 0 errors.
- `cd packages/utils && bun test` → expect all pass (incl. tree builder).

- [ ] **Step 5: Manual smoke (REQUIRED — record the result honestly)**

Run `bun run dev`. In the wiki home (requires an existing completed wiki under `.open-zread/`), select "目录编辑器". Verify: tree renders; ↑/↓ moves the highlight; `l` toggles a 🔒 indicator; `x` marks a page `(deleted)`; `a`/`r` open a text prompt; `s` shows "已保存 ✓" and the `_sidebar.md` on disk reflects the edit. If you cannot run the interactive app in this environment, say so explicitly and report that verification is limited to typecheck/lint/tree-tests — do NOT claim interactive verification you didn't perform.

- [ ] **Step 6: Mark plan-ready A3 tasks + commit**

In `openspec/changes/living-catalog/tasks.md`, mark `A3.1`–`A3.5` done.
```bash
git add apps/cli/src/i18n/ apps/cli/src/views/wiki-home/index.tsx apps/cli/src/views/catalog-editor/index.tsx openspec/changes/living-catalog/tasks.md
git commit -m "feat(cli): wire catalog editor into wiki home + i18n" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (`catalog-tui-editor`):**
- TUI editor reachable from home → UI-5 (menu entry + route). ✓
- Lists catalog tree (section→group→page) → UI-1 (tree builder) + UI-2 (render). ✓
- Add (origin human, fresh id) / rename (keeps id) / move / soft-delete (tombstone) → UI-3 (delete) + UI-4 (add/rename/move). ✓
- Lock toggle / depth set → UI-3. ✓
- Save writes wiki.json + re-runs finalize → UI-2 (persist) + UI-3 (save key). ✓
- Reuses shared node-ops (D5) → UI-3/UI-4 call node-ops directly. ✓

**Placeholder scan:** UI-1 is fully coded with tests. UI-2–UI-5 specify exact state, keybindings, node-op calls, file paths, and i18n keys; the Ink JSX is to be written following the cited existing view patterns (config-concurrency, wiki-home) — this is an intentional, controller-approved deviation from full-JSX because copy-paste JSX is more error-prone than precise specs + verified gates. No "TBD"/"handle edge cases" placeholders.

**Type consistency:** `buildCatalogTree`/`CatalogTree` defined in UI-1 and consumed in UI-2; node-ops names match the Phase-A exports (`toggleLock`/`tombstonePage`/`setDepth`/`updatePage`/`addPage`/`movePage`); `persistCatalog(output, pages)` defined in UI-2 and called in UI-3; i18n key `catalogEditor.*` defined in UI-5 and referenced in UI-2/UI-3 (temporarily hardcoded until UI-5 swaps them).

**Testability honesty:** Only the pure tree builder is unit-tested (proven `bun test`). The Ink view is gated by typecheck + lint + a REQUIRED manual smoke whose result must be reported honestly (no fabricated interactive verification).
