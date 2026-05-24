## 1. Parser Registration

- [x] 1.1 在 `packages/repo-analyzer/src/parser/language-map.ts` 的 `LANGUAGE_TO_PARSER` 中添加 `csharp: 'csharp'` 条目
- [x] 1.2 在 `packages/repo-analyzer/src/parser/constants.ts` 的 `WASM_FILE_MAP` 中添加 `csharp: 'tree-sitter-c_sharp.wasm'` 条目

## 2. SCM Query & Symbol Extraction

- [x] 2.1 在 `packages/repo-analyzer/src/parser/index.ts` 的 `SCM_QUERIES` 中添加 C# 完整查询，覆盖 using_directive（import）、namespace_declaration、file_scoped_namespace_declaration（namespace）、class_declaration、struct_declaration、interface_declaration、enum_declaration、record_declaration、delegate_declaration（类型声明）、method_declaration、constructor_declaration、property_declaration、event_declaration、indexer_declaration、operator_declaration（成员声明）
- [x] 2.2 在 `extractWithQuery` 函数中添加 C# 特有捕获名称的处理逻辑（@namespace、@struct、@record、@delegate、@prop、@event、@indexer、@operator、@ctor）

## 3. Verification

- [x] 3.1 运行 `bun run typecheck` 确保类型检查通过
- [x] 3.2 运行 `bun run lint` 确保代码规范检查通过
- [x] 3.3 编写或补充 C# 相关单元测试，验证 SCM query 对 C# 代码的符号提取正确性
