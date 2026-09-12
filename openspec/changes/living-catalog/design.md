## Context

Grounded 自当前代码：

- `wiki.json`（`WikiOutput`）是唯一真源；`_sidebar.md` 与 `source-files-index.json` 由 `finalize.ts` 从 `pages` 派生。
- 页面身份目前是 `slug`（由 title 推导）；文件路径 = `section/file`。`WikiPage` 无 `id/origin/locked/status/depth`。
- Catalog 由 Catalog Agent 一次性产出（`generate-catalog.ts` + `GenerateBlueprintTool` → `generateWikiJson`）。无合并逻辑。
- `manage` 模式唯一策展手段：选中页面按 `r` → `regeneratePage`（单页重生）。
- 上一个 change 落地的版本快照 `versions/<date>_<time>_<commit>/` 内含完整 `wiki.json` —— 可直接作为三方合并的 BASE。
- 已有但本设计要复用的概念：`docType`（diataxis 四象限）、`glossary`、`level`/dual-pass（Advanced 走双轮）。

用户已敲定四个关键决策（见 Decisions 的 D-locks）。

## Goals / Non-Goals

**Goals:**

- catalog 从"一次性机器输出"变为"可编辑、可合并、可策展、可深挖的活体计划"
- 重新生成不再破坏用户内容：通过三方合并保留人工编辑与锁定页
- 解决 diataxis 迁移缺口：结构升级可被合并进旧 catalog
- 主题集合（themed collection）让用户聚焦；主题深挖让 AI 对指定主题递归展开子目录
- 全程向后兼容、可降级、可分阶段落地（A→B→C）

**Non-Goals:**

- 不做多人协作/实时合并（单用户本地）
- 不做 catalog 的 git 式逐字符 diff；合并粒度是页面节点（per-node）
- 不做 Web 端编辑器（仅 Ink TUI）
- 不在本 change 内改 Page 内容生成的 prompt 模板（深挖复用现有内容生成管线）
- 不做主题集合的跨项目共享/云同步（本地 JSON 即可）

## Decisions

### D-lock 1: 主题预设 = 主题集合（themed collection），而非项目模板

主题集合是"围绕某主题的页面子集的命名引用"，保存为 `.open-zread/wiki/scopes/<name>.json`，内容是 `{ name, description?, pageIds: string[], createdAt }`。它**引用页面 id**，不复制页面内容。用途：聚焦再生成、深挖入口、策展阅读路径。

**替代（已否决）**：项目骨架模板（导出 sections/docTypes 去 seed 新项目）—— 用户明确要 B。

### D-lock 2: 真正的 in-TUI catalog 编辑器

提供 Ink 交互式编辑器视图（非仅文件编辑）：树状展示 section → group → page；支持新增/重命名/移动/删除页面与章节、切换 `locked`、设置 `depth`。编辑直接改内存中的 catalog，保存时写回 `wiki.json` 并重跑 finalize。

**理由**：用户明确要交互式编辑器。文件编辑作为高级用户的旁路可后续补，但本设计以 TUI 为主路径。

### D-lock 3: `locked` 是硬保证 —— AI 永不可触碰

被 `locked: true` 的页面在任何 AI 操作（reconciliation / regenerate / deep-dive）中**完全不可变**：其内容文件、元数据、在 catalog 中的位置都逐字保留。REMOTE 提案中针对锁定页的任何变更被无条件丢弃，且 reconciliation 不把锁定页交给内容生成管线。

**理由**：用户明确要硬保证。这让"收藏保留"成为可信赖的契约，而非"冲突时优先"。

### D-lock 4: 深挖 = 把主题展开为子目录树（递归 scoped catalog 生成）

"深入探索"不是把单页写厚，而是**选定一个主题/页面 → AI 为该主题生成一份聚焦的子 catalog（多个子页面）→ 合并回主 catalog → 走正常内容生成**。子页面继承父主题的 section/group 上下文，`origin: 'ai'`，可再被锁定或再深挖（递归）。

**理由**：用户明确要 explode into sub-tree。这把"深挖"统一为"对一个子树指针 reuse reconciliation 引擎"，与 Layer 2 同构、可复用。

### D1: 稳定身份 `id` 是合并的基石，术语通道是主对齐信号

新增 `WikiPage.id`（如 `nanoid`/uuid），与 title 解耦。slug 仅用于 URL/文件名。新增 `WikiPage.concepts: string[]` —— 该页作为**权威归属**的规范术语集合（每个 `GlossaryTerm.canonicalPage` 指向该页的术语都进入此集合）。**一页可对应多个术语**（如"技能与战斗"→ `[技能, 战斗]`），即 page→term 是一对多、term→canonicalPage 是多对一。

