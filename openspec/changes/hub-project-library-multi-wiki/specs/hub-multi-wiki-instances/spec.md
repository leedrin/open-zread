## ADDED Requirements

### Requirement: 发现项目内的独立 Wiki 实例

Hub SHALL 在添加项目时定位根目录及真实子目录中的 OpenZread 和 Zread Wiki，并提供重新扫描与指定子目录定位入口。每份实例 SHALL 有稳定的 `wikiId`、Provider、相对目录、显示标签及独立可读状态；同一源目录可包含两种 Provider，且不构成两个顶层项目。

#### Scenario: 根目录和子目录混合存在
- **WHEN** 注册项目根目录有 OpenZread Wiki，`framework/` 有 Zread Wiki，`systems/combat/` 同时有两种 Wiki
- **THEN** Hub 列出四份可单独选择的 Wiki 实例，并显示各自相对目录与 Provider

#### Scenario: Wiki 不完整或扫描失败
- **WHEN** 某候选 Wiki 的 Catalog 无效、页面缺失，或目录扫描达到限制
- **THEN** Hub 保留其他已发现实例，分别显示无效/部分可读或扫描不完整状态，并提供重新扫描或指定子目录定位操作

#### Scenario: 链接目录越界
- **WHEN** 项目子目录中的 symlink、junction 或其他重解析点指向注册项目外部
- **THEN** Hub 不沿该链接发现或读取 Wiki，不把外部文件加入项目实例清单

#### Scenario: 重新定位注册项目
- **WHEN** 项目注册路径更新，但内部 Wiki 的相对目录未变化
- **THEN** 这些 Wiki 实例的身份保持稳定，阅读状态仍可对应到原实例

### Requirement: 所选实例是全部 Wiki 操作的目标

Hub SHALL 使用选中的 `wikiId` 定位 Reader、源文件/图片、搜索、AI 问答、编辑预览与写回、创建/删除/元数据、历史以及生成/同步任务。后端 MUST 在每次读取或写入前确认实例仍位于注册项目内；嵌套实例解析失败 MUST NOT 回退到根目录或同 Provider 的另一份 Wiki。

#### Scenario: 阅读两个同 Provider Wiki
- **WHEN** 同一项目在根目录和子目录各有一份 OpenZread Wiki，用户在两者间切换
- **THEN** Reader 展示所选实例的 Catalog、页面、关联源码及图片，两份 Wiki 的同名 slug 不互相覆盖

#### Scenario: 搜索定位到指定实例
- **WHEN** 跨项目搜索命中子目录 Wiki 中的页面
- **THEN** 搜索结果显示项目、相对目录和 Provider，点击后打开该 `wikiId` 的准确页面；某一实例搜索失败不阻断其他实例结果

#### Scenario: 在子目录 Wiki 修改页面
- **WHEN** 用户预览并确认对子目录 Wiki 的正文或结构修改
- **THEN** 预览和应用都绑定同一实例及原文件修订，写入仅发生在该实例的原始 Wiki 文件；实例路径或修订变化时拒绝应用

#### Scenario: 在子目录生成或同步
- **WHEN** 用户针对子目录 Wiki 启动生成/同步，或继续失败任务
- **THEN** 任务在该实例的源目录运行，事件、checkpoint 和结果归属同一 `wikiId`，不会影响根目录 Wiki

#### Scenario: 实例在操作前消失
- **WHEN** 已选子目录被移走或不再包含对应 Wiki
- **THEN** Hub 报告该实例不可用并提供重新扫描/返回选择，不读取或写入别的实例

### Requirement: 根目录旧数据兼容

Hub SHALL 保持既有根目录 OpenZread/Zread Wiki 可读；旧阅读偏好中的 `projectId + provider` 仅迁移到相应根目录实例，不自动匹配任何子目录实例。

#### Scenario: 升级已有项目
- **WHEN** 用户升级后打开以前注册且仅有根目录 Wiki 的项目
- **THEN** 项目仍可阅读，原 Provider 的最近页面和滚动位置恢复到根目录实例

#### Scenario: 旧实例路径不存在
- **WHEN** 旧阅读偏好对应的根目录 Wiki 已删除，但子目录有同 Provider Wiki
- **THEN** Hub 提示旧实例不可用并允许用户选择子目录实例，不用子目录 Wiki 伪装恢复旧会话
