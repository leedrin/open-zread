## Why

项目中的 README、设计文档和其他 Markdown 文章目前不属于 OpenZread/Zread 的 `wiki.json`，因此无法在 Hub 中按目录浏览、统一阅读与维护，也不会出现在现有 Wiki 搜索中。用户希望这些原文件成为项目知识工作区的一部分，同时保留编辑、搜索和 Ask AI，而不把它们伪装成可生成的第三个 Wiki Provider。

## What Changes

- 在项目库侧栏的项目节点下新增“Markdown”节点，按项目原目录结构展示符合范围的 Markdown 文件；排除现有 Provider 管理的 Wiki 输出，避免重复文章。
- 在项目页新增独立“Markdown”页签。点击侧栏文件直接打开该页签和目标文档；主区域显示可调整宽度的目录树、文章阅读区及可收起的大纲/Ask AI 面板，不出现 Wiki Provider、生成、同步或 Wiki 历史控件。
- 复用并完善现有 Markdown 阅读能力，正确处理相对 Markdown 链接、图片、代码块、表格和 Mermaid；支持编辑预览并在确认后写回原 `.md` 文件，检测外部修改冲突。
- 为 Markdown 文件建立仅用于发现与检索的本地索引；支持目录内按名称、路径、正文搜索，并纳入 Hub 全局搜索，结果带来源和精确文件位置。
- 在 Markdown 工作区保留 Ask AI：默认仅把当前文档（可选选中文字）作为上下文发送给已配置模型；回答不自动改写文件，任何 AI 建议都须经过编辑预览和用户确认。

## Capabilities

### New Capabilities

- `hub-project-markdown-discovery`: 项目内 Markdown 范围、目录树、稳定文件身份、刷新与安全路径边界。
- `hub-markdown-workspace`: 独立项目页签、三栏阅读、相对资源导航、编辑原文件及会话恢复。
- `hub-markdown-search-and-ai`: 目录内及全局搜索、命中直达、当前文档 Ask AI 与隐私边界。

### Modified Capabilities

无。当前 `openspec/specs/` 没有已发布的 Hub capability；与进行中的 `hub-project-library-multi-wiki` 分开提案，实施时协调项目树与搜索契约。

## Impact

- Hub React 项目导航、侧栏树、Reader/Markdown 渲染、搜索与本地偏好需要扩展；Tauri 增加项目内 Markdown 发现、读取、资源解析、搜索、保存及 Ask AI 命令。
- `hub-contract` 和 application service 增加区分 `wiki` 与 `local_markdown` 的身份/搜索结果契约；Provider 枚举仍只包含 OpenZread 和 Zread。
- 不移动或复制用户文档，不自动生成 `wiki.json`，不改变现有 Wiki 生成与历史行为；实施完成后的 Windows MSI 按项目交付流程验证。