当 REMOTE 是全新 AI 提案（无历史 id）时，按以下优先级对齐：

```
身份对齐顺序：
1. 精确 id 匹配                （LOCAL/BASE 之间天然有 id）
2. 术语集合匹配（concept channel）：concepts 集合重合（Jaccard ≥ 阈值或共享主术语）
                               → 同一节点，继承 id          ★ 主信号，复用 Glossary
3. associatedFiles 指纹回退    ：文件集合重合度 ≥ 阈值       （弱信号）
4. 都不匹配                    → REMOTE 是真正的新页面（分配新 id）
```

**为什么术语通道优于文件指纹**：页面的真实身份是它的**概念**，不是文件清单。文件会随重构漂移，而"技能系统"这个规范概念稳定。两个页面只要归属同一规范术语（即使标题不同、文件清单略有出入），就是同一逻辑页。文件指纹降级为术语缺失时的弱回退。

**容错**：concepts 由 AI 生成、可能漂移；故术语通道与文件指纹**互补**而非互斥，两者都不命中时一律降级为"新增/移除提案"进 review，绝不静默覆盖。

**替代（已否决）**：继续用 slug 作身份 —— AI 改标题即破坏合并，不可接受。

### D2: BASE 来源 = 最近的版本快照

三方合并的 BASE 取 `versions/` 下最新快照内的 `wiki.json`（"上一次 AI 产出的状态"）。LOCAL = 当前 `wiki.json`。REMOTE = 本次 Catalog Agent 新产出。

**迁移**：旧 catalog（无 id/快照）首次 reconcile 时，给所有现有页面分配 id（按 slug 派生），并把当前 `wiki.json` 当作 BASE 与 LOCAL 的合一起点。

### D3: 合并矩阵（per-node，按 id 对齐）

```
 in BASE  in LOCAL        in REMOTE   →  decision
 ───────  ─────────────   ─────────      ───────────────────────────────
   no       no              yes        →  AI 新页        → 提案 ADD（review）
   no       yes(human)      —          →  用户页         → KEEP（human 永久保留）
   yes    =BASE            diff        →  干净 AI 更新    → APPLY（除非 locked）
   yes    ≠BASE            diff        →  双方都改        → CONFLICT → review
   yes      tombstone       yes        →  用户已删        → 尊重删除（除非用户在 review 重新接受）
   yes      yes            缺失        →  AI 丢弃         → locked 则保留，否则提案 REMOVE
   *        locked          *          →  硬保护          → 原样保留，忽略 REMOTE
```

### D4: TUI 冲突 review 屏

合并产出 `CatalogMergePlan`（adds/updates/conflicts/removes/kept），进入 review 视图逐节点 accept/reject。非冲突的干净更新可默认接受、批量确认；冲突必须逐项裁决。确认后写回 `wiki.json` + finalize，并对"需要重生内容"的页面（新增/被接受的更新）触发内容生成（锁定页与未变页跳过）。

### D5: catalog 编辑器与合并 review 共享一套节点操作

编辑器（手工）和 review（合并）本质都是对 catalog 节点树做 add/update/remove/lock。抽出 `packages/utils/src/catalog/` 的纯函数（节点 CRUD、身份对齐、三方合并、scope 解析），TUI 两个视图只是它的两种交互外壳。

### D6: 派生产物与 tombstone

`finalize` 跳过 `status: 'tombstone'` 的页面（不进 sidebar、不生成内容、不进 source-index）。tombstone 保留在 `wiki.json` 中作为"用户已删除"的记忆，使 AI 再提案同一页时能被尊重。可提供"清理 tombstone"操作做物理删除。

### D7: 分阶段落地（A→B→C），每阶段独立可用

```
Phase A —— 活体数据模型 + TUI 编辑器
  catalog-editable-model + catalog-tui-editor
  价值：用户能手工策展/锁定/删除；不触碰 AI 合并，零风险
        ▼
Phase B —— 三方合并 reconciliation
  catalog-reconciliation（依赖 A 的 id/locked/status + 快照 BASE）
  价值：重新生成不再毁内容；顺带修复 diataxis 迁移缺口
        ▼
Phase C —— 主题集合 + 主题深挖
  catalog-topic-scopes + catalog-deep-dive（深挖复用 B 的合并引擎）
  价值：聚焦策展 + 对指定主题递归深挖
```

### D8: 术语锚定命名 —— 从源头预防标题漂移

