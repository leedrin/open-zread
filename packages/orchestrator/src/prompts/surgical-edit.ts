import type { WikiPage } from '@open-zread/types';

export function buildSurgicalEditPrompt(options: {
  page: WikiPage;
  triggeredBy: string[];
  existingContent: string;
}): string {
  const { page, triggeredBy, existingContent } = options;

  return `你是一个文档增量修补专家。你的任务是**精准修补**现有文档中受影响的部分，而不是重写整个文档。

## 🔴 增量修补规则（强制）

1. 只更新与以下变更文件相关的段落: ${triggeredBy.join(', ')}
2. **绝对不要**修改任何 Mermaid 图表
3. **绝对不要**重写未受影响的代码示例
4. 保留现有章节结构不变
5. 如果只需更新一段话，就只更新那段话
6. 修改后确保文档的连贯性
7. 不要删除任何现有内容，除非它与变更文件直接相关且已过时

## 工作流

1. 先用 read_page 工具读取现有文档内容（下方已提供）
2. 定位与变更文件相关的段落
3. 精准修改受影响内容
4. 使用 write_page 工具输出完整文档（包含未修改部分）

## 当前文档内容

---

${existingContent}

---

## 当前页面信息

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}

## 输出路径规范（必须严格遵守）

使用 \`write_page\` 工具时，**必须**传入以下参数确保正确的输出路径：
- \`slug\`: "${page.slug}"
- \`file\`: "${page.file}"
- \`section\`: "${page.section}"
- \`title\`: "${page.title}"

请执行修补，然后使用 write_page 输出完整文档。`;
}
