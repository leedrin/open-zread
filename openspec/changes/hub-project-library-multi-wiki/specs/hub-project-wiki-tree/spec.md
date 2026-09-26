## ADDED Requirements

### Requirement: 侧栏项目库树

Hub SHALL 在左侧导航为“项目库”提供独立的进入动作和展开动作；展开后显示项目节点，项目节点展开后显示该项目已发现的 Wiki 实例。树中的项目和 Wiki SHALL 使用稳定身份定位，并清楚展示当前项目与当前 Wiki。

#### Scenario: 展开项目树
- **WHEN** 用户展开侧栏项目库，再展开一个有多份 Wiki 的项目
- **THEN** 树中显示该项目及每份 Wiki 的相对目录、Provider、可读状态；点击项目进入概览，点击 Wiki 进入对应 Reader

#### Scenario: 空和不可用状态
- **WHEN** 项目尚无 Wiki、目录不可访问、扫描进行中或扫描失败
- **THEN** 对应项目节点显示明确的空、加载或错误状态及可用的重试/重新定位入口，其他项目节点仍可使用

#### Scenario: 侧栏收起和返回
- **WHEN** 用户收起并再次展开全局侧栏，或在项目库与其他视图之间切换
- **THEN** 项目/Wiki 树恢复合理的展开状态与当前选中项，项目库入口仍可直接打开列表

#### Scenario: 键盘操作树节点
- **WHEN** 用户仅使用键盘操作项目库树
- **THEN** 方向键可移动/展开/收起节点，Enter 或 Space 可激活项目或 Wiki，焦点和选中状态均可辨认

### Requirement: 项目内可切换多份 Wiki

项目 Wiki 页 SHALL 显示当前 Wiki 的相对目录和 Provider，并允许从同一项目的可用实例清单切换。每个 `projectId + wikiId` SHALL 独立保存最近页面、文章滚动位置和章节展开状态；切换实例不得丢弃未确认草稿。

#### Scenario: 两份同 Provider Wiki 往返
- **WHEN** 用户在根目录 OpenZread 阅读 A 页，在子目录 OpenZread 阅读 B 页，然后返回根目录实例
- **THEN** 两份实例分别恢复 A/B 页及阅读位置，不根据标题或 slug 自动对齐

#### Scenario: 带未确认变更切换
- **WHEN** 用户在当前 Wiki 有未确认草稿并选择另一个 Wiki 实例
- **THEN** Hub 启用既有离开保护，只有用户确认后才切换；留在当前实例时草稿仍在

#### Scenario: 目标页面消失
- **WHEN** 用户切换到某实例，但该实例上次阅读的页面已不存在
- **THEN** Hub 在该实例内提供概览或首个可读页面并提示旧页面失效，不跳到其他实例的同名页面
