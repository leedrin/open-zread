## Why

当前 catalog（`wiki.json`）是一次性机器输出：用户唯一的干预手段是 `manage` 模式下对单页按 `r` 重生。它不可编辑、不可合并、不携带任何来源/保护信息。这导致三个痛点：

1. **重新生成 = 推倒重来**：`force` 删除整个 `wiki.json` + wiki 目录。用户在上一版里手工补的章节、调整的标题、想保留的内容全部丢失。
2. **结构升级无法平滑迁移**：上一轮已确认——diataxis 实现前生成的旧 wiki，增量更新拿不到新的 Tutorial/How-to/Reference 轨，因为增量复用旧蓝图、从不重建 catalog。唯一出路是破坏性 `force`。
3. **无法人工策展、无法聚焦深挖**：用户不能添加/修改/删除章节，不能锁定保护重要页面，不能围绕某个主题保存一份关注列表，也不能让 AI 对指定主题做更深入的子目录级展开。

本提案把 catalog 从"一次性机器输出"升级为"用户与 AI 共同拥有的活体计划"（living plan）：可编辑、可三方合并、可锁定保护、可按主题策展、可对指定主题递归深挖。

这套机制天然复用上一个 change 刚落地的**版本快照**（`versions/<date>/` 内含 `wiki.json`）作为三方合并的 BASE，并顺带解决 diataxis 迁移缺口。

## What Changes

### 数据模型（Layer 1 基础）
- `WikiPage` 新增稳定身份与策展元数据：`id`（不随标题改变的稳定标识）、`origin: 'ai' | 'human'`、`locked: boolean`（收藏保留/硬保护）、`status: 'active' | 'tombstone'`（软删除）、`depth?: 'standard' | 'deep'`、`concepts?: string[]`（该页作为权威归属的术语，**一页可对应多个术语**，如"技能与战斗"= 技能 + 战斗）
- 关键决策：**`id` 是稳定主键**，slug 仅作 URL 用途。身份对齐优先级：①精确 `id` → ②**术语集合匹配（concept channel，复用 Glossary）** → ③`associatedFiles` 指纹（弱回退）。术语通道比文件指纹更可靠，避免 AI 改标题导致"误删+新增"
- **术语锚定命名（drift 预防）**：Catalog Agent 用 Glossary 的规范术语生成标题/slug（别名收敛到规范名），从源头减少跨次再生成的标题漂移

### 可编辑（Layer 1）—— 真正的 TUI catalog 编辑器
- 新增 in-TUI catalog 编辑器视图：增 / 改 / 删 章节与页面，切换 `locked`（收藏保留），软删除（tombstone）
- 编辑后重跑 finalize（`_sidebar.md` / `source-files-index.json` 由 catalog 派生，保持一致）

### 可合并（Layer 2）—— 三方合并 reconciliation
- "重新生成"语义从"覆盖"改为"产出 AI 提案（REMOTE）"
- 三方合并：BASE（最近快照内的 `wiki.json`）× LOCAL（当前含用户编辑）× REMOTE（新 AI 提案），按 `id` 对齐
- **`locked` 是硬保证**：被锁页面在合并中完全不可被 AI 触碰（内容与元数据均逐字保留，AI 提案对其无效）
- 冲突进入 TUI review 屏，逐节点 accept / reject
- 顺带修复 diataxis 迁移缺口：REMOTE 含新轨道 → 合并加入而不丢失用户内容

### 统一术语表页面（Layer 1 / 跨层）
- catalog 中新增一个专属**术语表页面**（统一术语表），渲染：全部规范术语 + 别名 + 定义，以及**术语 ↔ wiki 页面的双向映射**（每个术语链接其权威页面，并列出覆盖该术语的页面）
- 该页内容由 `glossary[]` + 各页 `concepts` **确定性渲染**（非 LLM 撰写，零幻觉），术语/概念变化时在 finalize 阶段刷新；在侧边栏可见

### 可策展与深挖（Layer 3）
- **主题集合（themed collection）**：把围绕某主题的页面子集保存为命名集合（如"战斗系统深潜"），可重新读取、回放，用于聚焦再生成/深挖与作为策展阅读路径
- **主题深挖（explode into sub-tree）**：选定一个主题/页面 → AI 为其生成聚焦子目录（递归的、范围受限的 catalog 生成）→ 合并回主 catalog → 深度生成内容

## Capabilities

### New Capabilities
- `catalog-editable-model`: WikiPage 的稳定 `id`、`origin`、`locked`、`status`、`depth` 元数据模型，以及 catalog 读写与 finalize 对其的尊重
- `catalog-tui-editor`: 在 Ink TUI 中对章节/页面进行增改删、锁定、软删除的交互式编辑器
- `catalog-reconciliation`: 基于快照 BASE 的三方合并（regenerate-as-proposal），含硬锁保护与 TUI 冲突 review
- `catalog-topic-scopes`: 命名主题集合的保存/读取/回放，用于聚焦再生成与策展
- `catalog-deep-dive`: 将指定主题展开为子目录树（范围受限的递归 catalog 生成）并合并回主 catalog
- `catalog-glossary-page`: catalog 中专属的统一术语表页面，由 glossary + 各页 concepts 确定性渲染术语表与术语↔页面双向映射

### Modified Capabilities
<!-- 无 openspec/specs/ 既有 spec 需要 delta（现有仅 csharp-parsing）；相关改动以新能力表达 -->

## Impact

- **类型**：`packages/types/src/wiki.ts` — `WikiPage` 新增 `id/origin/locked/status/depth/concepts`；新增 `TopicScope`、`CatalogMergePlan` 等类型
- **术语通道与术语表页**：复用 `GlossaryTerm`（含 `canonicalPage`）+ 新增 `WikiPage.concepts`；术语表页内容由 `packages/utils/src/output/`（finalize 阶段）确定性渲染
- **持久化**：`packages/utils/src/output/wiki-content.ts`（读写新字段）、`packages/utils/src/output/finalize.ts`（跳过 tombstone、派生不变）
- **合并引擎**：`packages/utils/src/catalog/`（新增）— 三方合并、身份对齐、锁保护
- **快照即 BASE**：复用 `packages/utils/src/storage/versioning.ts` 产出的 `versions/<date>/wiki.json`
- **Catalog Agent**：`packages/orchestrator/src/prompts/generate-catalog.ts`（产出提案、支持子目录范围）、`GenerateBlueprintTool`（接受新字段与 scope）
- **TUI**：`apps/cli/src/views/` 新增 catalog 编辑器与合并 review 视图；`wiki-home` 新增入口；i18n
- **向后兼容**：新字段可选；旧 catalog 加载时 `origin` 默认 `ai`、`locked` 默认 false、`status` 默认 active、`id` 迁移时按 slug 生成

## 来源

承接探索讨论（catalog 作为活体计划）；BASE 复用 `incremental-update-and-snapshots` 的版本快照；解决 `diataxis-reader-personas` 的迁移缺口。
