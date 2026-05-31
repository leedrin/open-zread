## 1. Symbols Wiring & Baseline Timing (lowest risk, immediate payoff)

- [x] 1.1 In `use-articles.ts` — load symbols via `loadCachedSymbols()` (or pass through from catalog phase) and add `symbols` to both `generateWikiContent({...})` calls (lines ~138, ~193)
- [x] 1.2 Verify Facts-First activates: per-page Facts section now renders when symbols present
- [x] 1.3 Move `saveCachedManifest(current)` out of scan-time (`use-catalog.ts:144`) to run only after a successful generation
- [x] 1.4 Ensure `force` and full `generate` also save the baseline only on success
- [x] 1.5 Run `bun run typecheck` and `bun run lint`

## 2. Incremental Update Orchestration

- [x] 2.1 Add an incremental flow (new hook or branch) that executes: load existing `wiki.json` pages → `cachedOld = loadCachedManifest()` → `current = scanFiles()` → `symbols = parseFiles(current)` (or freshness-checked cache)
- [x] 2.2 Call `buildIncrementalPlan({ cached: cachedOld, current, symbols, wikiPath: getWikiDir(), pages })`
- [x] 2.3 Degrade when `!cachedOld` (no baseline): prompt user or fall back to full generation
- [x] 2.4 Short-circuit when `plan.affectedDocs.length === 0`: surface "无源码变更" and skip generation
- [x] 2.5 Call `generateWikiContent({ pages, symbols, incrementalPlan: plan, onEvent })`
- [x] 2.6 On success: `saveCachedManifest(current)` then trigger snapshot (section 4)
- [x] 2.7 Run `bun run typecheck` and `bun run lint`

## 3. CLI Entry & i18n

- [x] 3.1 In `wiki-home/index.tsx` `buildNormalSelectItems()` — add `{ label: t('wiki.incremental'), value: 'incremental' }` when `progress.generated === progress.total`
- [x] 3.2 In `wiki-home/index.tsx` `handleSelect()` — route `incremental` → `navigate('/wiki/generate?mode=incremental')`
- [x] 3.3 In `wiki-generate/index.tsx` — add `'incremental'` to the `mode` union and wire it to the incremental orchestration
- [x] 3.4 Add i18n keys `wiki.incremental` (+ any no-change/status messages) to `apps/cli/src/i18n/translations/zh-CN.ts` and `en-US.ts`
- [x] 3.5 Run `bun run typecheck` and `bun run lint`

## 4. Version Snapshots

- [x] 4.1 Fix `createVersionSnapshot()` in `versioning.ts` — copy source from `getWikiDir()` (real content dir), preserving `<section>/` structure
- [x] 4.2 Exclude `versions/` and `cache/` subdirectories from the copy to prevent recursive nesting
- [x] 4.3 Trigger `createVersionSnapshot()` after successful generation (full and incremental) from the CLI success path
- [x] 4.4 Wrap snapshot in try/catch — log a warning on failure, do NOT fail the generation
- [x] 4.5 Remove the orphaned `WikiStore` (or reconcile it to the corrected snapshot logic); confirm no remaining write to `.open-zread/wiki/current/`
- [x] 4.6 Update `packages/utils/src/index.ts` exports if `WikiStore` is removed
- [x] 4.7 Run `bun run typecheck` and `bun run lint`

## 5. Tests

> 注：5.1/5.2/5.4/5.5 的逻辑内嵌在 React/Ink hooks（use-articles / wiki-home）中，仓库当前无 React 组件/hook 测试基建。这些路径改为通过第 6 节手动验证覆盖；snapshot 非阻断由 `safeSnapshot` 的 try/catch 保证。后续可抽取纯函数补单测。

- [ ] 5.1 Test baseline timing — `saveCachedManifest` not called on failure, called on success（移至手动验证 6.8；逻辑在 hooks 内）
- [ ] 5.2 Test incremental degrade — no cached manifest → degrade path; empty affectedDocs → short-circuit（移至手动验证 6.6；逻辑在 hooks 内）
- [x] 5.3 Test `createVersionSnapshot()` — copies section dirs from real wiki dir; excludes `versions/`; returns dated name
- [ ] 5.4 Test snapshot non-blocking — generation result still success when snapshot throws（由 `safeSnapshot` try/catch 保证；hook 层无测试基建）
- [ ] 5.5 Test home menu — `incremental` item shown only when wiki complete（React 视图，无测试基建；手动验证）

## 6. Verification

- [x] 6.1 Run `bun run typecheck` — whole monorepo
- [x] 6.2 Run `bun run lint`
- [x] 6.3 Run existing test suites — `packages/utils`, `packages/orchestrator`, `apps/cli`
- [ ] 6.4 Manual: full-generate a project; confirm a `.open-zread/wiki/versions/<date>_<time>_<commit>/` snapshot appears and contains section subdirs
- [ ] 6.5 Manual: modify 1 source file; run `mode=incremental`; confirm only the affected page(s) regenerate (check logs report N affected / M unaffected)
- [ ] 6.6 Manual: run incremental with no source changes; confirm "无变更" message and no regeneration
- [ ] 6.7 Manual: confirm Facts now appear in generated pages (Facts-First wired)
- [ ] 6.8 Manual: confirm a failed generation does NOT advance the cached manifest baseline
