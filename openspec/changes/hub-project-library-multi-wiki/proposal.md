## Why

项目库卡片的更多菜单可能被相邻卡片盖住，项目名称不能直接修改，列表也缺少名称与添加日期排序。更重要的是，Hub 把一个项目固定视为根目录的 OpenZread 和 Zread 两份 Wiki，无法发现、切换和安全维护项目子目录中的独立 Wiki。

## What Changes

- 修复项目卡更多菜单的层叠、边界与键盘交互，确保菜单在项目库滚动和窗口缩放时完整可用。
- 点击项目卡名称即可重命名 Hub 中的项目显示名；新增按名称和添加日期排序，保留筛选与收藏功能。
- 导入项目时发现项目根目录及子目录中的 OpenZread/Zread Wiki，并提供重新扫描入口；每份 Wiki 有稳定身份、所属目录、Provider 和可读状态。
- 项目 Wiki 页允许在这些 Wiki 实例间切换；阅读位置、搜索结果、资源引用和维护/生成操作均绑定所选实例，避免跨目录读写。
- 左侧“项目库”导航可展开为项目树，项目节点可展开为其 Wiki 实例；树节点直达对应项目或 Wiki，并显示选中状态。

## Capabilities

### New Capabilities

- `hub-project-library-organization`: 项目卡菜单、显示名修改、名称及添加日期排序。
- `hub-multi-wiki-instances`: 项目内 Wiki 发现、实例身份、可读状态及实例范围内的阅读与操作。
- `hub-project-wiki-tree`: 左侧项目/Wiki 树及项目内实例切换、定位和会话恢复。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无已发布的 Hub capability；本变更需与进行中的 `hub-ux-redesign` 对齐，不在此处重复定义其旧要求。

## Impact

- Hub 项目注册表与 Tauri 项目发现、Reader、搜索、资源读取、维护、历史及任务命令需要扩展实例身份和作用目录；现有根目录双 Provider 数据应继续可用。
- `hub-contract`、application service、项目库/侧栏/Reader UI 和本地阅读偏好需要同步扩展；旧偏好与无添加时间的项目记录需要兼容。
- 发现过程仅访问用户注册项目下的本地目录，不依赖在线服务；Windows MSI 交付仍按项目既有打包流程验证。
