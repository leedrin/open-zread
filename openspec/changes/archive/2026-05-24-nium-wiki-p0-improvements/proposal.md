# Proposal: nium-wiki P0 改进集成

## 摘要

基于对 nium-wiki 的深度架构对比分析（见 `docs/nium-wiki-improvements.md`），将 P0 优先级的三个改进方向落地到 open-zread：

1. **Mermaid 图质量体系** — 从「Agent 自由发挥」升级为「类型映射 + 语法校验 + 复杂度自适应」
2. **复杂度自适应质量目标** — 根据 wiki.json 的 `level` 字段动态调整文档深度要求
3. **密钥自动脱敏** — Prompt 约束 + 审计模块双重保障

## 动机

open-zread 当前生成的文档在以下方面明显落后于 nium-wiki：

- Mermaid 图无类型指导、无语法校验、无复杂度分组策略，生成质量不可控
- 所有模块使用相同 Prompt，简单模块过度生成、核心模块深度不足
- 代码示例中可能泄露 API Key / 密码 / Token

这三个改进总预估改动量 < 400 行，以 Prompt 增强为主，可立即提升生成质量。

## 范围

- **包含**：Page Agent Prompt 增强、新增 mermaid-validator 模块、新增 getQualityTargets 函数、新增密钥检测正则
- **不包含**：P1/P2 改进项（质量审计层、Facts-First、增量更新等）

## 来源

- 完整分析：`docs/nium-wiki-improvements.md`
- nium-wiki SKILL.md 参考：nium-wiki 项目的 Mermaid 规则、质量门禁、脱敏规则
