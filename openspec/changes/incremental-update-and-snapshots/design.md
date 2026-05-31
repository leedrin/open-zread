## Context

证据（grounded 自代码）：

- **增量引擎已完整但无生产端**：`buildIncrementalPlan({ cached, current, symbols, wikiPath, pages, packageAliases?, previousFacts? })`（`incremental-pipeline.ts:73`）已实现 diff→BFS→affectedDocs；`generateWikiContent` 已有消费分支（`generate-wiki.ts:309`）。但全仓库无调用 `buildIncrementalPlan(...)` 的生产端。
- **缓存基线时序**：`saveCachedManifest(manifest)` 在扫描阶段即写入（`use-catalog.ts:144`），**先于内容生成**。增量需要的是"上一轮的旧基线"，当前实现每次扫描就覆盖，且生成失败也已污染基线。
- **`diffManifests(cached, current)`**（`cache/index.ts:35`）做文件哈希 diff；`loadCachedManifest()` 返回旧基线。
- **CLI 未传 symbols**：`use-articles.ts:138/193` 仅传 `{pages, maxConcurrent, onEvent}`，Facts-First 与增量都缺符号输入。`loadCachedSymbols` 已存（`symbol-cache.ts`）。
- **版本快照路径错配**：`createVersionSnapshot` 读 `.open-zread/wiki/current/`（`versioning.ts:7,30`），`WikiStore` 写 `current/<file>`（扁平，`wiki-store.ts:17`），但真实 `WritePageTool` 写 `.open-zread/wiki/<section>/<file>`（`page-tools.ts:23`）。`WikiStore` 从未实例化，快照从未调用，`current/` 永远空，`versions/` 从不生成。

## Goals / Non-Goals

**Goals:**

- 让已建好的增量引擎真正可触发：生成前 diff 源码 → 只重生/修补受影响页面
- CLI 提供"增量更新"入口；正确传入 `symbols`（连带启用 Facts-First）
- 修复版本快照路径错配，生成成功后产出带日期目录的 `versions/<date>_<time>_<commit>/`
- 修正缓存基线时序：生成成功后才更新基线，避免失败污染
- 全程向后兼容、可降级：无旧基线→全量；快照失败→不阻断

**Non-Goals:**

- 不改增量引擎内部算法（BFS、doc-to-doc 依赖已实现且正确）
- 不引入 zread 式"wiki 内容文本 diff"——open-zread 走源码哈希 diff，更精确，无需文本快照来驱动增量
- 不做版本对比 UI/回滚 UX（本期只产出快照目录作为基础设施，浏览/对比留待后续）
- 不改 catalog（wiki.json）生成逻辑——增量复用现有蓝图，只重生内容页

## Decisions

### D1: 增量更新的独立编排序列

`mode=incremental` 走一条不重建 catalog 的独立流程：

```
1. 读现有 wiki.json → pages
2. cachedOld = loadCachedManifest()          ← 上一轮基线（生成前必须先读）
3. current   = scanFiles()                   ← 当前快照
4. symbols   = loadCachedSymbols() 或 parseFiles(current)
5. plan = buildIncrementalPlan({ cached: cachedOld, current, symbols, wikiPath, pages })
6. if (!cachedOld || plan.affectedDocs.length === 0) → 提示"无变更"或降级全量
7. generateWikiContent({ pages, symbols, incrementalPlan: plan, onEvent })
8. 成功后：createVersionSnapshot(); saveCachedManifest(current)
```

**理由**：增量的价值在"只动受影响页"，重建 catalog 会丢失该收益。复用现有 wiki.json 的 pages 即可。

### D2: 缓存基线时序修正 —— 成功后保存

将 `saveCachedManifest(current)` 从"扫描阶段"移到"生成成功之后"。全量 generate / force 同样遵循此时序。

**替代方案**：保留扫描时保存 + 增量单独读旧基线 → 但失败污染基线的问题仍在。统一改为"成功后保存"最干净。

**理由**：基线语义应是"上一次成功生成的源码状态"。扫描时保存会让中途失败的运行也推进基线，导致下次 diff 漏掉本应重生的页。

### D3: 版本快照源路径修复

`createVersionSnapshot` 的拷贝源从 `.open-zread/wiki/current/` 改为真实内容目录 `getWikiDir()`（`.open-zread/wiki`），拷贝时**排除 `versions/` 子目录自身**（避免递归嵌套）和 `cache/`。目标仍为 `.open-zread/wiki/versions/<snapshotName>/`，保留 section 子目录结构。

