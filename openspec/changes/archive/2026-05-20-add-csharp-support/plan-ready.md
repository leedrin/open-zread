# Implementation Plan: add-csharp-support

## Source
- Proposal: openspec/changes/add-csharp-support/proposal.md
- Design: openspec/changes/add-csharp-support/design.md
- Specs: openspec/changes/add-csharp-support/specs/csharp-parsing/spec.md
- Tasks: openspec/changes/add-csharp-support/tasks.md

## Execution Order

### Task 1: Register C# in language-map.ts
- Goal: 使 `isLanguageSupported('csharp')` 返回 true
- Source tasks: 1.1
- Design anchors: Decision 1 (使用现有 CDN 源)
- Changed files: `packages/repo-analyzer/src/parser/language-map.ts`
- Validation: `bun run typecheck` 通过；`isLanguageSupported('csharp')` === true
- Depends on: none
- Notes: 在 `LANGUAGE_TO_PARSER` 中添加 `csharp: 'csharp'`

### Task 2: Register C# WASM in constants.ts
- Goal: WASM 加载器能找到 C# 的 WASM 文件路径
- Source tasks: 1.2
- Design anchors: Decision 1 (CDN 文件名 tree-sitter-c_sharp.wasm，注意下划线)
- Changed files: `packages/repo-analyzer/src/parser/constants.ts`
- Validation: `bun run typecheck` 通过；`WASM_FILE_MAP['csharp']` === 'tree-sitter-c_sharp.wasm'
- Depends on: none
- Notes: WASM 文件名是 `tree-sitter-c_sharp.wasm`，不是 `tree-sitter-csharp.wasm`

### Task 3: Add C# SCM query
- Goal: C# 文件能通过 SCM query 提取所有声明类型的符号
- Source tasks: 2.1
- Design anchors: Decision 2 (覆盖 13 种声明类型), Decision 3 (复用通用提取逻辑)
- Changed files: `packages/repo-analyzer/src/parser/index.ts`
- Validation: `bun run typecheck` 通过
- Depends on: Task 1, Task 2
- Notes: SCM query 必须包含以下节点：using_directive, namespace_declaration, file_scoped_namespace_declaration, class_declaration, struct_declaration, interface_declaration, enum_declaration, record_declaration, delegate_declaration, method_declaration, constructor_declaration, property_declaration, event_declaration, indexer_declaration, operator_declaration。所有类型声明节点使用 `name` field (identifier)。

### Task 4: Handle C# capture names in extractWithQuery
- Goal: `extractWithQuery` 函数能正确处理 C# 特有的 capture 名称
- Source tasks: 2.2
- Design anchors: Decision 3 (不新增特殊处理逻辑)
- Changed files: `packages/repo-analyzer/src/parser/index.ts`
- Validation: `bun run typecheck` 通过；`bun run lint` 通过
- Depends on: Task 3
- Notes: C# 特有 capture 名称：@namespace, @struct, @record, @delegate, @prop, @event, @indexer, @operator, @ctor。这些应归入 functions 数组（带 name 和 signature）或 exports 数组（类型声明）。参考现有 Go/Python 的处理模式——类型声明作为 export 提取，方法/函数作为 function 提取。

### Task 5: Add C# parsing tests
- Goal: 验证 C# 符号提取的完整性和正确性
- Source tasks: 3.3
- Design anchors: specs/csharp-parsing/spec.md 中所有 scenario
- Changed files: `packages/repo-analyzer/src/parser/__tests__/csharp-parsing.test.ts`（新建）
- Validation: `bun test --filter @open-zread/repo-analyzer` 通过
- Depends on: Task 4
- Notes: 测试用例需覆盖：using 提取、block-scoped/file-scoped namespace、class/struct/interface/enum/record/declaration、method/constructor/property/event/indexer/operator 签名提取、expression-bodied 方法签名。

### Task 6: Final verification
- Goal: 确保所有代码质量检查通过
- Source tasks: 3.1, 3.2
- Design anchors: N/A
- Changed files: 无（仅验证）
- Validation: `bun run typecheck` && `bun run lint` 全部通过
- Depends on: Task 5
- Notes: 最终关卡，确认无类型错误和 lint 违规
