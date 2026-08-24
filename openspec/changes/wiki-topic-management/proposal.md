## Why

目前对一个已生成的 Wiki 做任何结构性调整，只有两条路径：**全量重新生成**（丢弃全部现有页面重新规划）或**全量 sync**（触发条件是源码文件 diff，且每次都会重新解析整个仓库、重新过一遍所有旧页面）。当用户只是想"加一个新主题"、"删掉一篇加错的文章"、"把某篇挪个分类"或"局部改写某一小节"时，没有任何轻量路径可用，只能承受一次全量操作的时间和 Token 成本，或者手动编辑 `wiki.json` 和 `.md` 文件。此外，代码调研（`docs/research/wiki-generation-and-maintenance.md`）确认现有的归档/版本快照机制（`WikiStore.archivePage()` / `createVersionSnapshot()`）是死代码——它们依赖的 `.open-zread/wiki/current/` 目录从未被任何写入路径填充过，因此"删除主题"在当前代码库里实际上完全不可用。

## What Changes

- 新增 CLI 入口：`wiki-generate` 页面 `mode=manage` 视图下新增快捷键 `a`（新增主题）、`d`（删除主题）、`e`（编辑元数据），与已有的 `r`（重新生成整篇内容）并列。
- 新增"定点追加"能力：用户输入自由文本主题描述，触发一次轻量刷新（`scanFiles → saveCachedManifest → parseFiles → saveCachedSymbols`）后，由一个新 Agent（三层 Repo Map 工具 + 新的 `AppendBlueprintTool`）产出 1~N 篇新页面，追加进 `wiki.json` 并只对新页面触发内容生成。允许挂载到现有 section/group，也允许新建顶层 section。
- 新增"删除主题"能力：无需 Agent 参与的确定性操作——用户从已有页面列表中选择、二次确认后，从 `wiki.json` 移除该条目并删除对应 `.md` 文件。**不复用**现有的 `archivePage`/`createVersionSnapshot` 死路径。
- 新增"编辑元数据"能力：新的 `UpdatePageMetadataTool` 支持修改已有页面的 `title`/`section`/`group`/`associatedFiles`。修改 `section` 时同步将 `.md` 文件移动到新路径；修改 `associatedFiles` 后自动触发该页内容重新生成。
- 新增"小节级重新生成"能力：对已生成文章的某个小节做局部重写，而非整篇重来。Agent 读取旧正文、在自身上下文中拼接出替换目标小节后的完整新文本，仍通过现有 `write_page` 工具整篇写回，以保留其内置的 Mermaid 语法自检。
- 新增共享基础设施（详见 design.md）：统一的 `wiki.json` 读-改-写流程、统一的磁盘路径解析、统一的 slug 唯一性校验、统一的"新建顶层 section"规则、跨操作的并发/时序约束。这些是四个操作能否安全共存的前提，因此作为同一提案的一部分统一设计，不拆分成多个提案。

## Capabilities

### New Capabilities
- `wiki-topic-management`: 在已生成的 Wiki 上对单篇/少量页面做增、删、改元数据、改内容（小节级）的轻量维护能力，覆盖 CLI 交互、Agent 工具、共享的 wiki.json 读改写与路径管理基础设施。

### Modified Capabilities
（无——项目此前没有已归档的 spec，本提案是首个 capability。）

## Impact

- **新增代码**：
  - `packages/orchestrator/src/tools/`：`AppendBlueprintTool`、`UpdatePageMetadataTool`（新文件或追加到 `output-tools.ts`）
  - `packages/orchestrator/src/prompts/`：新增主题 Agent 的 prompt、小节级重生成 Agent 的 prompt
  - `packages/utils/src/output/` 或 `storage/`：统一的 wiki.json 读改写辅助函数、统一路径解析辅助函数
  - `apps/cli/src/views/wiki-generate/`：新增快捷键处理、文本输入组件、删除确认对话框、对应 hooks
- **复用但不修改行为**：`generateWikiContent`（内容生成主函数）、`regeneratePage`（整篇重生成）、`write_page` 工具及其 Mermaid 校验、三层 Repo Map 工具（`GetDirectoryTree`/`GetCoreSignatures`/`GetModuleDetails`）
- **不涉及**：现有的 `WikiStore.archivePage`/`versioning.ts`（本提案不修复这条死路径，删除功能是全新实现，与之无关）；sync 流程（`syncWiki`）本身不改动
- **数据结构**：`WikiPage` 类型（`packages/types/src/wiki.ts`）预计不需要新增字段——`section`/`group`/`title`/`associatedFiles` 均已存在；如小节级重生成需要额外的"小节标识"元数据，将在 design.md 中评估是否需要扩展类型
