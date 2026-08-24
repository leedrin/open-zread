## Context

Open Zread 现有的 Wiki 生成分两条流水线：

- **全量生成**（`generateWikiCatalog` → `generateWikiContent`）：一次性规划全部页面并逐一生成内容。
- **全量 sync**（`syncWiki`）：由源码文件 diff 触发，每次都重新执行 `parseFiles()` 全量解析，并让 Agent 重新过一遍**全部**旧页面吐出完整新数组。

两条路径都以"整个 wiki.json 重新规划"为最小操作单元。代码调研（`docs/research/wiki-generation-and-maintenance.md`）确认的关键约束：

- `WikiPage` 是扁平结构：`section → group?(可选二级) → page`，没有页面间父子关系。前端 `apps/browse/src/utils/buildTree.ts` 严格按这三层建树。
- `wiki.json` 的写入函数 `generateWikiJson()`（`packages/utils/src/output/wiki-content.ts:27-45`）永远是**整体覆盖写**，没有 merge 语义；现有两个产出蓝图的工具（`GenerateBlueprintTool`、`GenerateSyncBlueprintTool`）都要求调用方一次性交出完整 `pages` 数组。
- 单页内容生成（`write_page` 工具，`page-tools.ts:121-219`）已经和"目录规划"完全解耦——`regeneratePage(slug)`（`use-articles.ts:161-199`）证明了"对任意一个 page 触发独立生成"这条腿本来就是通的，只需要一个合法的 `WikiPage` 对象。
- 归档/版本快照（`WikiStore.archivePage`/`createVersionSnapshot`）是确认过的死代码：依赖的 `.open-zread/wiki/current/` 目录从未被任何写入路径填充过。
- `write_page` 落盘路径是直接拼字符串 `.open-zread/wiki/{section}/{file}`，没有走 `getWikiDir()`，这是一处已知的实现不一致。
- 页面 Agent 工具集固定为 `[FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool]`（`generate-wiki.ts:113-119`），其中 `write_page` 内置 Mermaid 语法自检（`validateMermaidContent`, `page-tools.ts:68-94`），是唯一的写入前硬校验。
- 三层 Repo Map 工具（`GetDirectoryTree`/`GetCoreSignatures`/`GetModuleDetails`）都从磁盘 `last_symbols.json` 懒加载，缓存新鲜度依赖上一次 `saveCachedSymbols()` 的时机。
- 项目是本地单用户 CLI 工具（无远程服务、无多进程并发访问同一份 `.open-zread/` 目录的场景）。

## Goals / Non-Goals

**Goals:**
- 在不触发全量重新规划的前提下，支持对已生成 Wiki 做四类轻量维护操作：新增页面、删除页面、编辑页面元数据、局部重写某页的一个小节。
- 四类操作共享同一套 wiki.json 读-改-写、路径解析、slug 校验、section 新建规则，避免每个操作各自实现出不一致的行为。
- 复用现有可用机制（`generateWikiContent`/`regeneratePage`/`write_page`+Mermaid 校验/三层 Repo Map 工具），只新增确实缺失的部分。
- 提供最小可用的删除能力，替代当前完全不生效的归档机制——但不修复归档机制本身。

**Non-Goals:**
- 不引入页面间真正的父子层级（"子主题"在数据模型里仍然是同 section/group 下的兄弟页，不新增 `parentSlug` 之类字段）。
- 不修复或复用 `WikiStore.archivePage`/`createVersionSnapshot` 这套死代码路径。
- 不实现跨进程/跨会话的文件锁——并发控制只覆盖同一个 CLI 进程内的操作互斥。
- 不改变现有全量生成/全量 sync 流程的行为。
- 不做"语义查重"的硬校验（判断新主题是否与旧页面内容重复）——只在 Agent prompt 层面提示，不做机器强制拦截，与现有 `ValidateBlueprintTool` 的软校验哲学保持一致。

## Decisions

### D1. 统一的 wiki.json 读-改-写辅助函数

新增一个共享函数（暂定 `packages/utils/src/output/wiki-mutation.ts`）：

```ts
async function mutateWikiBlueprint(
  mutator: (pages: WikiPage[]) => WikiPage[] | Promise<WikiPage[]>
): Promise<WikiOutput>
```

