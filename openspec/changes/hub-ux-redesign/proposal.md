## Why

Open Zread Hub 当前将项目库、运行诊断、任务和 Wiki Reader 依次堆叠在一个长页面中；进入项目、阅读与维护没有稳定的导航层级，项目卡操作过密，编辑表单还会推移正文。基于已评审的 [UX 改造方案](../../../docs/design/Hub_UX_Redesign_v0.1.md) 和三张设计图，需要把现有功能组织为清楚的首页、项目阅读工作区及变更审核流程。

## What Changes

- 建立 Windows 桌面应用壳层与独立视图：首页、项目库、跨项目搜索、任务、Provider、设置；项目有自己的概览、Wiki、关联源码查看、维护及项目设置入口。
- 首页优先展示最近项目、收藏、最近阅读和简要状态；项目卡以“打开项目”为主动作，将低频和危险操作移至相应菜单或设置页。
- 将 Reader 从首页长页面移入项目工作区；保留 OpenZread/Zread 独立的章节和滚动位置，提供章节树、文章、引用源码、项目内搜索及按需打开的上下文面板。
- 将手写编辑、AI 改写、新增主题及 ChangeSet 审核整理为草稿、预览、确认写回的清晰步骤；写回仍使用现有 Provider 原始文件与冲突/历史保护机制。
- 统一桌面视觉 token、图标、文字层级、按钮优先级、窗口宽度适配、键盘与可访问性交互。设计图作为布局和风格参考，数据与文案由实际产品状态决定。
- 不引入在线仓库发现、云服务、完整 IDE 或新的生成能力；低层任务、Provider 与写入语义沿用现有功能需求。

## Capabilities

### New Capabilities

- `hub-app-navigation`: 全局桌面壳层、页面切换、返回状态、任务与 Provider 状态入口，以及窗口宽度和键盘可访问性。
- `hub-home-project-library`: 首页和项目库的最近/收藏/继续阅读呈现、项目主动作及低频操作收纳。
- `hub-project-wiki-workspace`: 独立项目工作区、双 Provider 阅读会话、章节树、搜索定位、源码引用与上下文面板。
- `hub-maintenance-review-ux`: 新增/编辑/AI/历史的界面流程与 ChangeSet 差异审核、写回结果和失败恢复交互。

### Modified Capabilities

（无。当前没有 `openspec/specs/` 下可修改的已发布 Hub UX capability；既有 `wiki-topic-management` 是 CLI 功能变更，本提案不改变其规范。）

## Impact

- 主要影响 `apps/hub/src/App.tsx`、`apps/hub/src/components/OpenZreadReader.tsx`、`apps/hub/src/app.css` 及相关前端组件与 UI 测试；可能需要保存导航/阅读偏好和可直达页面的状态接口。
- 复用现有 Hub application service、Tauri 命令、项目库、搜索、双 Provider Reader、任务、问答、ChangeSet、历史与原文件写回能力；若 UI 所需信息缺失，先核对现有契约，再做最小的契约扩展。
- 验收依据为 [首页](../../../docs/design/hub-home-ux-concept.png)、[项目阅读](../../../docs/design/hub-project-reader-ux-concept.png)、[ChangeSet 审核](../../../docs/design/hub-changeset-ux-concept.png) 三张概念图，以及本变更的行为规范；图片中的虚构数据不作为验收数据。
