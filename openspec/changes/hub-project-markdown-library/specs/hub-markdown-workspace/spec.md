## ADDED Requirements

### Requirement: 独立的 Markdown 阅读工作区

Hub SHALL 在项目级导航中提供独立“Markdown”页签。从全局项目树或搜索结果点击 Markdown 文件 SHALL 打开该项目页签并选中准确文件。工作区 SHALL 显示可调宽/可收起的目录树、自适应文章区及可收起的大纲/Ask AI 区域；项目导航条下方不得插入与阅读无关的常驻项目卡或大块空白。

#### Scenario: 从全局项目树打开文件
- **WHEN** 用户点击 `项目库 → 某项目 → Markdown → docs → guide.md`
- **THEN** 主区域切到该项目的 Markdown 页签，文章显示 `docs/guide.md`，页内目录树选中同一文件，并显示真实相对路径

#### Scenario: 缩放与面板操作
- **WHEN** 用户调整窗口尺寸、拖动目录树宽度或收起大纲/Ask AI 面板
- **THEN** 文章区域随剩余宽度调整且保持可读，目录树和大纲可再次打开，不改变当前文件或正文滚动位置

#### Scenario: Markdown 专属工具条
- **WHEN** 用户在 Markdown 页签打开一篇文件
- **THEN** 工具条提供与该文件相关的刷新、编辑、定位文件和 Ask AI 操作；不显示 Wiki Provider、New page、Wiki History、生成或同步操作

### Requirement: Markdown 渲染和安全导航

Hub SHALL 渲染 Markdown 的标题、段落、列表、任务列表、表格、代码高亮、图片及 Mermaid，并提供当前文章的大纲标题定位。相对链接和图片 MUST 以当前文件所在目录为基准解析；指向同项目 Markdown 的链接 SHALL 在 Markdown 工作区内导航，原始 HTML 不得执行脚本。

#### Scenario: 内部链接、图片和标题锚点
- **WHEN** `docs/intro.md` 包含 `../README.md#usage` 链接及相对图片
- **THEN** 点击链接打开同项目 README 并定位到 Usage 标题，图片从 `intro.md` 的相对目录安全加载

#### Scenario: 图表、代码和大纲
- **WHEN** 文件包含 Mermaid 图、Lua 代码块、表格和多级标题
- **THEN** 图表可阅读并可放大/查看源码，Lua 代码高亮，表格正确显示，大纲点击后定位正确标题并高亮当前章节

#### Scenario: 越界或缺失资源
- **WHEN** 相对链接指向项目外、排除目录或已删除的目标
- **THEN** Hub 不打开越界内容，并给出可理解的失效或安全提示；其他文章内容仍可阅读

### Requirement: 编辑并写回 Markdown 原文件

Hub SHALL 允许用户编辑所选 Markdown 原文件，先展示预览/diff，再经明确确认写回同一路径。保存前 MUST 重新检查文件身份、路径和原始修订；保存成功 SHALL 更新阅读内容、目录标题和搜索索引。Hub MUST 保护未保存草稿，不得因切文件、切项目或关闭阅读区静默丢弃。

#### Scenario: 确认写回
- **WHEN** 用户编辑 `docs/guide.md`、查看改动预览并确认保存，且磁盘原文件未变化
- **THEN** 同一个 `docs/guide.md` 被原子更新，不在 Provider Wiki 目录创建副本；页面、目录树和搜索随后显示新内容

#### Scenario: 外部编辑冲突
- **WHEN** 预览后，磁盘原文件被其他程序修改或路径被移动，再尝试确认保存
- **THEN** Hub 拒绝覆盖并保留草稿，展示冲突与重载/比较/复制草稿入口，不写入同名的其他文件

#### Scenario: 未保存草稿离开
- **WHEN** 用户编辑未保存内容时点击另一 Markdown、Wiki 或项目
- **THEN** Hub 提示保留、放弃或取消导航；取消后当前草稿原样保留

### Requirement: 阅读会话与文件失效

Hub SHALL 按项目及 Markdown 文件相对路径记录最近文件、文章滚动位置和必要的目录展开状态，并与 Wiki 会话隔离。文件失效时 SHALL 提示重新选择，不按文件名猜测替代路径。

#### Scenario: 重新打开项目
- **WHEN** 用户从 Markdown 页签离开后返回，最近文件仍存在
- **THEN** Hub 恢复该文件及其阅读位置，原有 OpenZread/Zread 的阅读状态不受影响
