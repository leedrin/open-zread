## ADDED Requirements

### Requirement: 项目 Markdown 范围和稳定身份

Hub SHALL 在已注册项目的真实目录内发现 `.md` 和 `.markdown` 文件，并以项目 ID 与规范化的项目内相对路径标识文件。Hub MUST 排除 Provider 管理的 `.open-zread`、`.zread` 内容及依赖/生成目录，不得把普通 Markdown 声称为第三种 Wiki Provider，也不得为其生成 `wiki.json`。

#### Scenario: 项目混合内容
- **WHEN** 项目根目录有 `README.md`，`docs/design/` 有 `overview.md`，同项目还有两种 Provider 的 Wiki 输出
- **THEN** Markdown 树只按原目录显示前两份普通文件；Provider 页面仅保留在各自 Wiki 节点，不重复进入 Markdown 树

#### Scenario: 同名文件和项目重新定位
- **WHEN** `docs/a/guide.md` 与 `docs/b/guide.md` 同时存在，之后项目注册路径改变但内部相对结构不变
- **THEN** 两份文件以各自相对路径区分并保持身份；重新定位后仍可恢复各自阅读状态

### Requirement: Markdown 目录树与显式刷新

Hub SHALL 在全局侧栏的项目节点下提供可展开的“Markdown”节点，并按原目录层级列出含 Markdown 的文件夹和文件。Markdown 工作区 SHALL 提供同源的目录树及明确的“刷新”动作；点击后 MUST 重新检索该项目的候选文件，更新两处目录树及搜索索引，而不是只重绘旧缓存。

#### Scenario: 新增、删除和移动文件后刷新
- **WHEN** 用户在 Hub 外新增 `docs/new.md`，删除 `docs/old.md` 并移动另一份文档，然后点击“刷新”
- **THEN** 两处树与 Markdown 搜索均反映新的项目目录，已不存在的旧路径不再是可打开结果，仍存在的展开目录和当前文件选择尽量保留

#### Scenario: 当前文件在刷新时消失
- **WHEN** 用户正在阅读的原文件被移走或删除，随后刷新目录树
- **THEN** Hub 明确提示该文件已失效并提供重新选择入口，不自动打开同名文件或其他 Wiki 页面

#### Scenario: 空、加载和扫描不完整
- **WHEN** 项目没有候选 Markdown、扫描正在进行、项目不可访问或扫描达到预算
- **THEN** 树显示相应空、加载、错误或部分结果状态；达到预算时显示原因与重试入口，不把部分结果说成完整

### Requirement: 目录与文件访问边界

Hub MUST 不跟随 symlink、junction 或 reparse point 扫描外部目录；每次读取、资源访问、搜索命中打开、问答和保存前 MUST 重新校验实际路径属于注册项目及允许的 Markdown 范围。单个坏文件 MUST NOT 使同项目其他有效文件不可用。

#### Scenario: 链接指向项目外
- **WHEN** 项目中的目录链接或 Markdown 文件链接指向注册项目之外
- **THEN** Hub 不将其加入目录树，且直接请求该路径也不能读取、索引或保存外部内容

#### Scenario: 文件读取失败
- **WHEN** 某个 Markdown 文件损坏、不可读或非受支持文本编码
- **THEN** Hub 对该文件显示具体错误并继续列出、搜索和打开其他有效文件
