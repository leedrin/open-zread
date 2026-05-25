# Proposal: P2 — 精细增量更新管道 + 交互式关系图 + 增量修补模式

## What

实现 nium-wiki 改进方案中的三个 P2 级改进：

1. **精细增量更新管道**（改进四）：基于 SHA256 文件哈希 diff → 依赖图 BFS 传播 → 源文件↔文档映射 → 文档间引用传播，输出精确的 `affectedDocs` 列表，避免每次全量重新生成。
2. **交互式关系图**（改进八）：从 `SymbolManifest.imports` + `source-files-index.json` 构建三类边（import / refers / links）的图数据，通过 browse 服务器新增 `/graph` 路由，渲染可交互的关系图。
3. **增量修补模式**（改进九）：在增量管道基础上，区分 `full`（签名变更）和 `incremental`（传递影响）两种更新强度，后者使用外科手术式修补 Prompt，只更新受影响段落。

## Why

- P0（Mermaid 质量体系、复杂度自适应目标、密钥脱敏）和 P1（Facts-First、溯源增强、质量审计、收尾管道）已全部落地。
- 当前 open-zread 每次运行都是全量生成，即使只改动 1 个文件也要重新生成所有文档，Token 和时间浪费严重。
- 没有可视化的代码/文档关系图，用户难以理解模块间的依赖。
- 这三项改进是 open-zread 从"能用"到"生产级"的关键一步。

## Non-goals

- 不做增量修补模式的自动测试（验证依赖人工审查生成结果）。
- 交互式关系图的第一版不做 Sigma.js，使用轻量 D3 force-layout，后续可升级。
- 不修改 Agent SDK 核心引擎，只修改 orchestrator 的管线编排。
- 不修改 CLI TUI 界面，增量更新通过现有 pipeline 自动触发。

## Scope

- `packages/types/`: 新增增量管道和图数据类型定义
- `packages/utils/src/cache/`: 新增增量更新管道核心模块
- `packages/utils/src/output/`: 新增图数据构建模块
- `packages/orchestrator/src/wiki/`: 修改生成管线支持增量模式
- `packages/orchestrator/src/prompts/`: 新增外科手术式修补 Prompt
- `apps/cli/src/commands/browse-server.ts`: 新增 `/graph` API 端点
- `apps/browse/`: 新增图可视化前端页面
