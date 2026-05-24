## ADDED Requirements

### Requirement: Build script produces platform-specific executables

系统 SHALL 提供 `scripts/build-exe.ts` 构建脚本，接受 `--target` 参数指定目标平台（`bun-windows-x64`, `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`），输出对应的独立可执行文件。

#### Scenario: Build Windows executable
- **WHEN** 运行 `bun run scripts/build-exe.ts --target=bun-windows-x64`
- **THEN** 在 `dist/exe/` 目录生成 `open-zread-windows-x64.exe` 文件

#### Scenario: Build macOS ARM executable
- **WHEN** 运行 `bun run scripts/build-exe.ts --target=bun-darwin-arm64`
- **THEN** 在 `dist/exe/` 目录生成 `open-zread-darwin-arm64` 文件

#### Scenario: Build all platforms
- **WHEN** 运行 `bun run scripts/build-exe.ts --all`
- **THEN** 在 `dist/exe/` 目录生成所有支持平台的可执行文件

### Requirement: Executables embed core WASM files

构建的可执行文件 SHALL 嵌入 `tree-sitter.wasm`、`yoga.wasm`、`mappings.wasm` 三个核心 WASM 文件，运行时无需外部文件。

#### Scenario: Tree-sitter WASM loads from embedded storage
- **WHEN** 可执行文件启动并初始化 Parser
- **THEN** `tree-sitter.wasm` 从嵌入资源中加载，不依赖外部文件

#### Scenario: Yoga WASM loads from embedded storage
- **WHEN** 可执行文件启动并渲染 ink UI
- **THEN** `yoga.wasm` 从嵌入资源中加载，终端 UI 正常显示

### Requirement: Executables embed browse frontend

构建的可执行文件 SHALL 嵌入 `browse/` 前端静态文件（HTML/JS/CSS），`open-zread browse` 命令在可执行文件模式下正常工作。

#### Scenario: Browse command serves embedded frontend
- **WHEN** 用户运行 `./open-zread browse`
- **THEN** 系统启动 Express 服务器，从嵌入的前端文件服务页面，浏览器可正常访问 Wiki

### Requirement: Language WASM files remain runtime-downloaded

语言特定 WASM 文件（typescript, tsx, javascript, vue, go, python, csharp）SHALL NOT 嵌入可执行文件，保持运行时从 CDN 下载到 `~/.zread/parsers/` 的行为不变。

#### Scenario: First-time language parsing downloads WASM
- **WHEN** 用户首次解析 TypeScript 项目
- **THEN** 系统从 `https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm` 下载并缓存到 `~/.zread/parsers/`

#### Scenario: Subsequent parsing uses cache
- **WHEN** 用户再次解析 TypeScript 项目，且缓存已存在
- **THEN** 系统直接使用 `~/.zread/parsers/tree-sitter-typescript.wasm` 缓存

### Requirement: Executable version matches package version

可执行文件 SHALL 在 `--version` 标志中显示与 `package.json` 一致的版本号。

#### Scenario: Version flag shows correct version
- **WHEN** 用户运行 `./open-zread --version`
- **THEN** 输出与 `package.json` 中 `version` 字段一致的版本号

### Requirement: CI publishes executables to GitHub Releases

CI/CD 工作流 SHALL 在发布时为每个支持平台构建可执行文件，并附加到对应的 GitHub Release。

#### Scenario: Release publishes executables for all platforms
- **WHEN** Changeset 触发版本发布
- **THEN** GitHub Release 包含 `open-zread-windows-x64.exe`、`open-zread-darwin-arm64`、`open-zread-darwin-x64`、`open-zread-linux-x64` 四个可执行文件附件
