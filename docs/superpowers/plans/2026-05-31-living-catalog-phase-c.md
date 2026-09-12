# Living Catalog — Phase C Implementation Plan (Topic Scopes + Deep-Dive)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) Named **topic scopes** — save/load a themed selection of pages. (2) **Deep-dive** — explode a topic page into a focused sub-tree of child pages via a scoped Catalog Agent run, reviewed + merged through the existing merge-review UI as ADD proposals. (Phase C of `living-catalog`; plan-ready Tasks 24–29.)

**Architecture:** Two pure, unit-tested cores in `packages/utils/src/catalog/`: `scopes.ts` (persistence + stale-id-tolerant resolution) and `deepdive.ts` (child normalization + adds-only plan). Deep-dive **reuses the entire Phase B-Flow merge-review view** by producing an adds-only `CatalogMergePlan` — the orchestration runs a scoped agent (backup/restore, like B-Flow) and is typecheck-gated. Editor gains multi-select + scope save/load + a deep-dive trigger; the merge view gains a `?deepDive=<id>` branch. TUI is typecheck/lint-gated + manual smoke.

**Tech Stack:** TypeScript, `bun:test` (scopes + deepdive cores), `@open-zread/utils`, `@open-zread/orchestrator`, Ink 4.

**Source (locked handoff):**
- plan-ready.md: `openspec/changes/living-catalog/plan-ready.md` (Tasks 24–29)
- design.md: D-lock 1 (themed collection), D-lock 4 (explode into sub-tree), `catalog-topic-scopes`, `catalog-deep-dive` specs

**Grounded facts (verified):**
- `TopicScope` (in `@open-zread/types`): `{ name; description?; pageIds: string[]; createdAt }`.
- `getWikiDir()` from `@open-zread/utils`; scopes live at `<wikiDir>/scopes/<name>.json`.
- Phase B exports: `computeMergePlan`, `applyMergePlan`, `migrateCatalog`, `deriveId` (utils); `generateCatalogProposal`, `persistMergedCatalog`, `CatalogProposal` (orchestrator). The merge-review view is `apps/cli/src/views/catalog-merge/index.tsx` (calls `generateCatalogProposal`; phase state machine; review→apply).
- Editor `apps/cli/src/views/catalog-editor/index.tsx`: `mode` state machine ('browse'|'add'|'rename'|'move'), `selected = tree.flat[cursor]`, free keys include `v`, `D`. Sub-modes use TextInput/SelectInput + `useEscHandler`.
- Catalog agent: `generateWikiCatalog(onEvent?)` (orchestrator.ts) runs `createAgent` with `BLUEPRINT_TOOLS` + the `GenerateCatalog` prompt and writes wiki.json.

**Verification honesty:** Only `scopes.ts` and `deepdive.ts` are unit-tested. The deep-dive scoped-agent orchestration (LLM), the editor scope/deep-dive wiring, and the merge-view deepDive branch are typecheck/lint-gated and need a live `bun run dev` + LLM run. The final report MUST say so.

**Do not edit OpenSpec artifacts during build.** Record gaps in `openspec/changes/living-catalog/implementation-notes.md`.

---

## Task C-1: Topic scope persistence (pure, TDD)