Catalog Agent 在产出页面标题/slug 时，SHALL 优先采用 Glossary 的**规范术语**（别名收敛到规范名），并把该页归属的术语写入 `page.concepts`。这从源头减少跨次再生成的标题漂移——治本，而非靠事后匹配治标。

```
        无术语锚定（治标）                术语锚定（治本）
        ────────────────                ────────────────
 run 1:  "技能系统"                       "技能系统"   (canonical)
 run 2:  "技能与战斗系统"  ← 漂移          "技能系统"   (别名收敛)
 run 3:  "技能树与 Buff"   ← 漂移          "技能系统"   (稳定)
         合并需追renames                  合并直接命中身份
```

**与 D1 的关系**：D8 减少 rename 发生，D1 的术语通道在 rename 仍发生时兜底。两者协同。

### D9: 统一术语表页面 —— 由 glossary + concepts 确定性渲染

catalog 中保留一个**专属术语表页面**（稳定 id/slug，如 `glossary`，docType 视为 `reference`，在侧边栏可见）。其内容**不由 LLM 撰写**，而在 finalize 阶段由 `glossary[]` + 各页 `concepts` **确定性渲染**：

- 每个术语一行：规范名、别名、定义
- **术语 ↔ 页面双向映射**：术语 → 其权威页面（`canonicalPage`）链接；并列出 `concepts` 含该术语的所有页面（"出现于"）
- 术语/概念变化时自动刷新（与 `_sidebar.md` 同属 finalize 派生，但它是一个真实可见页面而非纯导航文件）

**理由**：术语表是结构化数据，确定性渲染零幻觉、零 token、永远与 glossary 同步；作为 catalog 中的真实页面让用户可在导航中查看。被 `locked` 时仍可刷新（内容确定性，无破坏风险），或遵循用户锁定不刷新——按 D-lock 3 一致性，**locked 则不刷新**。

## Risks / Trade-offs

**[身份对齐启发式误判]** REMOTE↔BASE 的 concepts/associatedFiles 匹配可能错配/漏配。→ **缓解**：术语通道为主、文件指纹为辅，两者互补；阈值保守；不确定的一律降级为"新增/移除提案"进 review，由用户裁决，绝不静默覆盖。

**[concepts 由 AI 生成可能漂移]** 术语集合本身可能跨次不稳定。→ **缓解**：D8 术语锚定命名收敛别名；术语通道与文件指纹互补，双不命中才判新增；术语表页确定性渲染不受影响。

**[TUI 编辑器与合并 review 是大 UX 面]** Ink 下的树编辑 + 逐节点裁决交互复杂。→ **缓解**：D5 抽纯函数，UI 仅薄壳；Phase A 先做编辑器、Phase B 再做 review，分摊复杂度。

**[硬锁可能让 catalog 僵化]** 用户锁太多页，AI 无法演进结构。→ **接受**：这是用户的选择；review 中可显示"N 个锁定页被跳过"的提示，引导用户按需解锁。

**[深挖导致 catalog 膨胀]** 递归 explode 可能产生过多子页。→ **缓解**：深挖时 Agent 受"子页数量上限 + 必须锚定真实文件"约束（复用 how-to 的锚定规则）；子页同样可被删除/锁定。

**[迁移：旧 catalog 无 id]** 首次启用需要给存量页面补 id。→ **缓解**：一次性迁移按 slug 派生稳定 id 并写回；幂等。

**[范围大]** 5 个能力、跨 types/utils/orchestrator/cli。→ **缓解**：D7 的 A/B/C 分阶段，每阶段独立可发布、可停。

## Migration / Rollout

1. **Phase A**：加字段（可选，默认值向后兼容）+ 首次加载迁移补 `id`；上线 TUI 编辑器。旧项目正常加载，未编辑即与现状一致。
2. **Phase B**：reconciliation 作为新入口（如 wiki-home "重新生成（合并）"），与破坏性 `force` 并存；首次 reconcile 用最新快照作 BASE，无快照则把当前 catalog 当 BASE（退化为"全量提案 + 锁保护"）。
3. **Phase C**：scopes 与 deep-dive 作为编辑器内的操作增量上线。

**回滚**：任一阶段可独立回退；新字段可选不影响旧逻辑；reconciliation 入口可隐藏，回到 generate/force/incremental。

## Open Questions

- 身份对齐的 associatedFiles 指纹阈值取多少？首版保守（高重合才合并），观察后再调。
- 深挖子页数量上限默认值？首版给一个保守上限（如每次 ≤ 6），可配置。
- TUI 编辑器是否需要"导出/导入 wiki.json 供外部编辑器手改"的旁路？列为后续增强，不阻塞主路径。
