# Open Zread Hub 设计规范

> 版本：2.0
>
> 视觉基线：用户提供的 Open Zread Hub 桌面界面参考图。
>
> 适用范围：Tauri + React 桌面端的新功能、Hub 壳层、Project Library、Reader、Provider、编辑审阅和任务面板。终端 CLI 的 ANSI 主题可以单独适配，但不得反向改变桌面端 token。

## 1. 设计方向

Open Zread Hub 是本地优先的知识工作台，不是营销页面。界面应让用户快速看清“我在哪个 Project、当前使用哪个 Provider、哪些内容需要关注、下一步可以做什么”。视觉上采用轻量、明亮、可信赖的工作区风格：浅蓝环境背景承托白色内容表面，绿色作为品牌和主要行动色，蓝色用于信息和链接，其他颜色只表达状态或 Provider 类型。

参考图是比例、层级、密度和气质的基准，不要求逐像素复制。所有新界面都必须优先满足以下顺序：

1. 信息层级和操作结果清晰。
2. 键盘、对比度和 Windows 桌面可用性可靠。
3. 颜色、圆角、间距、阴影和图标风格统一。

不得继续使用“Notion 风格”作为桌面端默认设计描述。旧页面可以保留兼容样式，修改旧页面时应逐步迁移到本规范的 token。

## 2. 基础视觉语言

### 2.1 关键词

- 清爽的冷白工作区，而不是米黄色纸张质感。
- 柔和的蓝色环境背景，而不是纯色大面积白底。
- 绿色品牌识别和成功反馈，而不是蓝色作为唯一 CTA。
- 细边框、低对比阴影和 8/12px 圆角，避免厚重面板。
- 信息密度高但留白稳定，适合长时间阅读和维护。

### 2.2 颜色 token

颜色必须通过 CSS 自定义属性或主题对象引用。组件中不得随意写新的近似色。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ui-canvas` | `#f2f7fc` | 应用画布、主窗口背景 |
| `--ui-canvas-deep` | `#eaf2fb` | 背景渐变较深端、分组区域 |
| `--ui-surface` | `#ffffff` | 卡片、侧栏、输入框、抽屉 |
| `--ui-surface-subtle` | `#f7faff` | 次级卡片、表格行、预览区域 |
| `--ui-border` | `#e1eaf3` | 默认边框和分割线 |
| `--ui-border-strong` | `#cbd9e8` | hover、选中和需要强调的边框 |
| `--ui-ink` | `#172033` | 标题、正文、主要图标 |
| `--ui-ink-secondary` | `#64748b` | 描述、辅助信息、未选中导航 |
| `--ui-ink-muted` | `#94a3b8` | 占位符、时间、禁用文本 |
| `--ui-brand` | `#16b884` | 品牌图标、主要 CTA、活动导航 |
| `--ui-brand-strong` | `#0f9f72` | CTA hover/active、强调文字 |
| `--ui-brand-soft` | `#e1f7ef` | 活动导航背景、成功浅底 |
| `--ui-info` | `#3b82f6` | 信息、链接、Zread 标识 |
| `--ui-info-soft` | `#e8f2ff` | 信息标签、选中浅底 |
| `--ui-purple` | `#7967e8` | AI、辅助 Provider 或高级能力 |
| `--ui-purple-soft` | `#f0edff` | AI 标签背景 |
| `--ui-warning` | `#d89018` | 待处理、过期、注意 |
| `--ui-warning-soft` | `#fff3d8` | 警告标签背景 |
| `--ui-danger` | `#d95f6d` | 错误、删除、冲突 |
| `--ui-danger-soft` | `#ffebee` | 错误标签和危险操作 hover |
| `--ui-provider-openzread` | `#18b883` | OpenZread Provider |
| `--ui-provider-zread` | `#3182e6` | Zread Provider |
| `--ui-provider-managed` | `#ed9b20` | Managed Provider |

颜色语义要求：

- 绿色 CTA 表示“执行主要动作”，绿色状态表示成功；两者都必须有文字或图标辅助，不能只靠色块传达含义。
- 蓝色用于信息、链接和 Zread，不作为所有按钮的默认颜色。
- 紫色用于 AI，不用于普通成功状态。
- 红色只用于危险、错误和冲突，不用于普通未选中状态。
- 文字颜色优先使用 `--ui-ink-secondary` 以上级别；`--ui-ink-muted` 只用于辅助信息。

