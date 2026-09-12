## Context

Open Zread CLI 当前通过 tsup (esbuild) 打包为单个 ESM bundle (`dist/index.js`)，配合 `#!/usr/bin/env node` shebang 作为 npm 全局包分发。构建产物包含：
- `dist/index.js` — 主 bundle（~数 MB）
- `dist/tree-sitter.wasm`, `dist/yoga.wasm`, `dist/mappings.wasm` — 核心 WASM 文件
- `dist/browse/` — Vite 构建的前端 SPA

运行时，`wasm-loader.ts` 通过 `import.meta.url` → `__dirname` 向上搜索 `node_modules` 定位 `tree-sitter.wasm`；语言特定 WASM（如 `tree-sitter-typescript.wasm`）则从 CDN 下载缓存到 `~/.zread/parsers/`。`browse-server.ts` 使用 `__dirname + "browse"` 定位前端静态文件。

**关键约束**：
- 项目是 Bun monorepo，Bun 已是开发依赖
- `web-tree-sitter` 依赖 WASM，需在运行时加载
- ink 依赖 `yoga.wasm`（Yoga 布局引擎）
- 语言 WASM 共 7 个（~10MB+），建议运行时下载而非嵌入

## Goals / Non-Goals

**Goals:**
- 生成 Windows (x64)、macOS (arm64/x64)、Linux (x64) 独立可执行文件
- 用户无需安装 Node.js/Bun 即可直接运行
- 核心 WASM（tree-sitter.wasm, yoga.wasm, mappings.wasm）嵌入可执行文件
- browse/ 前端静态文件嵌入可执行文件
- npm 全局安装方式继续作为并行分发渠道
- CI/CD 自动化构建并发布到 GitHub Releases

**Non-Goals:**
- 不嵌入语言特定 WASM（tree-sitter-typescript.wasm 等），保持运行时下载策略
- 不替换现有的 tsup + npm publish 构建流程
- 不支持 Alpine Linux (musl) 目标
- 不实现自动更新机制

## Decisions

### Decision 1: 使用 Bun `--compile` 而非 Node.js SEA 或 pkg

**选择**: Bun `--compile`

**替代方案**:
- **Node.js SEA**: 需要 Node.js v25.7.0+ 才支持 ESM，用户基数小；WASM 需通过 `getRawAsset()` 手动提取
- **pkg (@yao-pkg/pkg)**: 不支持 WASM 嵌入；ink 的 top-level await 与 pkg 的 ESM 转换不兼容
- **nexe**: 停止维护，不支持 ESM/WASM

**理由**: Bun 原生支持 ESM + WASM 嵌入 + 静态文件嵌入，与项目已有 Bun 生态契合度最高。

### Decision 2: 资源定位采用运行时检测模式

**选择**: 在 `wasm-loader.ts` 和 `browse-server.ts` 中增加编译模式检测，通过 `Bun.embeddedFiles` API 或 `process.isBun` + 路径探测自动切换资源加载方式。

**替代方案**:
- 使用 tsup `define` 注入编译标志（类似现有 `IS_PACKAGED`）→ 需要维护两套构建入口
- 完全重写资源加载层 → 改动过大

**理由**: 运行时检测最简单，不破坏现有 npm 分发流程，也不需要维护独立的编译入口。

### Decision 3: 语言 WASM 保持运行时下载

**选择**: 语言特定 WASM（typescript/tsx/javascript/vue/go/python/csharp）继续从 CDN 下载到 `~/.zread/parsers/`。

**理由**: 7 个语言 WASM 约 10MB+，嵌入会使可执行文件体积过大。CDN 下载 + 本地缓存策略已在生产环境验证。

### Decision 4: 构建入口复用现有 tsup 产物

**选择**: 不直接用 Bun 编译源码，而是将 tsup 构建的 `dist/index.js` + WASM 文件 + browse/ 目录作为 Bun `--compile` 的输入。

**替代方案**:
- 从源码直接 `bun build --compile` → 需要处理 monorepo workspace 依赖、react/ink 的复杂打包
- 单独为编译模式创建入口文件 → 维护成本高

**理由**: tsup 已经处理了所有依赖打包（`noExternal: [/.*/]`）、WASM 复制、browse/ 嵌入。复用其产物避免重复解决打包问题。

## Risks / Trade-offs

- **[Bun 兼容性风险]** → Bun `--compile` 对某些 npm 包可能有兼容性问题（特别是使用了 Node.js 私有 API 的包）。缓解：构建后执行完整的冒烟测试。
- **[可执行文件体积]** → 包含 Bun 运行时 + 所有依赖，单个可执行文件预计 40-80MB。缓解：这是独立可执行文件的固有代价，用户换来了零依赖安装。
- **[跨平台构建限制]** → Bun `--compile` 理论上支持交叉编译，但某些平台可能需要在对应 OS 上构建。缓解：CI 矩阵在三个平台上分别构建。
- **[WASM 路径兼容]** → 编译后 `import.meta.url` 指向临时解压路径，可能与现有 `getTreeSitterDir()` 逻辑不兼容。缓解：资源解析层统一处理。
- **[bun 与 node 行为差异]** → 少量 Node.js API 在 Bun 中行为不同（如 `fs` 的边缘 case）。缓解：项目已使用 Bun 开发，核心功能已验证。

## Migration Plan

1. 先实现资源解析抽象层，确保 npm 模式不受影响
2. 添加构建脚本，在本地验证可执行文件生成
3. 本地三平台冒烟测试通过后，添加 CI 发布流程
4. GitHub Release 附加可执行文件，npm 发布保持不变
5. 在 README 中添加可执行文件下载说明

**回滚策略**: 所有变更通过运行时检测隔离，移除可执行文件构建相关代码即可完全回滚。