**WikiStore 处置**：`WikiStore` 是与真实写盘路径冲突的冗余抽象，从未被使用。决策为**移除 `WikiStore`**（或将其 `createSnapshot` 改为委托修复后的 `createVersionSnapshot`，并移除 `current/` 写盘），消除"两套写盘抽象"。倾向直接移除，减少误导。

**理由**：真实写盘已由 `WritePageTool` 完成，快照只需冷拷贝真实目录。无需 `current/` 中间层。

### D4: CLI 入口与模式

- `wiki-home/index.tsx`：在 wiki 已完成（`generated === total`）时，于 `manage`/`browse` 之后新增 `{ label: t('wiki.incremental'), value: 'incremental' }`
- `wiki-generate/index.tsx`：`mode` 联合类型新增 `'incremental'`
- 新增/复用 hook 执行 D1 序列；i18n 文案补 `wiki.incremental` 等键（zh-CN / en-US）

**理由**：增量只在已有完整 wiki 时有意义，放在 manage 后符合心智。force（全量重生）与 incremental（差量）并列，语义清晰。

### D5: symbols 接线（连带修复 Facts-First）

所有 `generateWikiContent(...)` 调用处补传 `symbols`（来自 `loadCachedSymbols()` 或 `parseFiles`）。这既是增量 plan 的必需输入，也修复了 Facts-First 在 CLI 路径未启用的连带问题。

**理由**：`extractPageFacts` 依赖 `symbols`；不传则 Facts 段落为空。一次修复双重收益。

### D6: 快照触发位置与开关

在 `generateWikiContent` 的 finalize 之后、依据调用方传入的 `snapshot?: boolean` 选项触发 `createVersionSnapshot()`；或在 CLI 成功回调中触发。决策为**在 CLI 成功后触发**，保持 utils/orchestrator 纯净、避免对部分失败的运行打快照。

**理由**：快照是"一次成功版本的归档"，由编排方（CLI）在确认成功后决定最干净。全量与增量成功后都触发。

### D7: 降级与容错

- 无 `cachedOld`（首次或缓存丢失）：`buildIncrementalPlan` 内部已处理（无 changed → affectedDocs 空）；CLI 检测到 `!cachedOld` 时提示并降级为全量或 continue
- `plan.affectedDocs.length === 0`：提示"自上次生成无源码变更"，不跑生成
- `createVersionSnapshot()` 抛错：捕获并 warn，不阻断生成结果

## Risks / Trade-offs

**[基线时序变更影响 force/continue]** 改为"成功后保存"后，若用户中途退出，基线维持旧值——下次会重新 diff 到这些文件。 → **接受**：这正是期望语义（未成功的生成不应推进基线）。

**[快照磁盘占用]** 每次成功生成全量冷拷贝一份 wiki，多版本累积占空间。 → **缓解**：本期只产出，不自动清理；可在 design open question 记保留策略（如保留最近 N 个），后续实现。

**[移除 WikiStore 的连带影响]** 需确认无其他引用。 → **缓解**：grep 确认仅 `utils/index.ts` 再导出，无实例化调用；移除前跑 typecheck。

**[增量复用旧 catalog 的局限]** 若源码新增了整块功能，增量不会新建 wiki 页（catalog 未重建）。 → **接受**：增量定位是"已有页面的差量刷新"；结构性新增由全量 generate 覆盖。可在 UI 文案提示"新增大量文件建议全量重生"。

**[symbols 来源一致性]** `loadCachedSymbols` 可能与当前源码不同步（若只 scan 未 parse）。 → **缓解**：增量流程在 scan 后重新 `parseFiles(current)` 或校验符号缓存新鲜度，确保 plan 基于当前符号。

## Migration Plan

无破坏性迁移，分阶段：

1. 接线 symbols（修 Facts-First）+ 基线时序修正——风险最低，立即收益
2. 接线增量触发器 + CLI 入口——核心功能
3. 修复版本快照路径 + 成功后触发——历史基础设施

**回滚**：增量为新增模式；移除菜单项即回到 generate/force/continue。快照触发可由开关关闭。基线时序改动若引发问题，可回退到扫描时保存。

## Open Questions

- 版本快照保留策略（保留最近 N 个 / 按时间清理）？本期只产出，留待后续。
- 增量检测到"大量新增文件"时是否自动建议全量？首版仅文案提示，不自动切换。