### 2.3 背景和层级

应用根背景使用浅蓝渐变，避免依赖网络图片，确保离线时视觉稳定：

```css
background: linear-gradient(135deg, #edf5fd 0%, #f8fbff 58%, #eaf2fb 100%);
```

标准层级如下：

| 层级 | 表面 | 边框/阴影 | 用途 |
| --- | --- | --- | --- |
| Canvas | `--ui-canvas` | 无 | 窗口底层 |
| Surface | `--ui-surface` | `1px solid var(--ui-border)` | 侧栏、普通卡片 |
| Raised | `--ui-surface` | `1px solid var(--ui-border)` + `0 8px 24px rgba(35, 85, 135, .07)` | 活动卡片、下拉菜单 |
| Overlay | `--ui-surface` | `0 18px 48px rgba(25, 61, 101, .16)` | 抽屉、弹窗、ChangeSet 面板 |

阴影应偏蓝灰、低透明度、无硬边。禁止大面积玻璃拟态、强烈发光、纯黑阴影和厚重描边。

## 3. 字体和排版

桌面端优先使用本地字体，不依赖 Google Fonts 或其他网络字体。推荐字体栈：

```css
font-family: Inter, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
```

`Inter` 负责拉丁字符和数字；Windows 中文环境使用 `Microsoft YaHei UI`；其他系统使用 `PingFang SC` 或系统 sans-serif。正文不使用衬线体、等宽体或全大写字母作为主要阅读字体。

| 角色 | 尺寸 | 字重 | 行高 | 用途 |
| --- | ---: | ---: | ---: | --- |
| Window title | 20px | 700 | 1.25 | 欢迎语、页面主标题 |
| Page heading | 24–30px | 700 | 1.25 | 页面和 Reader 标题 |
| Section heading | 16–18px | 700 | 1.35 | Project Library、Provider 区块 |
| Card title | 14–16px | 600 | 1.4 | 项目名、页面名、任务名 |
| Body | 14px | 400 | 1.55 | 描述、正文辅助内容 |
| Navigation / button | 13–14px | 500–600 | 1.4 | 导航、按钮、Tabs |
| Caption | 12px | 400–500 | 1.4 | 时间、路径、状态依据 |
| Badge | 11–12px | 600 | 1.3 | Provider、状态、分类标签 |

排版规则：

- 主要标题使用 `--ui-ink`，不使用纯黑。
- 标题只做轻微负字距，建议 `-0.015em`；正文和中文不强行压缩字距。
- 数字、版本号、路径可使用 `font-variant-numeric: tabular-nums`；文件路径使用系统等宽字体作为局部样式。
- 中英文、数字和图标之间保留自然间距，不用连续空格模拟布局。
- 文本过长时优先省略并提供完整 tooltip 或详情，不让卡片横向溢出。

## 4. 布局和间距

### 4.1 工作区布局

Hub 桌面壳层采用“左侧导航 + 中央工作区 + 可选右侧上下文面板”：

```text
┌──────────────┬──────────────────────────────┬─────────────────┐
│ Workspace    │ Header / Project Library     │ ChangeSet / AI  │
│ navigation   │ Reader / main content        │ context panel   │
└──────────────┴──────────────────────────────┴─────────────────┘
```

- 左侧导航宽度：`224–248px`，固定在工作区内；底部放本地存储和用户状态。
- 中央工作区：`minmax(0, 1fr)`，默认最大内容宽度约 `1200px`，左右内边距 `24–32px`。
- 右侧上下文面板：默认 `360–440px`；关闭时中央工作区扩展，不保留空白占位。
- 顶部 Header 高度：`64–72px`；工具栏控件垂直居中。
- Project Library 卡片使用 3 列网格；窄窗口降为 2 列再降为 1 列。

### 4.2 间距和尺寸

以 4px 为最小单位，以 8px 为主要节奏：

| 名称 | 值 | 用途 |
| --- | ---: | --- |
| `space-1` | 4px | 图标与文字、微间隔 |
| `space-2` | 8px | 控件内部、列表行 |
| `space-3` | 12px | 标签组、卡片小间距 |
| `space-4` | 16px | 卡片内边距、控件组 |
| `space-5` | 20px | 卡片区块间距 |
| `space-6` | 24px | 页面内边距、主要分组 |
| `space-8` | 32px | 大分区、Reader 边距 |

