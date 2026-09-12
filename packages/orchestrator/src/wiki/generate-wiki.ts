/**
 * Wiki Content Generation Engine
 *
 * TypeScript control flow for parallel Wiki page generation.
 *
 * Architecture: "Code for control flow, LLM for content"
 * - TypeScript uses p-limit for concurrency control
 * - Each Wiki page gets an independent Agent via createAgent
 * - Error isolation: single page failure doesn't affect others
 * - 支持细粒度事件回调（onEvent）和批量进度回调（onProgress）
 */

import pLimit from 'p-limit';
import { loadWikiBlueprint, logger, finalizeWiki, getWikiDir, readTextFile } from '@open-zread/utils';
import { createAgent } from '../agents/create-agent.js';
import { FileEditTool, FileReadTool, GlobTool, GrepTool } from '@open-zread/agent-sdk';
import { WritePageTool, ReadPageTool } from '../tools/page-tools.js';
import PageAgentPrompt from '../prompts/page-agent';
import { buildSurgicalEditPrompt } from '../prompts/surgical-edit.js';
import { buildRegeneratePrompt } from '../prompts/regenerate-with-feedback.js';
import ArchitectPagePrompt from '../prompts/architect-page.js';
import ReviewerPagePrompt from '../prompts/reviewer-page.js';
import { buildTutorialPrompt, buildHowToPrompt } from './prompt-builders.js';
import { buildReferencePrompt } from './reference-skeleton.js';
import { extractPageFacts } from '@open-zread/repo-analyzer';
import type { WikiPage, PageFacts, AffectedDoc, GlossaryTerm } from '@open-zread/types';
import type { WikiResult, ProgressState, PageResult, GenerateWikiOptions, ArticleEventPayload } from './types.js';
import type { CatalogEvent } from '../types.js';
import { resolve } from 'path';

interface QualityTargets {
  minLines: number;
  minDiagrams: number;
  minDiagramTypes: number;
  minExamples: number;
}

/**
 * 根据页面 level 和关联文件数动态计算质量目标
 */
function getQualityTargets(page: WikiPage): QualityTargets {
  const fileCount = page.associatedFiles?.length ?? 0;

  // core: Advanced 或关联文件 ≥ 5
  if (page.level === 'Advanced' || fileCount >= 5) {
    return { minLines: 400, minDiagrams: 2, minDiagramTypes: 2, minExamples: 5 };
  }

  // simple: Beginner 且关联文件 ≤ 2
  if (page.level === 'Beginner' && fileCount <= 2) {
    return { minLines: 80, minDiagrams: 1, minDiagramTypes: 1, minExamples: 1 };
  }

  // standard: 其他所有情况
  return { minLines: 200, minDiagrams: 1, minDiagramTypes: 1, minExamples: 2 };
}

function formatDoc(doc: string): string {
  const lines = doc.split('\n');
  if (lines.length <= 1) return doc;
  return lines.join('\n              ');
}

