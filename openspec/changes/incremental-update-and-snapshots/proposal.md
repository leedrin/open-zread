## Why

代码审查发现：精细增量更新管道（`buildIncrementalPlan`）和增量修补模式（surgical edit）已完整实现，但**从未被接线触发**——全仓库无任何代码调用 `buildIncrementalPlan(...)`，`generateWikiContent` 的 `incrementalPlan` 分支（`generate-wiki.ts:309`）是走不到的死分支。CLI 菜单（generate/continue/manage/browse/force/config/exit）也没有增量更新入口；`continue` 仅按文件存在性补缺页，`force` 删全量重生，均非 diff 驱动。

同时，版本快照子系统是路径写错的孤儿代码：`WikiStore` 写 `.open-zread/wiki/current/<file>`、`createVersionSnapshot` 从 `current/` 拷到 `versions/<snapshot>/`，但真实管线 `WritePageTool` 写 `.open-zread/wiki/<section>/<file>`。三者路径不一致，`WikiStore` 从未实例化，快照函数从未调用——这就是用户观察到"没有日期 snapshot 目录"的根因。

附带发现：CLI 调用 `generateWikiContent` 时未传 `symbols`（`use-articles.ts:138/193`），导致 Facts-First 在 CLI 路径也未启用。

本 change 修复这些接线缺陷，让已建好的增量引擎真正可用，并修复/重做版本快照。

## What Changes

- **接线增量更新触发器**：在内容生成前用已保存的 cached manifest 对当前扫描做 diff，调用 `buildIncrementalPlan(...)` 产出 `IncrementalPlan`，传入 `generateWikiContent`
- **CLI 传入 `symbols`**：`generateWikiContent` 调用处补传 `symbols`，同时修复增量所需的符号输入与 Facts-First 未启用问题
- **新增 CLI"增量更新"菜单项与生成模式**：`mode=incremental`，在 wiki 已完成时显示，触发 diff → 受影响页面重生/修补
- **修复版本快照路径错配**：统一快照源为真实写盘目录（`.open-zread/wiki/<section>/`），或重构 `WikiStore` 使其与实际写盘路径一致
- **生成成功后创建版本快照**：调用 `createVersionSnapshot()`，产出 `.open-zread/wiki/versions/<date>_<time>_<commit>/`，为历史浏览与版本对比铺路
- **增量基线时序修正**：在生成成功后再保存 cached manifest 作为下次 diff 基线（当前在扫描时即覆盖，失败会污染基线）

## Capabilities

### New Capabilities
- `incremental-update-trigger`: 在生成前构建 `IncrementalPlan`（cached manifest diff → 依赖图 BFS → 受影响文档）并传入生成管线的触发逻辑，含 `symbols` 接线
- `incremental-cli-entry`: CLI 首页"增量更新"菜单项与 `mode=incremental` 生成模式
- `wiki-version-snapshots`: 修复版本快照路径错配、生成成功后创建带日期目录的快照、列出历史版本

### Modified Capabilities
<!-- 无：相关 spec 未提升到 openspec/specs/（那里仅有 csharp-parsing），改动以新能力表达 -->

## Impact

- **增量触发**：`apps/cli/src/views/wiki-generate/hooks/use-articles.ts`（构建并传入 plan + symbols）、`apps/cli/src/views/wiki-generate/hooks/use-catalog.ts`（基线保存时序）
- **增量引擎**：`packages/utils/src/cache/incremental-pipeline.ts`（已存，可能补 `loadCachedSymbols` 输入）、`packages/orchestrator/src/wiki/generate-wiki.ts`（消费分支已存）
- **CLI 入口**：`apps/cli/src/views/wiki-home/index.tsx`（菜单项）、`apps/cli/src/views/wiki-generate/index.tsx`（mode 解析）、`apps/cli/src/i18n/translations/*`（文案）
- **版本快照**：`packages/utils/src/storage/versioning.ts`、`packages/utils/src/storage/wiki-store.ts`（路径修复）、`packages/orchestrator/src/wiki/generate-wiki.ts` 或 finalize（生成后触发快照）
- **向后兼容**：增量为新增可选路径，现有 generate/force/continue 行为不变；首次运行无 cached manifest 时增量自动降级为全量；快照失败不阻断生成