通用圆角：按钮和输入框 `8px`，卡片 `12px`，抽屉和大面板 `16px`，状态标签 `999px`。不要在同一层级混用超过两种圆角。

## 5. 组件规范

### 5.1 品牌和导航

- 品牌图标使用 `32px` 方形容器、`8px` 圆角、绿色底；内部使用白色几何 Open Zread 标志。
- 左侧导航项高度 `40px`，圆角 `8px`，水平内边距 `12px`。
- 非活动项使用 `--ui-ink-secondary`；活动项使用 `--ui-brand-strong`，背景 `--ui-brand-soft`。
- 导航图标统一 18px，文字 14px/600；活动状态同时改变图标和文字颜色。
- 导航分组标题使用 11px/600 的 muted 文本，不使用装饰性大写字距。
- 左侧底部的本地存储、健康状态和用户信息使用独立的低对比区域，不能抢占主内容注意力。

### 5.2 按钮和图标按钮

主要按钮：

```css
min-height: 36px;
padding: 8px 14px;
border: 1px solid transparent;
border-radius: 8px;
background: var(--ui-brand);
color: #fff;
font-size: 14px;
font-weight: 600;
```

- hover 使用 `--ui-brand-strong`；active 可轻微下移 `1px`，禁止明显缩放跳动。
- 次要按钮为白底、`--ui-border-strong` 边框、`--ui-ink` 文字。
- 文字/ghost 按钮透明背景，hover 使用 `--ui-brand-soft`，不使用下划线作为唯一反馈。
- 危险按钮使用 `--ui-danger` 或危险浅底；删除必须有确认，并明确“只移除注册关系”还是会修改原文件。
- 图标按钮为 `32px` 或 `36px` 正方形，圆角 `8px`；必须有 `aria-label`，hover/focus 时提供 tooltip 或可见辅助文字。
- 同一操作区最多一个主要按钮；“新建项目”“应用更改”等不可与其他 CTA 争夺视觉权重。

### 5.3 图标

- 使用 SVG 线性图标，风格接近 Lucide：圆角线端、无渐变、无拟物阴影。
- 常规图标 16px，导航 18px，页面工具栏 18–20px，品牌图标单独遵循品牌尺寸。
- 默认线宽 `1.75–2px`；图标颜色继承文字语义，不在每个图标上随机使用彩色。
- 禁止用 emoji、Unicode 字符或不同来源的混合图标代替产品图标。
- 图标必须是辅助信息，按钮仍需有可访问名称；无法理解的图标操作要配文字。

### 5.4 卡片、标签和状态

- 卡片：白底、`1px solid var(--ui-border)`、`12px` 圆角、`16px` 内边距。
- 活动/焦点卡片使用绿色或蓝色细边框，不使用粗边框填充。
- Project 卡片的顺序应为：名称/收藏 → 类型和 Provider 标签 → 描述/路径 → 最近访问和状态 → 操作。
- Provider 标签使用胶囊形浅底：OpenZread 绿色、Zread 蓝色、Managed 橙色、AI 紫色。
- 状态标签必须同时显示文本；`available/healthy` 用绿色，`missing/outdated` 用橙色，`error/conflicted/permission_denied` 用红色，未知或检测中用灰色。
- 列表和卡片中的统计数字采用 tabular numerals，次级数据不得比标题更醒目。

### 5.5 输入、搜索和 Tabs

- 输入框高度 `36–40px`，白底，`1px solid var(--ui-border)`，圆角 `8px`，左右内边距 `12px`。
- 搜索框左侧放 16px 搜索 SVG，placeholder 使用 `--ui-ink-muted`；支持 `Ctrl/Cmd + K` 时在右侧显示轻量快捷键提示。
- focus 使用 `2px` `rgba(59, 130, 246, .28)` 外环，并保留边框变化；不能只依赖颜色变化。
- Tabs 高度 `32–36px`；活动 Tab 为白底、轻阴影或品牌色文字，未选中 Tab 使用 secondary 文本。
- 下拉菜单和筛选器使用白色 Raised 表面，选中行使用 `--ui-info-soft` 或 `--ui-brand-soft`。

### 5.6 Reader、编辑和右侧面板

