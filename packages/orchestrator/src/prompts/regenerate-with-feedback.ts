import type { WikiPage, PageFacts } from '@open-zread/types';
import type { DocMetrics } from '@open-zread/utils';
import { buildPagePrompt } from '../wiki/generate-wiki.js';export function buildRegeneratePrompt(
  page: WikiPage,
  metrics: DocMetrics,
  facts?: PageFacts,
): string {
  const feedbackLines: string[] = [];

  feedbackLines.push('## ⚠️ 上一次生成评分为 basic，请针对性补全：');
  feedbackLines.push('');

  const targets = getQualityTargets(page);

  if (metrics.diagramCount < targets.minDiagrams) {
    feedbackLines.push(`- [缺图] 当前 ${metrics.diagramCount} 个 Mermaid 图，要求 ≥ ${targets.minDiagrams} 个`);
  }

  if (metrics.codeBlockSourceLinks < metrics.codeBlockCount) {
    feedbackLines.push(`- [缺溯源] ${metrics.codeBlockCount} 个代码块中 ${metrics.codeBlockSourceLinks} 个有 [Source:] 溯源行`);
  }

  const targetLines = page.level === 'Advanced' || (page.associatedFiles?.length ?? 0) >= 5
    ? 400
    : page.level === 'Beginner' && (page.associatedFiles?.length ?? 0) <= 2
      ? 80
      : 200;

  if (metrics.lineCount < targetLines) {
    feedbackLines.push(`- [行数不足] 当前 ${metrics.lineCount} 行，目标 ≥ ${targetLines} 行`);
  }

  if (metrics.uncoveredExports.length > 0) {
    feedbackLines.push(`- [未覆盖 API] 以下 Facts 中的导出未被文档提及，请补充说明：`);
    feedbackLines.push(`  ${metrics.uncoveredExports.join(', ')}`);
  }

  const mermaidErrors = metrics.mermaidIssues.filter(i => i.severity === 'error');
  if (mermaidErrors.length > 0) {
    feedbackLines.push(`- [Mermaid 错误] ${mermaidErrors.length} 个语法错误需要修复`);
  }

  feedbackLines.push('');
  feedbackLines.push('请基于现有内容补全上述缺失，保持已正确的部分不变。');

  const basePrompt = buildPagePrompt(page, facts);

  return `${feedbackLines.join('\n')}

---

${basePrompt}`;
}

function getQualityTargets(page: WikiPage) {
  const fileCount = page.associatedFiles?.length ?? 0;

  if (page.level === 'Advanced' || fileCount >= 5) {
    return { minLines: 400, minDiagrams: 2, minDiagramTypes: 2, minExamples: 5 };
  }

  if (page.level === 'Beginner' && fileCount <= 2) {
    return { minLines: 80, minDiagrams: 1, minDiagramTypes: 1, minExamples: 1 };
  }

  return { minLines: 200, minDiagrams: 1, minDiagramTypes: 1, minExamples: 2 };
}
