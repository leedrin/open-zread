## 1. 共享基础设施

- [x] 1.1 新增 `mutateWikiBlueprint(mutator)` 辅助函数（`packages/utils/src/output/` 或复用 `wiki-content.ts`）：加载现有 `wiki.json`、对 `pages` 应用传入的 mutator、写回时显式透传原有 `techStackSummary`
- [x] 1.2 新增统一的 wiki 页面文件路径解析辅助函数（包装 `getWikiDir()`，计算 `.open-zread/wiki/{section}/{file}`），供 Delete 和 Update-metadata 的搬移/删除逻辑使用
- [x] 1.3 新增共享的 slug 唯一性校验函数：对照 `wiki.json` 现有 `pages`，冲突则返回可用于 `is_error` 反馈的结果
- [x] 1.4 在 `apps/cli` 侧新增一个进程内互斥状态（`useTopicManagement` 的 `state.phase`，非 `idle` 即视为占用），供 `manage` 模式下的快捷键处理逻辑判断是否阻止新的触发

## 2. 新增主题（Create）

- [x] 2.1 新增 `AppendBlueprintTool`（`packages/orchestrator/src/tools/output-tools.ts` 或新文件）：接收 Agent 产出的新页面数组，用 1.3 的校验函数检查 slug 冲突（冲突则整体拒绝并返回 `is_error`），通过后用 1.1 的 `mutateWikiBlueprint` 追加写回
- [x] 2.2 新增"新增主题" Agent 的 prompt（`packages/orchestrator/src/prompts/`）：输入包含旧 `wiki.json` 摘要（现有 section/group/title 列表）与用户主题描述，引导优先复用现有 section、必要时才新建顶层 section，禁止塞入过多文件到单页
- [x] 2.3 新增触发新增流程的入口函数（`packages/orchestrator/src/` 或复用 `orchestrator.ts` 模式）：先执行 `scanFiles → saveCachedManifest → parseFiles → saveCachedSymbols` 四步刷新，再以三层 Repo Map 工具 + `AppendBlueprintTool` 启动 Agent（`appendWikiTopic`，返回 `addedPages` 供调用方触发内容生成）
- [x] 2.4 新页面写入 `wiki.json` 后，对新增页面调用现有 `generateWikiContent()` 触发内容生成（`use-topic-management.ts` 的 `submitAdd`）

## 3. 删除主题（Delete）

- [x] 3.1 新增确定性的删除函数（无需 Agent）：用 1.1 的 `mutateWikiBlueprint` 从 `pages` 中过滤掉指定 slug，并用 1.2 的路径解析删除对应 `.md` 文件（`deleteWikiPage`）
- [x] 3.2 处理删除目标文件不存在时的容错（`rm(..., { force: true })`，wiki.json 有记录但磁盘文件缺失时不阻塞清理）

## 4. 编辑页面元数据（Update-metadata）

- [x] 4.1 新增 `updateWikiPageMetadata`（`packages/utils`，纯函数）+ `UpdatePageMetadataTool`（`packages/orchestrator`，Agent 包装）：支持修改 `title`/`section`/`group`/`associatedFiles`（含可选 slug 重命名），复用 1.3 的 slug/路径冲突校验
- [x] 4.2 实现 section 变更时的文件迁移逻辑：先移动 `.md` 文件到新路径，成功后再用 1.1 写回 `wiki.json`；写回失败时尝试把文件移回原路径（best-effort），并向用户报告失败原因
- [x] 4.3 实现 associatedFiles 变更后自动触发该页面内容重新生成（`use-topic-management.ts` 的 `submitEditAssociated`：仅当用户填写了关联范围描述时才调用 `updateWikiTopicAssociatedFiles` + `generateWikiContent`；仅改 title/section/group 时不触发）
- [x] 4.4 区分"表单直接编辑"（title/section/group，直接调用 `updateWikiPageMetadata`，无需 Agent）与"associatedFiles 需要代码探索"（`updateWikiTopicAssociatedFiles`，Agent + 三层 Repo Map 工具，复用第 2 节的缓存刷新步骤）两种触发路径

## 5. 小节级内容重新生成（Update-content）