- Reader 正文表面优先白底，正文行高 `1.65–1.8`，标题层级清楚，避免卡片边框包围每一段文字。
- 页面信息、相关页面、Provider 切换属于辅助上下文，可放在右侧面板或次级卡片。
- AI/ChangeSet 面板采用白色 Overlay，从右侧展开；顶部必须有标题、关闭按钮和当前 Project/Wiki 上下文。
- ChangeSet 使用分组列表：变更类型、目标页面、增删统计和审阅状态分层显示；“预览”“对比”“原文”使用 Tabs，不用大块装饰色。
- 应用按钮使用绿色主要按钮；取消、拒绝、关闭使用次要/ghost；冲突和不可应用状态使用红色或橙色提示并说明原因。
- 面板打开时不应覆盖用户正在编辑的正文；窄窗口可以转为模态抽屉，但必须保留关闭和返回路径。

## 6. 动效、交互和状态

- hover/focus/展开等短交互使用 `120–180ms` ease-out；面板进入使用 `180–240ms`。
- 动效只表达状态变化，不用于装饰性漂浮或持续发光。
- 支持 `prefers-reduced-motion: reduce`，关闭位移、缩放和非必要动画。
- loading 使用骨架、spinner 或明确的阶段文案；不可计算进度时不显示虚假百分比。
- 操作成功显示短暂 status message；错误必须说明原因、影响和可执行恢复动作。
- 禁用控件要降低对比度并说明原因，不能只设置 `opacity` 后让用户猜测。

## 7. Windows 桌面和响应式要求

- Windows 是首要运行环境；默认不依赖网络字体、远程图片或浏览器特有 API。
- 最小可用宽度按 `1024px` 设计；常用窗口宽度按 `1280–1440px` 校准。
- `1100px` 以下：右侧上下文面板变为抽屉，中央内容保留最小可读宽度。
- `900px` 以下：左侧导航收缩为图标栏或可展开导航；卡片降为单列。
- 所有可点击目标最小 `32px`，主要按钮和触摸场景优先 `36–40px`。
- 窗口缩放时禁止横向溢出；路径、标题和标签必须有省略或换行策略。

## 8. 无障碍和安全表达

- 正文与背景达到 WCAG AA；主要文字目标为至少 `4.5:1`，大标题目标为至少 `3:1`。
- 键盘焦点必须始终可见；Tab 顺序跟随视觉顺序，抽屉打开后焦点进入面板并可用 Escape 关闭。
- 颜色不是唯一状态信号；状态至少同时使用文字、图标或结构差异。
- 路径、Provider、Wiki 和变更集上下文应在危险操作前再次显示，避免用户误操作其他 Project。
- UI 日志和诊断信息不得展示 Token、API Key 或正文内容；路径只在用户主动查看或操作时展示。

## 9. React/Tauri 实现边界

桌面 UI 以以下模块作为可替换的深模块，保持视觉和行为的局部性：

- `HubShell`：窗口级布局、导航折叠、右侧面板开关。
- `WorkspaceHeader`：Project/Wiki 上下文、搜索和全局操作。
- `ProjectLibrary`：筛选、收藏、最近访问、状态和项目操作。
- `ReaderPane`：目录、正文、Provider 切换和阅读位置。
- `ChangeSetPanel`：预览、对比、审阅和应用状态。
- `StatusBadge`、`IconButton`、`ProviderChip`、`SurfaceCard`：跨页面的基础视觉接口。

React 模块只通过 typed application-service 接口请求项目、Wiki、任务和文件操作；不得在展示组件中直接访问文件系统、启动进程或修改原生 Wiki。Tauri command 是原生能力的适配器，返回可渲染的状态和错误，不把平台路径细节扩散到多个组件。

实现 token 时使用与本文件一致的 `--ui-*` 命名。旧的 `--color-notion-*` 变量只作为迁移期间的兼容别名，新代码不得新增依赖。

## 10. 交付前视觉检查

- [ ] 在 Windows 1280px 和 1440px 宽度检查三栏布局、卡片网格和右侧面板。
- [ ] 检查所有按钮的默认、hover、active、focus、disabled 和错误状态。
- [ ] 检查中文、英文、长项目名、长路径和窄窗口换行/省略。
- [ ] 检查图标尺寸、线宽、语义和 `aria-label`，确认没有 emoji 代替图标。
- [ ] 检查绿色/蓝色/橙色/红色状态均有文本，不依赖颜色单独识别。
- [ ] 检查离线启动不依赖远程字体和图片。
- [ ] 检查涉及原文件的操作明确显示 Project、Wiki、目标页面和写回范围。
