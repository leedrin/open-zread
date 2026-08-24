## 1. 共享基础设施

- [ ] 1.1 新增 `mutateWikiBlueprint(mutator)` 辅助函数（`packages/utils/src/output/` 或复用 `wiki-content.ts`）：加载现有 `wiki.json`、对 `pages` 应用传入的 mutator、写回时显式透传原有 `techStackSummary`
- [ ] 1.2 新增统一的 wiki 页面文件路径解析辅助函数（包装 `getWikiDir()`，计算 `.open-zread/wiki/{section}/{file}`），供 Delete 和 Update-metadata 的搬移/删除逻辑使用
- [ ] 1.3 新增共享的 slug 唯一性校验函数：对照 `wiki.json` 现有 `pages`，冲突则返回可用于 `is_error` 反馈的结果
- [ ] 1.4 在 `apps/cli` 侧新增一个进程内互斥状态（例如一个 context/ref 标记"当前是否有维护操作在执行"），供 `manage` 模式下的快捷键处理逻辑判断是否阻止新的触发

## 2. 新增主题（Create）

- [ ] 2.1 新增 `AppendBlueprintTool`（`packages/orchestrator/src/tools/output-tools.ts` 或新文件）：接收 Agent 产出的新页面数组，用 1.3 的校验函数检查 slug 冲突（冲突则整体拒绝并返回 `is_error`），通过后用 1.1 的 `mutateWikiBlueprint` 追加写回
- [ ] 2.2 新增"新增主题" Agent 的 prompt（`packages/orchestrator/src/prompts/`）：输入包含旧 `wiki.json` 摘要（现有 section/group/title 列表）与用户主题描述，引导优先复用现有 section、必要时才新建顶层 section，禁止塞入过多文件到单页
- [ ] 2.3 新增触发新增流程的入口函数（`packages/orchestrator/src/` 或复用 `orchestrator.ts` 模式）：先执行 `scanFiles → saveCachedManifest → parseFiles → saveCachedSymbols` 四步刷新，再以三层 Repo Map 工具 + `AppendBlueprintTool` 启动 Agent
- [ ] 2.4 新页面写入 `wiki.json` 后，对新增页面调用现有 `generateWikiContent()` 触发内容生成

## 3. 删除主题（Delete）

- [ ] 3.1 新增确定性的删除函数（无需 Agent）：用 1.1 的 `mutateWikiBlueprint` 从 `pages` 中过滤掉指定 slug，并用 1.2 的路径解析删除对应 `.md` 文件
- [ ] 3.2 处理删除目标文件不存在时的容错（wiki.json 有记录但磁盘文件缺失的场景，不应阻塞 wiki.json 的清理）

## 4. 编辑页面元数据（Update-metadata）

- [ ] 4.1 新增 `UpdatePageMetadataTool`：支持修改 `title`/`section`/`group`/`associatedFiles`，复用 1.3 的 slug/路径冲突校验
- [ ] 4.2 实现 section 变更时的文件迁移逻辑：先移动 `.md` 文件到新路径，成功后再用 1.1 写回 `wiki.json`；写回失败时尝试把文件移回原路径（best-effort），并向用户报告失败原因
- [ ] 4.3 实现 associatedFiles 变更后自动触发该页面 `regeneratePage`（复用现有机制）
- [ ] 4.4 区分"表单直接编辑"（title/section/group，无需 Agent）与"associatedFiles 需要代码探索"（需要 Agent + 三层 Repo Map 工具，复用第 2 节的缓存刷新步骤）两种触发路径

## 5. 小节级内容重新生成（Update-content）

- [ ] 5.1 新增"小节重写" prompt（`packages/orchestrator/src/prompts/`）：输入旧正文全文 + 用户对目标小节的重写指令，要求 Agent 在自身上下文中拼接出替换目标小节后的完整新正文
- [ ] 5.2 新增触发函数：复用现有页面 Agent 工具集（`FileReadTool`/`FileEditTool`/`GlobTool`/`GrepTool`/`WritePageTool`），指示 Agent 最终通过 `write_page` 整篇写回，而非用 `FileEditTool` 做局部编辑，以保留 Mermaid 校验
- [ ] 5.3 验证 Mermaid 校验失败时的报错反馈路径与现有 `write_page` 行为一致（不写入、返回 `is_error`、原文件不变）

## 6. CLI 集成与交互

- [ ] 6.1 在 `apps/cli/src/views/wiki-generate/index.tsx` 的 `manage` 模式下新增快捷键：`a`（新增主题）、`d`（删除主题）、`e`（编辑元数据），复用已有 `r`（重新生成）的交互模式
- [ ] 6.2 新增文本输入组件用于"新增主题"的主题描述输入（参考 `config-apikey` 视图中 `TextInput` 的既有用法）
- [ ] 6.3 新增删除二次确认对话框
- [ ] 6.4 新增元数据编辑表单（title/section/group 字段直接编辑；associatedFiles 编辑入口区分表单模式与"描述意图交给 Agent"模式）
- [ ] 6.5 新增小节重写的指令输入界面（选中目标页面 + 输入重写指令）
- [ ] 6.6 接入 1.4 的进程内互斥状态，四个新快捷键与已有 `r` 快捷键在任一操作执行期间互相禁用
- [ ] 6.7 为四类操作补充 loading/成功/失败的 UI 反馈，与现有 `state.articles.pages` 状态展示模式保持一致

## 7. 验证

- [ ] 7.1 执行 `bun run typecheck`，确保新增代码类型检查通过
- [ ] 7.2 执行 `bun run lint`，确保符合项目 ESLint 规范（含 `no-explicit-any` 等强制规则）
- [ ] 7.3 补充新增工具（`AppendBlueprintTool`/`UpdatePageMetadataTool`/共享辅助函数）的单元测试，覆盖 slug 冲突、section 迁移失败回滚、`techStackSummary` 透传等场景
- [ ] 7.4 手动验证四类操作在真实 `.open-zread/wiki` 目录上的端到端行为（新增/删除/改元数据/改小节各跑一遍，检查 `wiki.json` 与磁盘文件的一致性）
