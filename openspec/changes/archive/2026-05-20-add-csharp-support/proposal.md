## Why

Open Zread 当前支持 TypeScript/JavaScript/Go/Python 四种语言的 AST 解析，但 C# 作为企业级开发的主流语言（.NET 生态）尚未支持。Scanner 层已能识别 `.cs` 文件，但 Parser 层完全缺失，导致 C# 项目无法提取符号、生成 Repo Map 和 Wiki 文档。

## What Changes

- 新增 C# 语言的完整 AST 解析支持，覆盖 class、struct、interface、enum、record、delegate、method、constructor、property、event、indexer、operator 等全部声明类型
- 在 `language-map.ts` 中注册 `csharp` 语言映射
- 在 `constants.ts` 中添加 C# WASM 文件映射（使用已有 CDN `tree-sitter-wasms@0.1.13` 中的 `tree-sitter-c_sharp.wasm`）
- 在 `parser/index.ts` 中添加 C# 的 SCM query，支持完整符号提取

## Capabilities

### New Capabilities
- `csharp-parsing`: C# 语言的完整 AST 解析与符号提取，包括 using 导入、namespace 声明、6 种类型声明（class/struct/interface/enum/record/delegate）和 6 种成员声明（method/constructor/property/event/indexer/operator）的识别与签名提取

### Modified Capabilities

（无）

## Impact

- **代码影响**: `packages/repo-analyzer/src/parser/` 下 3 个文件（language-map.ts, constants.ts, index.ts）
- **依赖**: 无新增依赖，WASM 文件来自已有 CDN 源 `tree-sitter-wasms@0.1.13`
- **兼容性**: 纯增量改动，不影响现有语言支持
- **运行时**: C# WASM 文件约 3.79 MB，首次使用时自动下载到 `~/.zread/parsers/` 缓存