export function buildGlossarySection(glossary: GlossaryTerm[]): string {
  if (!glossary || glossary.length === 0) return '';

  const lines: string[] = [];
  lines.push('## 📖 项目术语表（统一命名）');
  lines.push('');
  lines.push('以下是项目的核心术语规范。提到这些概念时**必须**使用术语表中的规范名称。');
  lines.push('');
  for (const g of glossary) {
    const aliases = g.aliases && g.aliases.length > 0 ? `（别名：${g.aliases.join('、')}）` : '';
    lines.push(`- **${g.term}**${aliases}：${g.definition}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

/**
 * Build page-specific prompt
 */
export function buildPagePrompt(page: WikiPage, facts?: PageFacts, glossary?: GlossaryTerm[]): string {
  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';

  const targets = getQualityTargets(page);

  const glossarySection = buildGlossarySection(glossary ?? []);

  const factsSection = facts && facts.exports.length > 0
    ? `

---

## 🔴 Facts — 权威数据源（API 签名必须以这里为准）

**导出符号** (共 ${facts.exports.length} 个):
${facts.exports.map(e => {
    const base = `- \`${e.signature}\` → ${e.file}${e.line ? `#L${e.line}` : ''}`;
    if (e.doc) return base + `\n  📝 作者注释：${formatDoc(e.doc)}`;
    return base;
  }).join('\n')}

**关联文件摘要**:
${facts.fileSummaries.map(f => `- ${f.file} (${f.symbolCount} 个符号, 导出: [${f.exports.slice(0, 5).join(', ')}${f.exports.length > 5 ? '...' : ''}])`).join('\n')}

## ⚠️ Facts 规则
1. 所有 API 描述必须以上述符号列表为准
2. 如果某个符号在 Facts 中不存在，不要添加到文档中
3. 如果 Facts 中有某个符号但不理解，可以忽略但不要篡改其签名
4. 描述 API 用途时，**优先**使用作者注释中的措辞和角度，避免重新发挥

`
    : '';

  return `${PageAgentPrompt}
${glossarySection}${factsSection}
---

## 🎯 本文档质量目标

根据页面难度（\`${page.level}\`）和关联文件数自动计算：

| 指标 | 最低要求 |
|------|----------|
| 文档行数 | ${targets.minLines}+ |
| Mermaid 图表 | ${targets.minDiagrams} 个 |
| 不同图表类型 | ${targets.minDiagramTypes} 种 |
| 代码示例 | ${targets.minExamples} 个 |
| 源文件溯源 | 每个章节 + 每个代码块 |

---

## 当前页面任务

**标题**: ${page.title}
**Slug**: ${page.slug}
**文件名**: ${page.file}
**章节**: ${page.section}
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

请按照三步工作流执行，最后使用 write_page 输出文档（务必传入完整的 file 和 section 参数）。`;
}

function buildAgentEventHandler(
  options: GenerateWikiOptions | undefined,
  page: WikiPage,
) {
  return (catalogEvent: CatalogEvent) => {
    let articleEventType: ArticleEventPayload['type'];
    let toolName: string | undefined;

    switch (catalogEvent.type) {
      case 'requesting':
        articleEventType = 'requesting';
        break;
      case 'responding':
        articleEventType = 'responding';
        break;
      case 'tool_start':
        articleEventType = 'tool_start';
        toolName = catalogEvent.toolName;
        break;
      case 'tool_result':
        articleEventType = 'tool_result';
        break;
      case 'retry':
        options?.onEvent?.({
          type: 'retry',
          slug: page.slug,
          usage: catalogEvent.usage,
          retryCount: catalogEvent.retryCount,
          maxRetries: catalogEvent.maxRetries,
          delayMs: catalogEvent.delayMs,
          error: catalogEvent.error,
        });
        return;
      case 'error':
        return;
      case 'complete':
        return;
      default:
        return;
    }

    options?.onEvent?.({
      type: articleEventType,
      slug: page.slug,
      usage: catalogEvent.usage,
      toolName,
    });
  };
}

async function generatePageDualPass(
  page: WikiPage,
  facts: PageFacts | undefined,
  glossary: GlossaryTerm[] | undefined,
  options: GenerateWikiOptions | undefined,
  progress: ProgressState,
  pageStartTime: number,
): Promise<PageResult> {
  const architectPrompt = `${ArchitectPagePrompt}\n\n${buildPagePrompt(page, facts, glossary)}`;

  await createAgent({
    tools: [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool],
    prompts: architectPrompt,
    maxTurns: 30,
    onEvent: buildAgentEventHandler(options, page),
  });

  const reviewerPrompt = `${ReviewerPagePrompt}\n\n${buildPagePrompt(page, facts, glossary)}`;

  const result = await createAgent({
    tools: [FileReadTool, GlobTool, GrepTool, ReadPageTool, WritePageTool],
    prompts: reviewerPrompt,
    maxTurns: 20,
    onEvent: buildAgentEventHandler(options, page),
  });

  progress.completed++;
  const pageResult: PageResult = {
    slug: page.slug,
    success: true,
    outputPath: `.open-zread/wiki/${page.section}/${page.file}`,
    durationMs: Math.round(performance.now() - pageStartTime),
    tokenUsage: result.tokenUsage,
  };
  progress.results.push(pageResult);
  options?.onProgress?.(progress);

  options?.onEvent?.({
    type: 'page_complete',
    slug: page.slug,
    outputPath: pageResult.outputPath,
    durationMs: pageResult.durationMs,
    usage: result.tokenUsage,
  });

  logger.success(`[${page.slug}] 双轮完成 (${pageResult.durationMs}ms)`);

  return pageResult;
}

function getEligibleRegenPages(
  auditReport: import('@open-zread/utils').QualityReport,
  pages: WikiPage[],
  regenThreshold: number,
): WikiPage[] {
  const eligible: WikiPage[] = [];

  for (const doc of auditReport.docs) {
    const rel = doc.filePath.replace(/^.+?[/\\]wiki[/\\]/, '');
    const page = pages.find(p => p.file === rel);
    if (!page) continue;

    if (doc.level === 'basic') {
      eligible.push(page);
      continue;
    }

    if (doc.metrics.exportsTotal > 0) {
      const coverage = doc.metrics.exportsCovered / doc.metrics.exportsTotal;
      if (coverage < regenThreshold) {
        eligible.push(page);
      }
    }
  }

  return eligible;
}

/**
 * Generate Wiki Content
 *
 * Parallel Wiki page generation with p-limit concurrency control.
 * 支持细粒度事件回调（onEvent）和批量进度回调（onProgress）。
 *
 * 注意：并发数由调用方传递，重试次数由 createAgent 从配置读取。
 */
export async function generateWikiContent(options?: GenerateWikiOptions): Promise<WikiResult> {
  const startTime = performance.now();

  const maxConcurrent = options?.maxConcurrent ?? 1;
  const maxRegenRounds = options?.maxRegenRounds ?? 1;
  const regenThreshold = options?.regenThreshold ?? 0.6;

  let pages: WikiPage[];
  let glossary: GlossaryTerm[] | undefined;
  let affectedDocsMap: Map<string, AffectedDoc> | undefined;

  if (options?.incrementalPlan && options.incrementalPlan.affectedDocs.length > 0) {
    pages = options.incrementalPlan.affectedDocs.map(d => d.page);
    affectedDocsMap = new Map(
      options.incrementalPlan.affectedDocs.map(d => [d.page.slug, d])
    );
    logger.info(`增量模式：${pages.length} 个受影响页面（共 ${options.incrementalPlan.unaffectedDocs.length} 个未受影响）`);
  } else if (options?.pages && options.pages.length > 0) {
    pages = options.pages;
    glossary = options.glossary;
  } else {
    const blueprint = await loadWikiBlueprint(options?.blueprintPath);
    pages = blueprint.pages;
    glossary = blueprint.glossary;
  }

  // Glossary 兜底：调用方（如 CLI 的 pages/incremental 路径）通常只传 pages，不带 glossary，
  // 导致 finalize 跳过术语表页渲染。统一从 wiki.json 回收 glossary，确保任何入口都能产出术语表页。
  if (!glossary || glossary.length === 0) {
    try {
      const bp = await loadWikiBlueprint(options?.blueprintPath);
      if (bp.glossary && bp.glossary.length > 0) glossary = bp.glossary;
    } catch {
      // wiki.json 不存在或无法解析——跳过，按无术语表处理
    }
  }

  logger.info(`开始生成 Wiki 内容：${pages.length} 个页面，并发数 ${maxConcurrent}`);

  const limit = pLimit(maxConcurrent);

  const progress: ProgressState = {
    total: pages.length,
    completed: 0,
    failed: 0,
    pending: pages.length,
    currentPage: null,
    results: [],
  };

  const factsCollection = new Map<string, PageFacts>();

  const tasks = pages.map((page) =>
    limit(async () => {
      const pageStartTime = performance.now();

      options?.onEvent?.({ type: 'page_start', slug: page.slug });

      progress.currentPage = page;
      progress.pending--;
      options?.onProgress?.(progress);

      try {

        const facts = options?.symbols
          ? extractPageFacts(page, options.symbols)
          : undefined;

        if (facts) {
          factsCollection.set(page.file, facts);
        }

        const affected = affectedDocsMap?.get(page.slug);
        const isIncremental = affected?.updateStrength === 'incremental';
        const triggeredBy = affected?.triggeredBy ?? [];

        let prompts: string;
        let agentTools: Array<typeof FileReadTool>;

        if (isIncremental) {
          const wikiDir = getWikiDir();
          const existingPath = resolve(wikiDir, page.section, page.file);
          let existingContent = '';
          try {
            existingContent = await readTextFile(existingPath);
          } catch {
            existingContent = '(文档不存在，将全量生成)';
          }

          prompts = buildSurgicalEditPrompt({
            page,
            triggeredBy,
            existingContent,
          });
          agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, ReadPageTool, WritePageTool];
        } else {
          const docType = page.docType ?? 'explanation';

          switch (docType) {
            case 'tutorial':
              prompts = buildTutorialPrompt(page, facts, glossary);
              agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool];
              break;
            case 'howto':
              prompts = buildHowToPrompt(page, facts, glossary);
              agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool];
              break;
            case 'reference':
              prompts = buildReferencePrompt(page, facts ?? {
                pageSlug: page.slug,
                exports: [],
                fileSummaries: [],
                internalDeps: [],
                externalDeps: [],
                confidence: 0,
              }, glossary);
              agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool];
              break;
            case 'explanation':
            default:
              if (page.level === 'Advanced') {
                return generatePageDualPass(page, facts, glossary, options, progress, pageStartTime);
              }
              prompts = buildPagePrompt(page, facts, glossary);
              agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool];
              break;
          }
        }

        const result = await createAgent({
          tools: agentTools,
          prompts,
          maxTurns: isIncremental ? 15 : 30,
          onEvent: buildAgentEventHandler(options, page),
        });

        // Success
        progress.completed++;
        const pageResult: PageResult = {
          slug: page.slug,
          success: true,
          outputPath: `.open-zread/wiki/${page.section}/${page.file}`,
          durationMs: Math.round(performance.now() - pageStartTime),
          tokenUsage: result.tokenUsage,
        };
        progress.results.push(pageResult);
        options?.onProgress?.(progress);

        options?.onEvent?.({
          type: 'page_complete',
          slug: page.slug,
          outputPath: pageResult.outputPath,
          durationMs: pageResult.durationMs,
          usage: result.tokenUsage,
        });

        logger.success(`[${page.slug}] 完成 (${pageResult.durationMs}ms)`);

        return pageResult;

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        progress.failed++;
        const pageResult: PageResult = {
          slug: page.slug,
          success: false,
          error: message,
          durationMs: Math.round(performance.now() - pageStartTime),
        };
        progress.results.push(pageResult);
        options?.onProgress?.(progress);

        options?.onEvent?.({
          type: 'page_error',
          slug: page.slug,
          error: message,
          durationMs: pageResult.durationMs,
        });

        logger.error(`[${page.slug}] 失败: ${message}`);

        return pageResult;
      }
    })
  );

  await Promise.all(tasks);

  let finalizeData: { finalizeResult?: import('@open-zread/utils').FinalizeResult; auditReport?: import('@open-zread/utils').QualityReport } = {};
  try {
    const wikiDir = getWikiDir();
    const finalizeResult = await finalizeWiki(wikiDir, {
      pages,
      audit: true,
      factsMap: factsCollection,
      glossary,
    });

    logger.info(`收尾完成: ${finalizeResult.linksSanitized} 链接修复, 索引=${finalizeResult.docIndexBuilt}, 侧边栏=${finalizeResult.sidebarGenerated}`);

    if (finalizeResult.auditReport) {
      const { auditReport } = finalizeResult;
      logger.info(
        `质量审计: ${auditReport.professionalCount}/${auditReport.totalDocs} professional, ${auditReport.standardCount} standard, ${auditReport.basicCount} basic`
      );
    }

    if (finalizeResult.errors.length > 0) {
      for (const { step, error } of finalizeResult.errors) {
        logger.warn(`收尾步骤 [${step}] 失败: ${error}`);
      }
    }

    finalizeData = {
      finalizeResult,
      auditReport: finalizeResult.auditReport,
    };
  } catch (err) {
    logger.warn(`收尾管道异常: ${err instanceof Error ? err.message : String(err)}`);
  }

  let regeneratedCount = 0;

  if (maxRegenRounds > 0 && finalizeData.auditReport) {
    const currentAudit = finalizeData.auditReport;
    for (let round = 0; round < maxRegenRounds; round++) {
      const eligiblePages = getEligibleRegenPages(currentAudit, pages, regenThreshold);
      if (eligiblePages.length === 0) {
        logger.info(`重生环 round ${round + 1}: 无待重生页面，提前结束`);
        break;
      }

      logger.info(`重生环 round ${round + 1}: ${eligiblePages.length} 个待重生页面`);

      const regenTasks = eligiblePages.map(page =>
        limit(async () => {
          const facts = factsCollection.get(page.file);
          const docQuality = currentAudit.docs.find(d => {
            const rel = d.filePath.replace(/^.+?[/\\]wiki[/\\]/, '');
            return rel === page.file;
          });
          const metrics = docQuality?.metrics;

          const prompts = metrics
            ? buildRegeneratePrompt(page, metrics, facts)
            : buildPagePrompt(page, facts, glossary);

          try {
            const result = await createAgent({
              tools: [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool],
              prompts,
              maxTurns: 30,
              onEvent: buildAgentEventHandler(options, page),
            });

            regeneratedCount++;
            logger.success(`[重生] ${page.slug} 完成`);
            return result;
          } catch (err) {
            logger.warn(`[重生] ${page.slug} 失败: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        })
      );

      await Promise.all(regenTasks);

      try {
        const wikiDir = getWikiDir();
        const reFinalize = await finalizeWiki(wikiDir, {
          pages,
          audit: true,
          factsMap: factsCollection,
          glossary,
        });
        finalizeData.auditReport = reFinalize.auditReport;
      } catch (err) {
        logger.warn(`重生后重新审计失败: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
  }

  if (regeneratedCount > 0 && finalizeData.auditReport) {
    const auditReport = finalizeData.auditReport;
    logger.info(
      `重生完成: ${regeneratedCount} 页重生, 最终质量 ${auditReport.professionalCount}/${auditReport.totalDocs} professional, ${auditReport.standardCount} standard, ${auditReport.basicCount} basic`
    );
  }

  const durationMs = Math.round(performance.now() - startTime);

  logger.info(
    `Wiki 内容生成完成：${progress.completed}/${progress.total} 成功，${progress.failed} 失败 (${durationMs}ms)`
  );

  return {
    total: pages.length,
    completed: progress.completed,
    failed: progress.failed,
    durationMs,
    results: progress.results,
    regeneratedCount,
    ...finalizeData,
  };
}