- [x] 5.1 新增"小节重写" prompt（`packages/orchestrator/src/prompts/section-rewrite.ts`）：输入旧正文全文 + 用户对目标小节的重写指令，要求 Agent 在自身上下文中拼接出替换目标小节后的完整新正文
- [x] 5.2 新增触发函数（`regenerateWikiPageSection`，`packages/orchestrator/src/wiki/regenerate-section.ts`）：复用现有页面 Agent 工具集（`FileReadTool`/`FileEditTool`/`GlobTool`/`GrepTool`/`WritePageTool`），指示 Agent 最终通过 `write_page` 整篇写回，而非用 `FileEditTool` 做局部编辑，以保留 Mermaid 校验
- [x] 5.3 验证 Mermaid 校验失败时的报错反馈路径与现有 `write_page` 行为一致（未改动 `write_page`/`validateMermaidContent`，行为原样复用：不写入、返回 `is_error`、原文件不变）

## 6. CLI 集成与交互

- [x] 6.1 在 `apps/cli/src/views/wiki-generate/index.tsx` 的 `manage` 模式下新增快捷键：`a`（新增主题）、`d`（删除主题）、`e`（编辑元数据）、`w`（小节重写），复用已有 `r`（重新生成）的交互模式
- [x] 6.2 新增文本输入组件用于"新增主题"的主题描述输入（`TopicManagementPanel`，参考 `config-apikey` 视图中 `TextInput` 的既有用法）
- [x] 6.3 新增删除二次确认对话框（`delete-confirm` 阶段，y/n 快捷键）
- [x] 6.4 新增元数据编辑表单（title/section/group 依次编辑，直接调用 `updateWikiPageMetadata`；associatedFiles 描述留空则跳过，非空则交给 `updateWikiTopicAssociatedFiles` 的 Agent 路径）
- [x] 6.5 新增小节重写的指令输入界面（选中目标页面 + 输入重写指令，`w` 快捷键 + `rewrite-input` 阶段）
- [x] 6.6 接入 1.4 的进程内互斥状态：外层 `useInput` 在 `topicManagement.state.phase !== "idle"` 时直接放弃处理，交给面板自身的 `useInput`；`openAdd`/`openDelete`/`openEdit`/`openRewrite` 内部也各自检查 `isBusy`
- [x] 6.7 为四类操作补充 loading（Spinner + 阶段标签）/成功/失败（红绿配色）的 UI 反馈；未复用 `state.articles.pages` 的逐工具调用可视化——单次维护操作用更轻量的"spinner + 阶段文本 + 结果"呈现，足够覆盖 spec 要求且不重复实现批量生成那套 token/倒计时 UI

## 7. 验证

- [x] 7.1 执行 `bun run typecheck`，确保新增代码类型检查通过（全仓库 `bun run typecheck` 通过）
- [x] 7.2 执行 `bun run lint`，确保符合项目 ESLint 规范（含 `no-explicit-any` 等强制规则）（全仓库 `bun run lint` 通过）
- [x] 7.3 补充新增工具/共享辅助函数的单元测试（`packages/utils/src/output/__tests__/wiki-mutation.test.ts`，12 个用例）：`findSlugConflicts` 的四种场景（无冲突/对旧页面冲突/批内重复/excludeSlug 排除自身）、`mutateWikiBlueprint` 的 techStackSummary 透传、`deleteWikiPage` 的正常删除与文件缺失容错、`updateWikiPageMetadata` 的 title 更新/section 迁移文件/slug 冲突拒绝/section+file 路径冲突拒绝/associatedFilesChanged 判定。`bun test` 全量通过（53 pass，唯一 1 fail 是环境预置的 tree-sitter WASM 缺失，与本次改动无关，非新增测试引入）
- [x] 7.4 手动验证：用户在真实项目（Unity 工程）上跑了"新增主题"，Agent 按 append-topic prompt 的拆分粒度规则把"相机系统 V2"拆成 3 篇兄弟页（同 section/group），`wiki.json` 正确追加、V1 页面未受影响，磁盘文件一致——验证了 `wiki.json` 层面的正确性。
  - 发现并修复一个真实 bug：新增完成后，manage 模式下文章列表短暂显示条目数与计数不一致（退出重进后恢复正常）。根因定位：`useArticlesGenerate` 的 `statusMap` 只在首次进入 manage 模式时通过 `initialize()` 构建一次（`isInitialized` 守卫），后续 `wiki.json` 页面集合变化（新增/删除主题）不会触发重新对账，导致新页面查不到状态、UI 短暂不同步。修复：`use-articles.ts` 新增 `syncPages(currentPages)` action，做增量对账（新增页面按磁盘文件是否存在判定状态、已不存在的页面从 statusMap 移除，不重置既有状态）；`use-wiki-generate.ts` 新增一个 effect，在首次初始化完成后监听 `pages` 变化并调用 `syncPages`，覆盖新增/删除/编辑元数据触发的 `wikiCatalog` 更新。`bun run typecheck`/`bun run lint` 均通过。
