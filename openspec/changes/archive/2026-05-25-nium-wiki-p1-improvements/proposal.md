# Proposal: nium-wiki P1 改进集成

## 摘要

基于对 nium-wiki 的深度架构对比分析（见 `docs/nium-wiki-improvements.md`），在 P0 改进已落地的基础上，继续实施 P1 优先级的四个改进方向：

1. **Facts-First 事实前置提取** — 在 Page Agent 生成前预提取模块导出符号，注入权威数据源，杜绝 LLM 幻觉
2. **溯源增强** — 强化代码块溯源规则，要求每个代码块上方必须有可点击的溯源行
3. **文档质量审计层** — 新增质量审计模块，统计图表/示例/溯源完整性，按复杂度分级评分
4. **生成后收尾管道** — 在所有页面生成完成后执行链接修复、索引构建、侧边栏生成

## 动机

P0 改进解决了 Prompt 级别的指导缺失和密钥安全问题。P1 解决更深层的质量问题：

- LLM 幻觉：Page Agent 凭记忆生成 API 文档，签名与源码不一致
- 溯源不足：只有章节级溯源，代码块没有溯源，读者无法定位代码来源
- 无质量反馈：生成完文档就结束，没有质量报告
- 无收尾步骤：没有链接修复、索引构建等后处理

## 范围

- **包含**：PageFacts 类型 + module-facts 提取器、buildPagePrompt 注入 Facts、溯源 Prompt 增强、质量审计模块、收尾管道
- **不包含**：P2 改进项（精细增量更新、交互式关系图、增量修补模式）

## 来源

- 完整分析：`docs/nium-wiki-improvements.md` 改进三、五、二、十
- P0 基础：`openspec/changes/archive/2026-05-24-nium-wiki-p0-improvements/`
