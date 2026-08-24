/**
 * Blueprint Orchestrator
 *
 * Coordinates single Blueprint Agent to generate wiki.json blueprint.
 */

import { FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool } from '@open-zread/agent-sdk';
import type { TokenUsage } from '@open-zread/agent-sdk';
import { scanFiles, parseFiles } from '@open-zread/repo-analyzer';
import { saveCachedManifest, saveCachedSymbols, loadWikiBlueprint } from '@open-zread/utils';
import type { WikiPage } from '@open-zread/types';
import { createAgent } from './agents/create-agent';
import GenerateCatalog from './prompts/generate-catalog';
import AppendTopicPrompt from './prompts/append-topic';
import { GenerateBlueprintTool, ValidateBlueprintTool, AppendBlueprintTool, UpdatePageMetadataTool } from './tools/output-tools.js';
import { GetCoreSignaturesTool, GetDirectoryTreeTool, GetModuleDetailsTool } from './tools/repo-map-tools.js';
import type { BlueprintResult, CatalogEvent } from './types.js';

/** Blueprint Agent 工具列表 */
const BLUEPRINT_TOOLS = [
  // 三层 Repo Map 工具
  GetDirectoryTreeTool,      // Layer 1: 目录树
  GetCoreSignaturesTool,     // Layer 2: 核心签名
  GetModuleDetailsTool,      // Layer 3: 模块详情
  // 输出工具
  GenerateBlueprintTool,     // 生成 wiki.json
  ValidateBlueprintTool,     // 验证蓝图
  // 基础工具
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  GlobTool,
  GrepTool,
];

/**
 * Generate Wiki Catalog
 *
 * 使用 Blueprint Agent 生成 wiki.json 目录结构。
 * 支持可选进度回调用于实时 UI 更新。
 *
 * @param onEvent - 进度回调（可选）
 * @returns BlueprintResult with output path and metadata
 */
export async function generateWikiCatalog(
  onEvent?: (event: CatalogEvent) => void
): Promise<BlueprintResult> {
  const result = await createAgent({
    tools: BLUEPRINT_TOOLS,
    prompts: GenerateCatalog as string,
    onEvent,
  });

  return {
    pagesCount: 0,
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
  };
}

/** Append Topic Agent 工具列表（新增主题：探索代码 + 定点追加，不含全量重规划工具） */
const APPEND_TOPIC_TOOLS = [
  GetDirectoryTreeTool,
  GetCoreSignaturesTool,
  GetModuleDetailsTool,
  AppendBlueprintTool,
  FileReadTool,
  GlobTool,
  GrepTool,
];

export interface AppendTopicResult {
  /** 本次新追加的页面（用于调用方紧接着触发内容生成） */
  addedPages: WikiPage[];
  durationMs: number;
  tokenUsage?: TokenUsage;
}

/**
 * Append Wiki Topic
 *
 * "新增主题"：先刷新代码扫描缓存，再让 Agent 结合三层 Repo Map 工具
 * 和现有 wiki.json 摘要，产出 1~N 篇新页面并追加到 wiki.json（不改动
 * 任何已有页面）。返回新增的页面列表，供调用方对其触发内容生成。
 */
export async function appendWikiTopic(
  topicDescription: string,
  onEvent?: (event: CatalogEvent) => void
): Promise<AppendTopicResult> {
  const startTime = performance.now();

  onEvent?.({ type: 'scanning' });
  const manifest = await scanFiles();
  await saveCachedManifest(manifest);

  onEvent?.({ type: 'parsing' });
  const symbols = await parseFiles(manifest);
  await saveCachedSymbols(symbols);

  const before = await loadWikiBlueprint();
  const beforeSlugs = new Set(before.pages.map(p => p.slug));
  const catalogSummary = before.pages
    .map(p => `- [${p.slug}] ${p.title} (section: ${p.section}${p.group ? `, group: ${p.group}` : ''})`)
    .join('\n');

  const result = await createAgent({
    tools: APPEND_TOPIC_TOOLS,
    prompts: [
      `## 现有 wiki.json 摘要\n${catalogSummary}`,
      `## 用户主题描述\n${topicDescription}`,
      '## 任务',
      AppendTopicPrompt as string,
    ].join('\n\n'),
    onEvent,
  });

  const after = await loadWikiBlueprint();
  const addedPages = after.pages.filter(p => !beforeSlugs.has(p.slug));

  return {
    addedPages,
    durationMs: Math.round(performance.now() - startTime),
    tokenUsage: result.tokenUsage,
  };
}

/** Update Metadata Agent 工具列表（associatedFiles 重定位：探索代码 + 定点更新） */
const UPDATE_METADATA_TOOLS = [
  GetDirectoryTreeTool,
  GetCoreSignaturesTool,
  GetModuleDetailsTool,
  UpdatePageMetadataTool,
  FileReadTool,
  GlobTool,
  GrepTool,
];

export interface UpdateTopicAssociatedFilesResult {
  page: WikiPage;
  durationMs: number;
  tokenUsage?: TokenUsage;
}

/**
 * Update Wiki Topic Associated Files
 *
 * "编辑元数据"里唯一需要 Agent 参与的分支：用户用自然语言描述某页面
 * 应该关联的代码范围调整，Agent 结合三层 Repo Map 工具重新探索代码，
 * 判断新的 associatedFiles 后调用 update_page_metadata 提交。
 * title/section/group 的直接编辑不需要 Agent，由 CLI 直接调用
 * updateWikiPageMetadata()。
 */
export async function updateWikiTopicAssociatedFiles(
  slug: string,
  instruction: string,
  onEvent?: (event: CatalogEvent) => void
): Promise<UpdateTopicAssociatedFilesResult> {
  const startTime = performance.now();

  onEvent?.({ type: 'scanning' });
  const manifest = await scanFiles();
  await saveCachedManifest(manifest);

  onEvent?.({ type: 'parsing' });
  const symbols = await parseFiles(manifest);
  await saveCachedSymbols(symbols);

  const blueprint = await loadWikiBlueprint();
  const target = blueprint.pages.find(p => p.slug === slug);
  if (!target) {
    throw new Error(`页面不存在: ${slug}`);
  }

  const result = await createAgent({
    tools: UPDATE_METADATA_TOOLS,
    prompts: [
      `## 待调整页面\n${JSON.stringify(target, null, 2)}`,
      `## 用户指令\n${instruction}`,
      '## 任务\n请结合三层 Repo Map 工具重新探索代码，判断这篇页面应该关联哪些源码文件/目录，然后调用 update_page_metadata 提交新的 associatedFiles。',
    ].join('\n\n'),
    onEvent,
  });

  const after = await loadWikiBlueprint();
  const updatedPage = after.pages.find(p => p.slug === slug);
  if (!updatedPage) {
    throw new Error(`更新后未找到页面: ${slug}`);
  }

  return {
    page: updatedPage,
    durationMs: Math.round(performance.now() - startTime),
    tokenUsage: result.tokenUsage,
  };
}

// Re-export types
export type { BlueprintOptions, BlueprintResult, CatalogEvent } from './types.js';

// Sync exports
export { syncWiki } from './wiki/sync-wiki.js';
export type { SyncResult } from './wiki/sync-wiki.js';
