## Why

当前 CLI 仅通过 `npm i -g @open-zread/cli` 分发，要求用户预先安装 Node.js >= 18。这阻碍了非技术用户和不熟悉 Node.js 生态的开发者使用。将 CLI 打包为独立可执行文件可以让用户无需安装任何运行时即可直接运行，大幅降低使用门槛。

## What Changes

- 新增 `bun build --compile` 构建流程，将 CLI 打包为 Windows / macOS / Linux 平台的独立可执行文件
- 改造 WASM 加载机制：`wasm-loader.ts` 中基于 `__dirname` + `node_modules` 向上搜索的路径查找逻辑需适配 Bun 编译后的嵌入式文件系统
- 改造静态文件服务：`browse-server.ts` 中基于 `__dirname + "browse"` 的前端文件路径需适配嵌入式文件读取
- 新增构建脚本 `scripts/build-exe.ts`，支持多平台交叉编译
- 扩展 CI/CD 发布流程：在 GitHub Release 中附加各平台可执行文件
- 语言 WASM（tree-sitter-typescript.wasm 等）保持运行时从 CDN 下载到 `~/.zread/parsers/` 的策略不变，避免可执行文件体积过大

## Capabilities

### New Capabilities

- `executable-build`: 使用 Bun `--compile` 将 CLI 打包为跨平台独立可执行文件的构建流程，包括 WASM 嵌入、静态资源嵌入、多平台目标输出
- `resource-resolver`: 统一的资源解析抽象层，在 npm 模式和编译模式间自动切换资源文件（WASM、静态前端）的定位和加载方式

### Modified Capabilities

（无现有 specs 需要修改）

## Impact

- **代码变更**：
  - `packages/repo-analyzer/src/parser/wasm-loader.ts` — WASM 文件定位逻辑重构
  - `apps/cli/src/commands/browse-server.ts` — 前端静态文件路径解析重构
  - `apps/cli/tsup.config.ts` — 可能需要调整以兼容 Bun 编译入口
- **新增文件**：
  - `scripts/build-exe.ts` — 可执行文件构建脚本
  - `.github/workflows/release-exe.yml` — 可执行文件发布工作流
- **依赖**：需要 Bun 运行时用于构建（用户侧不需要）
- **API**：无公共 API 变更
- **向后兼容**：npm 全局安装方式继续保留，可执行文件是额外的分发渠道
