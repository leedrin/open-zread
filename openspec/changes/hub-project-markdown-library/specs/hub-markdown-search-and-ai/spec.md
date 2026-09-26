## ADDED Requirements

### Requirement: Markdown 目录内与全局搜索

Hub SHALL 支持在当前项目 Markdown 工作区按文件名、相对路径和正文检索，并在 Hub 全局搜索中与 Wiki 结果并列展示 Markdown 命中。结果 MUST 标注 `local_markdown` 来源、项目、真实相对路径、标题及正文片段或命中位置；Markdown 文件不得使用 Wiki Provider/slug 伪装身份。

#### Scenario: 项目内搜索
- **WHEN** 用户在项目 Markdown 工作区搜索文件名、路径片段或正文词语
- **THEN** 结果仅来自该项目允许的 Markdown 文件，显示可辨认的相对路径；点击结果打开准确文件并定位正文命中

#### Scenario: 全局混合结果
- **WHEN** 同一查询同时命中某项目 `docs/guide.md` 和一份 OpenZread Wiki 页面
- **THEN** 全局搜索分别标记“Markdown · docs/guide.md”与对应 Wiki Provider/实例，点击各自结果进入正确工作区和位置

#### Scenario: 索引过期或部分失败
- **WHEN** 搜索结果对应文件已被移动，或扫描中有部分文件不可读
- **THEN** 打开旧结果前重新校验并提示刷新；搜索报告部分失败但仍返回其他有效 Markdown 和 Wiki 命中

### Requirement: 当前文档 Ask AI

Hub SHALL 在 Markdown 工作区保留 Ask AI，默认仅以当前打开的原始 Markdown 文档、用户问题及可选选中文字作为上下文调用已配置模型。发送前 SHALL 告知用户内容会发送给所配置模型；服务端 MUST 重新确认目标文件及输入大小。问答 MUST 为只读，AI 回答不得自动修改文档或被视为跨项目/跨文件检索结果。

#### Scenario: 对当前文章提问
- **WHEN** 用户打开 `docs/guide.md`、选择一段文字并使用 Ask AI 提问
- **THEN** 模型收到当前文件正文、问题及所选文字；回答在该工作区显示并标明当前文件来源，不包含未选择的其他项目文件

#### Scenario: 模型不可用或文件变化
- **WHEN** 未配置模型、当前文件不可访问或文档超过允许的上下文大小
- **THEN** Hub 显示明确错误与可采取的下一步，不静默改用另一文件或发送整个项目目录

#### Scenario: 采纳 AI 修改建议
- **WHEN** 用户想把 Ask AI 的建议加入 Markdown 正文
- **THEN** 必须显式进入普通编辑、预览和确认写回流程；仅查看回答不会改变原文件
