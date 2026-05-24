## 1. 资源解析抽象层

- [ ] 1.1 在 `packages/repo-analyzer/src/parser/wasm-loader.ts` 中添加执行模式检测函数 `isCompiledMode()`，通过 `process.isBun` + 检测 `Bun.embeddedFiles` 是否包含目标 WASM 文件来判断
- [ ] 1.2 改造 `getTreeSitterDir()` 函数：编译模式下从 `Bun.embeddedFiles` 查找 `tree-sitter.wasm` 并返回对应路径；npm 模式保持现有 `node_modules` 向上搜索逻辑不变
- [ ] 1.3 改造 `apps/cli/src/commands/browse-server.ts` 中 `webDistPath` 的定位逻辑：编译模式下使用 `Bun.embeddedFiles` API 或编译后文件系统路径定位 `browse/` 目录；npm 模式保持 `__dirname + "browse"` 不变
- [ ] 1.4 确保改造后运行 `bun run typecheck` 和 `bun run lint` 通过

## 2. 构建脚本

- [ ] 2.1 创建 `scripts/build-exe.ts`，接受 `--target` 参数（`bun-windows-x64` / `bun-darwin-arm64` / `bun-darwin-x64` / `bun-linux-x64`）和 `--all` 标志
- [ ] 2.2 构建脚本先调用 `turbo build` 确保 tsup 产物最新（或接受 `--skip-build` 跳过）
- [ ] 2.3 构建脚本使用 `Bun.build({ entrypoints: ['apps/cli/dist/index.js'], compile: true, target, outdir })` 生成可执行文件，并配置 `--define` 注入版本号
- [ ] 2.4 构建脚本将核心 WASM 文件（`tree-sitter.wasm`, `yoga.wasm`, `mappings.wasm`）和 `browse/` 前端文件作为 `Bun.build` 的附加资源嵌入
- [ ] 2.5 在根 `package.json` 中添加 `"build:exe"` 脚本指向 `scripts/build-exe.ts`

## 3. 本地验证

- [ ] 3.1 在 Windows 上本地执行 `bun run build:exe --target=bun-windows-x64` 并验证生成的 `.exe` 可正常运行
- [ ] 3.2 验证 `open-zread.exe` 的 `--version` 输出正确版本号
- [ ] 3.3 验证 Wiki 生成功能在可执行文件模式下正常工作（包括文件扫描、AST 解析、Agent 调度）
- [ ] 3.4 验证 `open-zread.exe browse` 命令可正常启动 Web 服务器并在浏览器中显示 Wiki
- [ ] 3.5 验证 npm 模式（`bun run dev` / 全局安装）功能未受影响

## 4. CI/CD 发布流程

- [ ] 4.1 创建 `.github/workflows/release-exe.yml`，在 `release.yml` 的 changeset 发布成功后触发，或合并到 release-exe 流程中
- [ ] 4.2 CI 矩阵：`windows-latest` (x64)、`macos-latest` (arm64)、`ubuntu-latest` (x64) 三个平台并行构建
- [ ] 4.3 每个平台构建对应的可执行文件，命名格式 `open-zread-{platform}-{arch}[.exe]`
- [ ] 4.4 将所有可执行文件附加到 changeset 创建的 GitHub Release
- [ ] 4.5 在 README 中添加「直接下载」章节，包含各平台可执行文件的下载链接和使用说明
