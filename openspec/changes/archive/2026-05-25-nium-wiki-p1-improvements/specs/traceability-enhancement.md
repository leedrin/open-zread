# Spec: 溯源增强

## 概述

强化 Page Agent 的溯源规则，要求每个代码块上方必须有可点击的溯源行。

## 需求

### TR-001: 代码块溯源规则

**Given** Page Agent 生成包含从源文件摘抄的代码块
**When** 输出代码块
**Then** 必须在 `` ``` `` 上方添加溯源行：

```markdown
[Source: foo.ts](/packages/core/src/foo.ts#L42-L67)
```typescript
const result = foo.bar();
```
```

### TR-002: 溯源行位置约束

**Given** 代码块需要溯源
**When** 添加溯源行
**Then**：
- 溯源行必须在代码块**外面**（纯文本格式，链接可点击）
- **禁止**在代码块内部用注释写溯源（如 `// Source: foo.ts`）
- 溯源行格式：`[Source: filename](relative-path#Lstart-Lend)`

### TR-003: 现有章节溯源保留

**Given** P0 已有的 `Sources: [file](path#L1-L50)` 规则
**When** 增强溯源
**Then** 不删除现有章节级溯源规则，代码块溯源是额外增加的强制要求
