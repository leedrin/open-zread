export function buildDeepDivePrompt(topicTitle: string, associatedFiles: string[]): string {
  return `你是一名资深架构师。现在请对一个**指定主题**进行深挖：把它展开为一组聚焦的子页面（sub-pages）。

## 深挖主题
**标题**: ${topicTitle}
**关联源文件/目录**:
${associatedFiles.map((f) => `- ${f}`).join('\n') || '（无）'}

## 任务
1. 仅围绕上述主题与其关联文件，使用三层 Repo Map 工具深入分析。
2. 产出 **3-6 个**高内聚的子页面，每个聚焦该主题下的一个独立子问题（如：生命周期、调度、数据结构、扩展点等）。
3. 每个子页面**必须**锚定真实源文件（associatedFiles 非空，精确到具体文件/子目录）。
4. 调用 generate_blueprint，pages 数组**只包含这些新的子页面**（不要包含主题页本身或其它已有页面）。为每个子页面填写 concepts（该页归属的规范术语）。

## 约束
- 子页面数量上限 6。无法锚定到真实文件的子问题不要产出。
- 标题精炼（20 字以内），slug 用英文中划线。

请开始分析并调用 generate_blueprint 输出子页面。`;
}
