## ADDED Requirements

### Requirement: 新增主题
系统 SHALL 允许用户在 `manage` 模式下输入自由文本主题描述，由 Agent 结合三层 Repo Map 工具产出 1 篇或多篇新的 `WikiPage`，追加进现有 `wiki.json`，并只对新增页面触发内容生成。

#### Scenario: 输入主题描述后生成新页面并写入内容
- **WHEN** 用户在 `manage` 模式下按下新增快捷键并输入一段主题描述
- **THEN** 系统先刷新代码扫描缓存（重新执行 scan/parse 并保存 manifest 与 symbols），再启动 Agent 产出新页面，将新页面追加到 `wiki.json` 的 `pages` 数组，并为每个新页面生成对应的 `.md` 内容文件

#### Scenario: 新 slug 与已有页面冲突
- **WHEN** Agent 产出的新页面 slug 与 `wiki.json` 中任意已有页面的 slug 相同
- **THEN** 系统拒绝写入该页面并向 Agent 返回错误反馈，要求其更换 slug 后重新提交，不自动生成替代 slug

#### Scenario: 现有 section 均不适合新主题
- **WHEN** Agent 判断新主题与 `wiki.json` 中任何现有 section 都不匹配
- **THEN** 系统允许新页面使用一个此前不存在的顶层 section 名称，无需强制挂载到现有分类

#### Scenario: 一次追加请求产出多篇新页面
- **WHEN** Agent 针对一次主题描述产出多篇新页面
- **THEN** 系统将这些页面作为同一 section 或 group 下的兄弟页一并追加到 `wiki.json`，不引入页面间的父子层级字段

### Requirement: 删除主题
系统 SHALL 允许用户从已有页面列表中选择一篇页面，经二次确认后将其从 `wiki.json` 中移除并删除对应的 `.md` 文件，且该操作不依赖或触发现有的归档/版本快照机制。

#### Scenario: 用户确认删除
- **WHEN** 用户在 `manage` 模式下选中一篇已有页面并按下删除快捷键，且在确认提示中选择确认
- **THEN** 系统将该页面从 `wiki.json` 的 `pages` 数组中移除并写回，同时删除磁盘上对应的 `.md` 文件

#### Scenario: 用户取消删除
- **WHEN** 用户在确认提示中选择取消
- **THEN** 系统不修改 `wiki.json`，也不删除任何文件

### Requirement: 编辑页面元数据
系统 SHALL 允许用户修改已有页面的 `title`、`section`、`group`、`associatedFiles`；修改 `section` 时系统 SHALL 同步将该页面的 `.md` 文件迁移到新路径；修改 `associatedFiles` 时系统 SHALL 自动触发该页面的内容重新生成。

#### Scenario: 修改 section 触发文件迁移
- **WHEN** 用户将某页面的 `section` 修改为一个不同的值并提交
- **THEN** 系统更新 `wiki.json` 中该页面的 `section` 字段，并将其 `.md` 文件从旧的 `{旧section}/{file}` 路径移动到新的 `{新section}/{file}` 路径

#### Scenario: 修改 associatedFiles 触发内容重新生成
- **WHEN** 用户修改某页面的 `associatedFiles` 并提交
- **THEN** 系统更新 `wiki.json` 中该字段后，自动对该页面重新执行内容生成

#### Scenario: 仅修改 title 或 group
- **WHEN** 用户只修改某页面的 `title` 或 `group`，未修改 `section` 或 `associatedFiles`
- **THEN** 系统更新 `wiki.json` 对应字段，不移动任何文件，也不自动触发内容重新生成

#### Scenario: 修改后的标识与现有页面冲突
- **WHEN** 用户编辑导致的新 slug 或新 section+file 组合与另一篇现有页面冲突
- **THEN** 系统拒绝该次编辑并提示冲突，不写入 `wiki.json`

### Requirement: 小节级内容重新生成
系统 SHALL 允许用户对某篇已生成页面的一个小节提出重写指令，仅重新生成该小节内容，其余内容保持不变，且最终写入仍需通过现有的 Mermaid 语法校验。

#### Scenario: 局部重写单个小节
- **WHEN** 用户选中一篇已有页面并提供针对某个小节的重写指令
- **THEN** Agent 读取该页面的现有正文全文，在自身上下文中构造出仅替换目标小节、其余内容保持不变的完整新正文，并通过现有的页面写入工具整篇写回

#### Scenario: 重写结果未通过 Mermaid 校验
- **WHEN** Agent 构造的新正文中包含语法不合法的 Mermaid 图表
- **THEN** 系统拒绝写入并将校验错误反馈给 Agent，要求其修正后重新提交，原有 `.md` 文件内容保持不变

### Requirement: 维护操作共享的 wiki.json 写回保证
系统 SHALL 保证新增、删除、编辑元数据三类操作在写回 `wiki.json` 时，除非操作本身显式修改，否则保留原有的 `techStackSummary` 字段值。

#### Scenario: 写回时未涉及 techStackSummary 的操作
- **WHEN** 新增、删除或编辑元数据操作完成并写回 `wiki.json`
- **THEN** 写回后的 `wiki.json` 中 `techStackSummary` 字段与写回前保持一致

### Requirement: 维护操作互斥执行
系统 SHALL 保证在 `manage` 模式下，新增、删除、编辑元数据、小节级重新生成这四类维护操作在同一时刻至多有一个处于执行中，执行期间禁止发起其他维护操作。

#### Scenario: 已有操作执行期间发起新操作
- **WHEN** 用户在一个维护操作（新增/删除/编辑元数据/小节重新生成）仍在执行时尝试触发另一个维护操作
- **THEN** 系统阻止该次触发，直到当前操作执行完毕
