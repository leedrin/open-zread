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
import { extractPageFacts } from '@open-zread/repo-analyzer';
import type { WikiPage, PageFacts, AffectedDoc } from '@open-zread/types';
import type { WikiResult, ProgressState, PageResult, GenerateWikiOptions, ArticleEventPayload } from './types.js';
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

/**
 * Build page-specific prompt
 */
function buildPagePrompt(page: WikiPage, facts?: PageFacts): string {
  const associatedFilesList = page.associatedFiles?.map(f => `- ${f}`).join('\n') || '（无关联路径）';

  const targets = getQualityTargets(page);

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
${factsSection}
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

  // 并发数由调用方传递（默认 1）
  const maxConcurrent = options?.maxConcurrent ?? 1;

  // Load blueprint or use provided pages
  let pages: WikiPage[];
  let affectedDocsMap: Map<string, AffectedDoc> | undefined;

  if (options?.incrementalPlan && options.incrementalPlan.affectedDocs.length > 0) {
    pages = options.incrementalPlan.affectedDocs.map(d => d.page);
    affectedDocsMap = new Map(
      options.incrementalPlan.affectedDocs.map(d => [d.page.slug, d])
    );
    logger.info(`增量模式：${pages.length} 个受影响页面（共 ${options.incrementalPlan.unaffectedDocs.length} 个未受影响）`);
  } else if (options?.pages && options.pages.length > 0) {
    pages = options.pages;
  } else {
    const blueprint = await loadWikiBlueprint(options?.blueprintPath);
    pages = blueprint.pages;
  }

  logger.info(`开始生成 Wiki 内容：${pages.length} 个页面，并发数 ${maxConcurrent}`);

  // 3. Create concurrency limiter
  const limit = pLimit(maxConcurrent);

  // 4. Initialize progress tracking
  const progress: ProgressState = {
    total: pages.length,
    completed: 0,
    failed: 0,
    pending: pages.length,
    currentPage: null,
    results: [],
  };

  // 5. Parallel page generation using existing createAgent
  const tasks = pages.map((page) =>
    limit(async () => {
      const pageStartTime = performance.now();

      // 发射 page_start 事件
      options?.onEvent?.({ type: 'page_start', slug: page.slug });

      // Update progress
      progress.currentPage = page;
      progress.pending--;
      options?.onProgress?.(progress);

      try {

        const facts = options?.symbols
          ? extractPageFacts(page, options.symbols)
          : undefined;

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
          prompts = buildPagePrompt(page, facts);
          agentTools = [FileReadTool, FileEditTool, GlobTool, GrepTool, WritePageTool];
        }

        const result = await createAgent({
          tools: agentTools,
          prompts,
          maxTurns: isIncremental ? 15 : 30,
          // 通过 onEvent 将 CatalogEvent 转换为 ArticleEventPayload
          onEvent: (catalogEvent) => {
            // 将 CatalogEvent 转换为 ArticleEventPayload
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
                // 重试事件：传递给 UI 显示重试状态
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
                // 错误事件：createAgent 会 throw 异常，由 catch 块处理
                return;
              case 'complete':
                // 完成事件：不在这里发射，由外层处理
                return;
              default:
                // 其他事件类型不发射
                return;
            }

            options?.onEvent?.({
              type: articleEventType,
              slug: page.slug,
              usage: catalogEvent.usage,
              toolName,
            });
          },
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

        // 发射 page_complete 事件
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
        // Error isolation: single page failure doesn't stop others
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

        // 发射 page_error 事件
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

  // 6. Wait for all tasks
  await Promise.all(tasks);

  // 7. Finalize: sanitize links, build index, generate sidebar, audit
  let finalizeData: { finalizeResult?: import('@open-zread/utils').FinalizeResult; auditReport?: import('@open-zread/utils').QualityReport } = {};
  try {
    const wikiDir = getWikiDir();
    const finalizeResult = await finalizeWiki(wikiDir, {
      pages,
      audit: true,
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
    ...finalizeData,
  };
}