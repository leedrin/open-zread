import type { WikiPage, PageFacts, GlossaryTerm } from '@open-zread/types';
import { buildGlossarySection } from './generate-wiki.js';
import ReferencePagePrompt from '../prompts/reference-page.js';

function formatDoc(doc: string): string {
  const lines = doc.split('\n');
  if (lines.length <= 1) return doc;
  return lines.join('\n              ');
}

export function buildReferenceSkeleton(facts: PageFacts): string {
  if (!facts.exports || facts.exports.length === 0) {
    return '';
  }

  const header = '| API | 签名 | 说明 | 源 |';
  const separator = '|-----|------|------|---|';
  const rows = facts.exports.map(e => {
    const desc = e.doc ? formatDoc(e.doc) : '';
    const source = e.line ? `${e.file}#L${e.line}` : e.file;
    return `| \`${e.name}\` | \`${e.signature}\` | ${desc} | [${e.file}](${source}) |`;
  });

  return `${header}\n${separator}\n${rows.join('\n')}`;
}

export function buildReferencePrompt(page: WikiPage, facts: PageFacts, glossary?: GlossaryTerm[]): string {
  const glossarySection = buildGlossarySection(glossary ?? []);
  const skeleton = buildReferenceSkeleton(facts);

  const factsSection = facts.fileSummaries && facts.fileSummaries.length > 0
    ? `
**关联文件摘要**:
${facts.fileSummaries.map(f => `- ${f.file} (${f.symbolCount} 个符号, 导出: [${f.exports.slice(0, 5).join(', ')}${f.exports.length > 5 ? '...' : ''}])`).join('\n')}
`
    : '';

  const skeletonSection = skeleton
    ? `
---

## 🔴 API 骨架（Facts 权威数据源 — 禁止增删）

以下是该项目模块的完整 API 列表，由代码分析自动提取。你**必须**保持此表格中的每一个 API 条目都出现在最终文档中，且**不得添加**此表格中不存在的 API。

${skeleton}

`
    : '';

  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';

  return `${ReferencePagePrompt}
${glossarySection}${factsSection}${skeletonSection}
---

## 当前页面任务

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}
**文档类型**: reference

**关联路径**:
${associatedFilesList}

---

## 输出路径规范（必须严格遵守）

使用 \`write_page\` 工具时，**必须**传入以下参数确保正确的输出路径：
- \`slug\`: "${page.slug}"
- \`file\`: "${page.file}"
- \`section\`: "${page.section}"
- \`title\`: "${page.title}"

输出文件将写入: \`.open-zread/wiki/${page.section}/${page.file}\`

请按照 Reference 文档规范执行，最后使用 write_page 输出文档。`;
}
