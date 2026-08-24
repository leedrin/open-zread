/**
 * Section-level Page Regeneration
 *
 * "小节级重新生成"：读取已生成页面的旧正文全文，连同用户对某个小节的
 * 重写指令一起交给 Agent，要求它在自身上下文中拼接出替换目标小节后的
 * 完整新正文，仍然通过 write_page 整篇写回，以保留其内置的 Mermaid
 * 语法自检。不引入新的写入路径，不绕过现有校验。
 */

import { FileEditTool, FileReadTool, GlobTool, GrepTool } from '@open-zread/agent-sdk';
import type { TokenUsage } from '@open-zread/agent-sdk';
import { readTextFile, getWikiDir, joinPath, fileExists } from '@open-zread/utils';
import { createAgent } from '../agents/create-agent.js';
import { WritePageTool } from '../tools/page-tools.js';
import SectionRewritePrompt from '../prompts/section-rewrite.js';
import type { WikiPage } from '@open-zread/types';
import type { CatalogEvent } from '../types.js';

export interface RegenerateSectionResult {
  durationMs: number;
  tokenUsage?: TokenUsage;
}

function buildSectionRewritePrompt(page: WikiPage, oldContent: string, instruction: string): string {
  return [
    SectionRewritePrompt,
    '## 页面元数据（write_page 时必须使用以下参数）',
    `- slug: ${page.slug}`,
    `- file: ${page.file}`,
    `- section: ${page.section}`,
    `- title: ${page.title}`,
    '## 旧正文全文',
    '```markdown',
    oldContent,
    '```',
    '## 用户对目标小节的重写指令',
    instruction,
  ].join('\n\n');
}

/**
 * Regenerate Wiki Page Section
 *
 * @param page - 目标页面（元数据来自 wiki.json）
 * @param instruction - 用户对目标小节的重写指令
 * @param onEvent - 进度回调（与 generateWikiContent 内部使用的 createAgent 一致）
 */
export async function regenerateWikiPageSection(
  page: WikiPage,
  instruction: string,
  onEvent?: (event: CatalogEvent) => void
): Promise<RegenerateSectionResult> {
  const wikiDir = getWikiDir();
  const filePath = joinPath(wikiDir, page.section, page.file);

  if (!(await fileExists(filePath))) {
    throw new Error(`页面尚未生成过内容，无法做局部重写: ${page.slug}`);
  }

  const oldContent = await readTextFile(filePath);

  const result = await createAgent({
    tools: [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool],
    prompts: buildSectionRewritePrompt(page, oldContent, instruction),
    maxTurns: 30,
    onEvent,
  });

  return {
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
  };
}
