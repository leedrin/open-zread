import type { WikiPage, PageFacts, GlossaryTerm } from '@open-zread/types';
import { buildGlossarySection } from './generate-wiki.js';
import TutorialPagePrompt from '../prompts/tutorial-page.js';
import HowtoPagePrompt from '../prompts/howto-page.js';

function formatDoc(doc: string): string {
  const lines = doc.split('\n');
  if (lines.length <= 1) return doc;
  return lines.join('\n              ');
}

function buildFactsSection(facts?: PageFacts): string {
  if (!facts || !facts.exports || facts.exports.length === 0) return '';

  return `
---

## 🔴 Facts — 权威数据源

**导出符号** (共 ${facts.exports.length} 个):
${facts.exports.map(e => {
    const base = `- \`${e.signature}\` → ${e.file}${e.line ? `#L${e.line}` : ''}`;
    if (e.doc) return base + `\n  📝 作者注释：${formatDoc(e.doc)}`;
    return base;
  }).join('\n')}

**关联文件摘要**:
${facts.fileSummaries.map(f => `- ${f.file} (${f.symbolCount} 个符号, 导出: [${f.exports.slice(0, 5).join(', ')}${f.exports.length > 5 ? '...' : ''}])`).join('\n')}

`;
}

export function buildTutorialPrompt(page: WikiPage, facts?: PageFacts, glossary?: GlossaryTerm[]): string {
  const glossarySection = buildGlossarySection(glossary ?? []);
  const factsSection = buildFactsSection(facts);
  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';

  return `${TutorialPagePrompt}
${glossarySection}${factsSection}
---

## 当前页面任务

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}
**文档类型**: tutorial
**难度**: ${page.level}

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

请按照 Tutorial 文档规范执行，最后使用 write_page 输出文档。`;
}

export function buildHowToPrompt(page: WikiPage, facts?: PageFacts, glossary?: GlossaryTerm[]): string {
  const glossarySection = buildGlossarySection(glossary ?? []);
  const factsSection = buildFactsSection(facts);
  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';

  return `${HowtoPagePrompt}
${glossarySection}${factsSection}
---

## 当前页面任务

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}
**文档类型**: howto
**难度**: ${page.level}

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

请按照 How-to 文档规范执行，最后使用 write_page 输出文档。`;
}