**Files:**
- Create: `packages/utils/src/catalog/scopes.ts`
- Modify: `packages/utils/src/catalog/index.ts`, `packages/utils/src/index.ts`
- Test: `packages/utils/src/catalog/__tests__/scopes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/scopes.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveScope, listScopes, loadScope, resolveScope } from '../scopes.js';
import type { TopicScope, WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate', ...p };
}
function scope(p: Partial<TopicScope>): TopicScope {
  return { name: 'n', pageIds: [], createdAt: 't', ...p };
}

describe('topic scopes', () => {
  let testDir = '';
  let originalCwd = '';
  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `scopes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });
  afterEach(() => { process.chdir(originalCwd); rmSync(testDir, { recursive: true, force: true }); });

  test('save -> list -> load round-trip', () => {
    saveScope(scope({ name: '战斗系统深潜', pageIds: ['a', 'b'] }));
    const all = listScopes();
    expect(all.map((s) => s.name)).toEqual(['战斗系统深潜']);
    const loaded = loadScope('战斗系统深潜');
    expect(loaded?.pageIds).toEqual(['a', 'b']);
  });

  test('loadScope returns null when missing', () => {
    expect(loadScope('nope')).toBeNull();
  });

  test('resolveScope ignores stale ids', () => {
    const pages = [page({ id: 'a', title: 'A' }), page({ id: 'c', title: 'C' })];
    const resolved = resolveScope(scope({ pageIds: ['a', 'gone', 'c'] }), pages);
    expect(resolved.map((p) => p.id)).toEqual(['a', 'c']);
  });

  test('listScopes returns [] when no scopes dir', () => {
    expect(listScopes()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd packages/utils && bun test src/catalog/__tests__/scopes.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `packages/utils/src/catalog/scopes.ts`**

```typescript
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
```

- [ ] **Step 4: Export** — in `packages/utils/src/catalog/index.ts` add `export { saveScope, listScopes, loadScope, resolveScope } from './scopes.js';`; in `packages/utils/src/index.ts` append `saveScope, listScopes, loadScope, resolveScope` to the `// Catalog` export list.

- [ ] **Step 5: Run to confirm pass** — `cd packages/utils && bun test src/catalog/__tests__/scopes.test.ts` → PASS (4 tests).

- [ ] **Step 6: typecheck + lint + commit**

`bun run typecheck` (16/16), `bun run lint` (clean). Then:
```bash
git add packages/utils/src/catalog/scopes.ts packages/utils/src/catalog/index.ts packages/utils/src/index.ts packages/utils/src/catalog/__tests__/scopes.test.ts
git commit -m "feat(utils): topic scope persistence (save/list/load/resolve, stale-id tolerant)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-2: Deep-dive child normalization (pure, TDD)

**Files:**
- Create: `packages/utils/src/catalog/deepdive.ts`
- Modify: `packages/utils/src/catalog/index.ts`, `packages/utils/src/index.ts`
- Test: `packages/utils/src/catalog/__tests__/deepdive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/catalog/__tests__/deepdive.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { normalizeDeepDiveChildren, buildAddsOnlyPlan, DEEP_DIVE_MAX_CHILDREN } from '../deepdive.js';
import type { WikiPage } from '@open-zread/types';

function page(p: Partial<WikiPage>): WikiPage {
  return { slug: 's', title: 'T', file: 's.md', section: 'S', level: 'Intermediate',
           id: 'id', origin: 'ai', locked: false, status: 'active', ...p };
}

describe('normalizeDeepDiveChildren', () => {
  const parent = page({ id: 'p', section: 'Combat', group: 'Skill', title: '技能系统' });

  test('inherits parent section/group, origin ai, fresh ids, active', () => {
    const kids = normalizeDeepDiveChildren([page({ slug: 'c1', title: 'C1', associatedFiles: ['x.cs'], section: 'wrong' })], parent);
    expect(kids).toHaveLength(1);
    expect(kids[0].section).toBe('Combat');
    expect(kids[0].group).toBe('Skill');
    expect(kids[0].origin).toBe('ai');
    expect(kids[0].status).toBe('active');
    expect(kids[0].id).toBeTruthy();
  });

  test('drops children without associatedFiles', () => {
    const kids = normalizeDeepDiveChildren([
      page({ slug: 'a', associatedFiles: ['x.cs'] }),
      page({ slug: 'b', associatedFiles: [] }),
      page({ slug: 'c' }),
    ], parent);
    expect(kids.map((k) => k.slug)).toEqual(['a']);
  });

  test('bounds to the max', () => {
    const many = Array.from({ length: DEEP_DIVE_MAX_CHILDREN + 3 }, (_, i) =>
      page({ slug: `c${i}`, associatedFiles: ['x.cs'] }));
    expect(normalizeDeepDiveChildren(many, parent)).toHaveLength(DEEP_DIVE_MAX_CHILDREN);
  });
});

describe('buildAddsOnlyPlan', () => {
  test('puts children in adds, everything else empty', () => {
    const children = [page({ id: 'a' }), page({ id: 'b' })];
    const plan = buildAddsOnlyPlan(children);
    expect(plan.adds.map((p) => p.id)).toEqual(['a', 'b']);
    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.removes).toHaveLength(0);
    expect(plan.kept).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd packages/utils && bun test src/catalog/__tests__/deepdive.test.ts` → FAIL.

- [ ] **Step 3: Implement `packages/utils/src/catalog/deepdive.ts`**

```typescript
import type { WikiPage, CatalogMergePlan } from '@open-zread/types';
import { deriveId } from './migrate.js';

export const DEEP_DIVE_MAX_CHILDREN = 6;

/**
 * Normalize proposed deep-dive children: require non-empty associatedFiles, bound the count,
 * inherit the parent's section/group, set origin 'ai' + active + unlocked, assign fresh ids.
 */
export function normalizeDeepDiveChildren(
  children: WikiPage[],
  parent: WikiPage,
  max: number = DEEP_DIVE_MAX_CHILDREN,
): WikiPage[] {
  return children
    .filter((c) => (c.associatedFiles?.length ?? 0) > 0)
    .slice(0, max)
    .map((c, i) => ({
      ...c,
      id: deriveId(`deepdive-${parent.id ?? parent.slug}-${i}-${c.slug}`),
      section: parent.section,
      group: parent.group,
      origin: 'ai' as const,
      status: 'active' as const,
      locked: false,
    }));
}

/** Build an adds-only merge plan so deep-dive children flow through the standard review/apply path. */
export function buildAddsOnlyPlan(children: WikiPage[]): CatalogMergePlan {
  return { adds: children, updates: [], conflicts: [], removes: [], kept: [] };
}
```

- [ ] **Step 4: Export** — in `packages/utils/src/catalog/index.ts` add `export { normalizeDeepDiveChildren, buildAddsOnlyPlan, DEEP_DIVE_MAX_CHILDREN } from './deepdive.js';`; in `packages/utils/src/index.ts` append those three to the `// Catalog` export list.

- [ ] **Step 5: Run to confirm pass** — PASS (4 tests).

- [ ] **Step 6: typecheck + lint + commit**

```bash
git add packages/utils/src/catalog/deepdive.ts packages/utils/src/catalog/index.ts packages/utils/src/index.ts packages/utils/src/catalog/__tests__/deepdive.test.ts
git commit -m "feat(utils): deep-dive child normalization + adds-only merge plan" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C-3: Deep-dive scoped agent + proposal orchestration

**Files:**
- Create: `packages/orchestrator/src/prompts/deep-dive.ts`
- Modify: `packages/orchestrator/src/orchestrator.ts` (add `generateDeepDiveCatalog`)
- Modify: `packages/orchestrator/src/wiki/reconcile.ts` (add `generateDeepDiveProposal`)
- Modify: `packages/orchestrator/src/index.ts` (export)

- [ ] **Step 1: Create the deep-dive prompt `packages/orchestrator/src/prompts/deep-dive.ts`**

```typescript
export function buildDeepDivePrompt(topicTitle: string, associatedFiles: string[]): string {
  return `你是一名资深架构师。现在请对一个**指定主题**进行深挖：把它展开为一组聚焦的子页面（sub-pages）。

## 深挖主题
**标题**: ${topicTitle}
**关联源文件/目录**:
${associatedFiles.map((f) => `- ${f}`).join('\n') || '（无）'}

## 任务
1. 仅围绕上述主题与其关联文件，使用三层 Repo Map 工具深入分析。
2. 产出 **3-6 个**高内聚的子页面，每个聚焦该主题下的一个独立子问题（如：生命周期、调度、数据结构、扩展点等）。
3. 每个子页面**必须**锚定真实源文件（associatedFiles 非空，精确到具体文件/子目录）。
4. 调用 \`generate_blueprint\`，pages 数组**只包含这些新的子页面**（不要包含主题页本身或其它已有页面）。为每个子页面填写 concepts（该页归属的规范术语）。

## 约束
- 子页面数量上限 6。无法锚定到真实文件的子问题不要产出。
- 标题精炼（20 字以内），slug 用英文中划线。

请开始分析并调用 generate_blueprint 输出子页面。`;
}
```

- [ ] **Step 2: Add `generateDeepDiveCatalog` to `packages/orchestrator/src/orchestrator.ts`**

Read the existing `generateWikiCatalog` in that file to mirror its `createAgent({ tools: BLUEPRINT_TOOLS, prompts, onEvent })` shape. Add an export that runs the agent with the deep-dive prompt:

```typescript
import { buildDeepDivePrompt } from './prompts/deep-dive.js';
import type { WikiPage } from '@open-zread/types';

/** Run the Catalog Agent scoped to a single topic, producing child sub-pages (writes wiki.json). */
export async function generateDeepDiveCatalog(
  topic: WikiPage,
  onEvent?: (event: CatalogEvent) => void,
): Promise<BlueprintResult> {
  const result = await createAgent({
    tools: BLUEPRINT_TOOLS,
    prompts: buildDeepDivePrompt(topic.title, topic.associatedFiles ?? []),
    onEvent,
  });
  return { pagesCount: 0, durationMs: result.durationMs, tokenUsage: result.tokenUsage };
}
```
(Match the exact import names already present in orchestrator.ts: `createAgent`, `BLUEPRINT_TOOLS`, `CatalogEvent`, `BlueprintResult`. If `BLUEPRINT_TOOLS` is a local const, reuse it.)

- [ ] **Step 3: Add `generateDeepDiveProposal` to `packages/orchestrator/src/wiki/reconcile.ts`**

```typescript
import { normalizeDeepDiveChildren, buildAddsOnlyPlan } from '@open-zread/utils';
import { generateDeepDiveCatalog } from '../orchestrator.js';

/**
 * Deep-dive a topic page: run a scoped agent to propose child sub-pages, normalize them,
 * and return an adds-only proposal that flows through the standard merge-review UI.
 */
export async function generateDeepDiveProposal(
  topicPageId: string,
  onEvent?: (e: CatalogEvent) => void,
): Promise<CatalogProposal> {
  const wikiJsonPath = getWikiJsonPath();
  const localContent = existsSync(wikiJsonPath) ? readFileSync(wikiJsonPath, 'utf-8') : null;
  if (localContent === null) throw new Error('深挖需要现有的 wiki.json');

  const current = migrateCatalog(JSON.parse(localContent) as WikiOutput);
  const topic = current.pages.find((p) => p.id === topicPageId);
  if (!topic) throw new Error('未找到深挖主题页面');

  let proposedRaw: WikiPage[];
  try {
    await generateDeepDiveCatalog(topic, onEvent); // overwrites wiki.json with the proposed children
    proposedRaw = migrateCatalog(JSON.parse(readFileSync(wikiJsonPath, 'utf-8')) as WikiOutput).pages;
  } finally {
    writeFileSync(wikiJsonPath, localContent, 'utf-8');
  }

  // Drop anything that collides with an existing page id; normalize the rest as children.
  const existingIds = new Set(current.pages.map((p) => p.id));
  const candidates = proposedRaw.filter((c) => !c.id || !existingIds.has(c.id));
  const children = normalizeDeepDiveChildren(candidates, topic);
  const plan = buildAddsOnlyPlan(children);

  logger.info(`深挖提案: 主题「${topic.title}」→ ${children.length} 个子页面`);
  return { plan, local: current.pages, remote: current };
}
```
Add the needed imports to the existing import lines (`migrateCatalog`, `getWikiJsonPath`, `logger` are already imported in reconcile.ts; add `normalizeDeepDiveChildren`, `buildAddsOnlyPlan` to the `@open-zread/utils` import, and `WikiPage` to the types import).

- [ ] **Step 4: Export from orchestrator index**

In `packages/orchestrator/src/index.ts` add:
```typescript
export { generateDeepDiveProposal } from './wiki/reconcile.js';
export { generateDeepDiveCatalog } from './orchestrator.js';
```

- [ ] **Step 5: typecheck + lint + commit**

`bun run typecheck` (16/16), `bun run lint` (clean). Reconcile any name mismatches by READING orchestrator.ts. Then:
```bash
git add packages/orchestrator/src/prompts/deep-dive.ts packages/orchestrator/src/orchestrator.ts packages/orchestrator/src/wiki/reconcile.ts packages/orchestrator/src/index.ts
git commit -m "feat(orchestrator): deep-dive scoped catalog agent + adds-only proposal" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: runs the LLM agent; behavior verified in manual smoke.

---

## Task C-4: Editor scope save/load + deep-dive trigger; merge-view deepDive branch

**Files:**
- Modify: `apps/cli/src/views/catalog-editor/index.tsx`
- Modify: `apps/cli/src/views/catalog-merge/index.tsx`
- Modify: i18n (`types.ts`, `zh-CN.ts`, `en-US.ts`)

- [ ] **Step 1: merge-view `?deepDive=<id>` branch**

In `apps/cli/src/views/catalog-merge/index.tsx`: import `useSearchParams` from `react-router` and `generateDeepDiveProposal` from `@open-zread/orchestrator`. Read `const [params] = useSearchParams(); const deepDiveId = params.get('deepDive');`. In the proposal effect, branch: if `deepDiveId`, call `generateDeepDiveProposal(deepDiveId, handleAgentEvent)`; else `generateCatalogProposal(handleAgentEvent)`. Everything else (review/apply/persist/generate) is unchanged — children arrive as ADDs. Optionally set the divider title to a deep-dive variant when `deepDiveId` is set (use an i18n key `catalogMerge.deepDiveTitle`).

- [ ] **Step 2: editor multi-select + scope save/load + deep-dive trigger**

In `apps/cli/src/views/catalog-editor/index.tsx`:
- Import `saveScope, listScopes, resolveScope` from `@open-zread/utils`, `useNavigate` from `react-router`, and `type TopicScope` from `@open-zread/types`.
- Add state: `const [selection, setSelection] = useState<Set<string>>(new Set());` and extend the `mode` union with `'saveScope' | 'loadScope'`.
- In `useInput` (browse mode), add keys:
  - `v` → toggle `selected.id` in `selection` (new Set).
  - `S` (capital, `input === 'S'`) → if `selection.size > 0` enter `mode='saveScope'` (TextInput for the scope name).
  - `L` (`input === 'L'`) → if `listScopes().length > 0` enter `mode='loadScope'` (SelectInput of scope names).
  - `D` (`input === 'D'`) → deep-dive: `const id = selected?.id; if (id) navigate(\`/wiki/catalog-merge?deepDive=\${id}\`);`
- Render a marker (e.g. `*`) on rows whose id is in `selection`.
- `saveScope` sub-mode (TextInput): on submit, `saveScope({ name: draft.trim(), pageIds: [...selection], createdAt: new Date().toISOString() })`, then `setSelection(new Set()); setMode('browse');` (skip if name empty).
- `loadScope` sub-mode (SelectInput items = `listScopes().map(s => ({ label: s.name, value: s.name }))`): on select, `const sc = loadScope(value); if (sc) setSelection(new Set(resolveScope(sc, pages).map(p => p.id!).filter(Boolean)));` then `setMode('browse')`. (Use the `id` guard pattern to avoid `!`.)
- Keep `useEscHandler` claim/release for the new sub-modes (the editor already manages it for add/rename/move — extend the same effect's condition to include saveScope/loadScope, or it already covers `mode !== 'browse'`).
- Update the footer browse hint to mention `v 选择 | S 存为集合 | L 载入集合 | D 深挖`.

- [ ] **Step 3: i18n**

Add keys used: `catalogMerge.deepDiveTitle` ("深挖（合并）" / "Deep-dive (merge)"); editor scope labels `catalogEditor.saveScopeLabel` ("集合名称：" / "Scope name: "), `catalogEditor.loadScopeLabel` ("载入集合：" / "Load scope: "). Add to `types.ts` (correct blocks) + both translation files. Update the editor `hintBrowse` strings to include the new keys (or keep the new keys' literal text in the hint — simplest: extend `hintBrowse` in both locales to include `| v 选择 | S 存集合 | L 载集合 | D 深挖`).

- [ ] **Step 4: typecheck + lint** — `bun run typecheck` (16/16), `bun run lint` (0). Fix unused/i18n/non-null issues.

- [ ] **Step 5: commit**

```bash
git add apps/cli/src/views/catalog-editor/index.tsx apps/cli/src/views/catalog-merge/index.tsx apps/cli/src/i18n/
git commit -m "feat(cli): topic scopes (save/load selection) + deep-dive trigger via merge review" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: editor wiring + deep-dive flow are interactive/LLM; NOT unit-verified. Manual smoke in Task C-5.

---

## Task C-5: Green gate + mark tasks + notes

- [ ] **Step 1: Green gate** — `bun run typecheck` (16/16), `bun run lint` (0), `cd packages/utils && bun test` (all pass incl. scopes + deepdive). Report numbers.
- [ ] **Step 2: Mark plan-ready C tasks** in `openspec/changes/living-catalog/tasks.md`: mark `C1.1`–`C1.4` and `C2.1`–`C2.5` `[x]` (built). Note V4 (live) pending.
- [ ] **Step 3: Append a "Phase C" section** to `openspec/changes/living-catalog/implementation-notes.md`: what was built; only scopes + deepdive cores unit-tested; manual-smoke checklist (V4: save a themed scope, reload it restores selection; deep-dive a page → children proposed as ADDs, bounded, anchored, merged; locked parent untouched).
- [ ] **Step 4: commit**

```bash
git add openspec/changes/living-catalog/tasks.md openspec/changes/living-catalog/implementation-notes.md
git commit -m "chore(living-catalog): mark Phase C tasks; record manual-smoke checklist" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `catalog-topic-scopes`: TopicScope persistence + stale-id tolerance → C-1; editor save/load selection + scope-restricted selection → C-4. ✓
- `catalog-deep-dive`: scoped agent producing anchored, bounded children → C-3 (prompt + orchestration) + C-2 (normalize bounds/anchor); merge back via reconciliation as ADDs → C-2 (adds-only plan) + C-4 (merge-view deepDive branch reuses applyMergePlan/persist/generate); locked parent untouched (parent is never in the adds-only plan; children are new) → emergent; recursive deep-dive (a child is a normal page, can be deep-dived again) → emergent from the same trigger. ✓

**Placeholder scan:** C-1, C-2 fully coded + tested; C-3 fully coded; C-4 precise spec against cited views.

**Type consistency:** `saveScope/listScopes/loadScope/resolveScope` (C-1) used in editor (C-4); `normalizeDeepDiveChildren/buildAddsOnlyPlan` (C-2) used in `generateDeepDiveProposal` (C-3); `generateDeepDiveProposal` (C-3) used in merge view (C-4); `CatalogProposal`/`CatalogMergePlan` shapes match `@open-zread/types`.

**Verification honesty:** scopes + deepdive cores unit-tested; the scoped agent, editor wiring, and deepDive merge branch are typecheck/lint-gated and need a live run (manual smoke, C-5).
