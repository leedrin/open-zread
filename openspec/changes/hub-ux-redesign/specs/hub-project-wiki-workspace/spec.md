## ADDED Requirements

### Requirement: 项目工作区的稳定阅读布局
Hub SHALL 在项目内展示项目上下文、概览/Wiki/代码/维护/项目设置入口、章节树和独立文章阅读区域。Wiki 页面 SHALL 保持可辨识的当前章节、标题、Provider、关联源文件和阅读导航；展开新增/问答/历史等功能 MUST 不把文章推到项目库页面下方。Wiki 阅读视图 MUST NOT 常驻重复的项目摘要卡（如路径、可用状态和打开目录）；这些低频项应在项目设置中查看，阅读区域优先留给章节树和文章。

#### Scenario: 阅读 Wiki 页面
- **WHEN** 用户在项目工作区选择一个可读章节
- **THEN** 章节树突出该项，文章区域展示正文及其真实元数据，章节树和正文可分别滚动

#### Scenario: 阅读时查看项目资料
- **WHEN** 用户在项目工作区阅读 Wiki
- **THEN** 顶部保留项目面包屑和项目内导航，但不显示重复的项目摘要卡；路径、可访问性等项目资料可在项目设置中查看，章节树和文章使用更多可视空间

#### Scenario: Wiki 工具栏与项目导航并排
- **WHEN** 用户在项目工作区打开 Wiki 阅读器
- **THEN** Provider 切换、新建页面、历史恢复和问答操作位于项目导航栏右侧；导航栏下方立即显示章节树和文章，不保留独立 Wiki 标题卡或空白控制栏

#### Scenario: Wiki 导航下方无额外留白
- **WHEN** 用户在项目工作区切换到 Wiki、概览或代码页签
- **THEN** 项目主内容区紧接项目导航栏开始；Wiki 的章节树和文章占满导航栏下方的可用区域，不受页面容器上下内边距或独立工具栏占位压缩

#### Scenario: Markdown 表格与 Mermaid 图表
- **WHEN** 当前 Wiki 页面包含 Markdown 表格或 `mermaid` fenced code block
- **THEN** 表格以可读、可横向滚动的表格结构展示；Mermaid 代码被渲染成自适应 SVG 图表，且无效图表保留可读源码和错误提示

#### Scenario: 单页读取失败
- **WHEN** 当前 Wiki 中某一页无法读取但其他页可读
- **THEN** Hub 在该页显示局部错误并允许选择其他章节，不将整份 Wiki 误判为完全不可用

### Requirement: 双 Provider 阅读会话隔离
Hub SHALL 按 `projectId + provider` 独立保存最近页面、滚动位置和章节展开状态。切换 Provider SHALL 恢复目标 Provider 的会话，MUST 不根据同名标题或 slug 自动对齐两个 Provider 的页面。用户明确点击搜索结果时可定位该结果对应的 Provider 和页面。

#### Scenario: 往返两个 Provider
- **WHEN** 用户在 OpenZread 阅读 A 页、在 Zread 阅读 B 页，随后来回切换
- **THEN** 两边分别恢复 A/B 页及各自的阅读位置

#### Scenario: 目标 Provider 原页面消失
- **WHEN** 用户切换到某 Provider，但其上次阅读页面已删除或不可读
- **THEN** Hub 显示该 Wiki 的概览或第一可读入口并说明原页面不可用，不跳到另一个 Provider 的同名页面

### Requirement: 搜索结果精确定位
Hub SHALL 让跨项目搜索结果明确携带项目、Provider、页面与片段，并从搜索结果定位到对应的 Wiki 页面；项目内搜索 SHALL 限定当前项目和当前 Provider 或清楚显示扩大搜索的范围。搜索失败的来源 SHALL 不阻断其他结果。

#### Scenario: 打开跨项目搜索命中
- **WHEN** 用户点击另一项目的 Zread Wiki 搜索命中
- **THEN** Hub 打开该项目的 Zread Wiki 对应页面并定位到命中内容，同时保留返回原搜索结果的入口

#### Scenario: 部分来源索引失败
- **WHEN** 一个项目的 Wiki 无法索引，但其他项目有匹配结果
- **THEN** Hub 显示可用结果并单独说明失败来源

### Requirement: 互斥的上下文面板
Hub SHALL 以按需打开的上下文面板承载当前 Wiki 的 AI 问答、关联源码查看、元数据和历史信息；同一时刻最多显示一种面板。问答 SHALL 明确限定当前项目及当前 Provider，引用应可追溯；源码查看 SHALL 使用已有受限源文件读取能力。

#### Scenario: 从源码引用打开文件
- **WHEN** 用户在文章中选择关联源文件引用
- **THEN** Hub 打开该项目内的只读源码面板，保留原文章位置，并提供返回文章的方式

#### Scenario: 从问答切换到历史
- **WHEN** AI 问答面板打开时用户选择历史入口
- **THEN** 历史面板取代问答面板，文章位置不变，两个面板不会同时挤占正文

#### Scenario: 问答依据不足
- **WHEN** 当前 Wiki 中没有足够依据回答问题
- **THEN** Hub 显示依据不足而非编造引用；问答本身不写入 Wiki 原文件