内部流程：`loadWikiBlueprint()` → 对 `.pages` 应用 `mutator` → 调用 `generateWikiJson()` 写回，**显式透传旧的 `techStackSummary`**（除非 mutator 有意替换）。

**为什么**：现有两个蓝图写入工具都要求"整体覆盖"，如果 Create/Delete/Update-metadata 各自手写一遍"load→改 pages→write"，`techStackSummary` 很容易在某个分支被漏传而被静默清空（`generateWikiJson` 的 `techStackSummary` 参数是可选的，不传即丢失）。统一成一个函数从源头杜绝这个问题。

**替代方案考虑**：让每个新工具直接调用 `generateWikiJson`——放弃，因为三个操作的"改 pages"逻辑（append / filter / map）虽然不同，但"加载旧值→保底字段透传→写回"这部分完全一样，分开写会重复且容易漂移。

### D2. 统一的磁盘路径解析

新增一个共享的路径解析点（复用/包装 `getWikiDir()`），所有新代码（Delete 的删除、Update-metadata 的搬移）一律通过它计算 `.open-zread/wiki/{section}/{file}`，不再像现有 `write_page` 那样直接拼字符串。**不改动 `write_page` 现有实现**（保持改动面最小），但新工具建立统一入口，为将来收敛这处不一致留出路径。

### D3. slug 唯一性校验：拒绝重试，不自动改名

Create（`AppendBlueprintTool`）和 Update-metadata（改 slug/section 时）共用同一个校验函数：新 slug 若与 `wiki.json` 中已有页面冲突，返回 `is_error`，要求调用方（Agent）换一个 slug 重试。不做本地自动加后缀——因为自动改名可能产出让用户困惑的 slug，而"打回重试"复用的是 `write_page` 已经验证过的"校验失败→反馈→Agent 自行修正"模式。

### D4. 允许新建顶层 section，Create 与 Update-metadata 规则一致

两个操作都不强制"必须挂到现有 section"——如果都不合适，允许新建一个顶层 section（仍是扁平模型，不引入层级）。Prompt 层面会引导"优先复用现有分类"，但不做硬性拦截，避免出现"垃圾抽屉 section"和"什么都往新 section 塞"这两种极端之间，交给 Agent 判断。

### D5. 并发/时序：进程内互斥，不做跨进程锁

四个操作都会修改同一份 `wiki.json`。由于项目是单用户本地 CLI（同一时刻只有一个 TUI 进程访问 `.open-zread/`），只需要**应用层的进程内互斥**：`manage` 模式下同一时间只允许一个 `a`/`d`/`e`/`r` 触发的操作在执行，其余快捷键在此期间禁用（UI 层禁用，不是文件锁）。不引入跨进程文件锁——超出当前使用场景，属于过度设计。

### D6. 各操作是否需要 Agent 参与

| 操作 | 是否需要 Agent | 原因 |
|---|---|---|
| Create | 需要 | 要把自由文本主题描述映射到具体源码文件，依赖三层 Repo Map 工具做代码探索 |
| Delete | 不需要 | 用户直接从已有页面列表选择，纯确定性操作 |
| Update-metadata（title/section/group） | 不需要 | 用户直接编辑字段，表单式输入 |
| Update-metadata（associatedFiles 变更） | 需要 | 判断新的关联文件范围需要代码探索能力，复用 Create 阶段的三层 Repo Map 工具 |
| Update-content（小节重写） | 需要 | 依据用户的自然语言指令改写文本内容 |

Update-content 不需要新的工具集——直接复用页面 Agent 现有工具（`FileReadTool`/`FileEditTool`/`GlobTool`/`GrepTool`/`WritePageTool`），只新增一个 prompt：把旧正文全文 + 用户对目标小节的重写指令一起交给 Agent，要求它在自己的上下文里拼出"替换目标小节后的完整新正文"，然后仍然调用 `write_page`（而不是用 `FileEditTool` 直接做局部编辑）整篇写回。这样保留了 `write_page` 内置的 Mermaid 语法自检，不需要为局部编辑单独实现一遍校验。

### D7. Create 触发前的缓存刷新

