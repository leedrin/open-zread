## ADDED Requirements

### Requirement: Runtime detection of execution mode

系统 SHALL 在运行时自动检测当前运行于 npm 全局安装模式还是编译后的可执行文件模式，并据此选择资源加载策略。

#### Scenario: npm global install mode
- **WHEN** CLI 通过 `npm i -g @open-zread/cli` 安装并运行
- **THEN** 系统使用基于 `__dirname` 和 `node_modules` 搜索的文件路径定位资源

#### Scenario: Compiled executable mode
- **WHEN** CLI 作为独立可执行文件运行（`./open-zread`）
- **THEN** 系统使用 `Bun.embeddedFiles` API 或编译文件系统的路径定位嵌入资源

### Requirement: Core WASM resolution adapts to execution mode

核心 WASM 文件（`tree-sitter.wasm`, `yoga.wasm`, `mappings.wasm`）的定位逻辑 SHALL 根据执行模式自动适配：npm 模式从 `dist/` 目录读取，编译模式从嵌入资源读取。

#### Scenario: tree-sitter.wasm resolution in npm mode
- **WHEN** Parser 初始化且 CLI 运行于 npm 模式
- **THEN** `getTreeSitterDir()` 向上搜索 `node_modules` 定位 `tree-sitter.wasm`，与现有行为一致

#### Scenario: tree-sitter.wasm resolution in compiled mode
- **WHEN** Parser 初始化且 CLI 运行于编译模式
- **THEN** 系统从 Bun 编译嵌入的文件系统中定位 `tree-sitter.wasm`

#### Scenario: yoga.wasm resolution in compiled mode
- **WHEN** ink 渲染引擎初始化且 CLI 运行于编译模式
- **THEN** `yoga.wasm` 从嵌入资源加载，终端 UI 正常渲染

### Requirement: Browse frontend resolution adapts to execution mode

`browse-server.ts` 中前端静态文件的定位逻辑 SHALL 根据执行模式自动适配：npm 模式从 `dist/browse/` 目录读取，编译模式从嵌入资源读取。

#### Scenario: Frontend files in npm mode
- **WHEN** `open-zread browse` 运行于 npm 模式
- **THEN** Express 从 `path.resolve(__dirname, "browse")` 服务静态文件，与现有行为一致

#### Scenario: Frontend files in compiled mode
- **WHEN** `open-zread browse` 运行于编译模式
- **THEN** Express 从嵌入的前端资源服务静态文件

### Requirement: Backward compatibility with npm distribution

资源解析层的改造 SHALL NOT 影响现有 npm 全局安装的任何功能。所有现有测试在 npm 模式下 SHALL 继续通过。

#### Scenario: Existing npm workflow unchanged
- **WHEN** 通过 `npm i -g @open-zread/cli` 安装后运行 `open-zread`
- **THEN** Wiki 生成、Browse 浏览、Config 配置等所有功能行为与改造前完全一致