复用 `use-catalog.ts` 现有的四步（`scanFiles → saveCachedManifest → parseFiles → saveCachedSymbols`），保证三层 Repo Map 工具读到的 `last_symbols.json` 不是过期数据。Delete/Update-metadata（纯字段编辑）/Update-content 不需要这一步——它们不依赖 Repo Map 工具探索代码。Update-metadata 的 associatedFiles 变更分支需要 Repo Map 工具时，同样先跑一次这四步。

### D8. Delete 是全新独立实现，不接入现有归档系统

不尝试修复或复用 `WikiStore.archivePage`/`createVersionSnapshot`。理由：那套机制依赖的目录结构（`current/`/`archived/`/`versions/`）从未与实际的落盘布局（`.open-zread/wiki/{section}/{file}` 平铺）对齐过，修复它是一个独立范围更大的问题，混进本提案会模糊"提供一个能用的删除"这个明确目标。

## Risks / Trade-offs

- **[Risk]** `techStackSummary` 在某次写回时被意外清空 → **Mitigation**：D1 的共享 mutator 强制透传旧值，除非显式替换。
- **[Risk]** Update-metadata 改 section 时，文件搬移与 wiki.json 写回不是原子操作——搬移成功但 JSON 写入失败（或反之）会导致磁盘状态与 wiki.json 不一致 → **Mitigation**：约定顺序为"先移动文件，成功后再写 JSON；JSON 写入失败则尝试把文件移回原路径（best-effort）"。这不是完全事务性的，但 D5 的进程内互斥把并发窗口降到最低，且失败场景可通过重新执行同一操作自愈。作为 v1 已知限制记录，不追求分布式事务级别的保证。
- **[Risk]** 反复执行 Create 而不做全量 sync，可能导致新页面与旧页面的 `associatedFiles` 产生内容重叠（同一块代码被两篇文章各自"拥有"） → **Mitigation**：Agent prompt 引导其在生成前查看旧 wiki.json 的 title/associatedFiles 列表，判断是否应该扩展已有页面而非新建；不做机器强制查重，与现有 `ValidateBlueprintTool` 的软校验哲学一致。
- **[Risk]** Delete 或 Update-metadata 作用于一篇正在后台生成内容的页面（例如用户在某页内容还在生成时就触发删除） → **Mitigation**：D5 的进程内互斥天然覆盖了这个场景——同一时刻只有一个操作在跑，UI 在有生成任务在途时禁用 `a`/`d`/`e` 快捷键。是否需要额外的"取消正在进行的生成任务"能力留作 Open Question。
- **[Risk]** 新建顶层 section 的规则较宽松，长期反复 Create 可能导致 section 数量膨胀、粒度不一致 → **Mitigation**：仅靠 prompt 引导"优先复用"，不做硬拦截；如果实践中确实成为问题，属于后续迭代范围，不在本提案解决。

## Migration Plan

纯增量特性，无破坏性变更：
- `WikiPage`/`WikiOutput` 类型不需要新增字段，现有 `wiki.json` 文件无需迁移即可被新功能读取。
- 新 UI 入口（`a`/`d`/`e`）只在 `manage` 模式下出现，不影响 `generate`/`continue`/`force` 模式的现有行为。
- 新工具（`AppendBlueprintTool`/`UpdatePageMetadataTool`）与共享辅助函数是新增文件，不修改现有工具的对外行为；`write_page`/`GenerateBlueprintTool`/`GenerateSyncBlueprintTool` 均不改动。
- 没有回滚需求——即使不启用新快捷键，现有生成/同步流程完全不受影响。

## Open Questions

- 用户在某页内容仍在后台生成时触发 Delete/Update，除了"禁用快捷键"之外，是否需要真正取消正在进行的 Agent 会话？现有代码里没有找到生成任务的取消机制，需要在 tasks 阶段确认是否要新增。
- Update-metadata 的文件搬移失败回滚（"best-effort 移回原路径"）如果连移回都失败，应该给用户什么样的错误提示和恢复指引？
- Create 一次产出多篇页面时，如果其中一篇 slug 冲突、其余合法，`AppendBlueprintTool` 是整批打回重试，还是接受合法的、只打回冲突的那一篇？当前倾向整批打回（实现更简单，与 D3 的"打回重试"哲学一致），但未最终拍板。
