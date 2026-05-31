import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { WikiOutput, WikiPage, CatalogMergePlan } from '@open-zread/types';
import {
  getWikiJsonPath, getWikiDir, loadConfig, migrateCatalog,
  loadBaseFromSnapshot, computeMergePlan, generateWikiJson, finalizeWiki, logger,
  normalizeDeepDiveChildren, buildAddsOnlyPlan,
} from '@open-zread/utils';
import { generateWikiCatalog, generateDeepDiveCatalog } from '../orchestrator.js';
import type { CatalogEvent } from '../types.js';

export interface CatalogProposal {
  plan: CatalogMergePlan;
  local: WikiPage[];
  /** REMOTE WikiOutput (carries glossary + techStackSummary for the final persist). */
  remote: WikiOutput;
}

/**
 * Produce a REMOTE catalog proposal by running the Catalog Agent, WITHOUT permanently
 * clobbering the live wiki.json: the current wiki.json is preserved and restored after
 * the agent run. Computes a 3-way merge plan against BASE (newest snapshot) and LOCAL.
 */
export async function generateCatalogProposal(onEvent?: (e: CatalogEvent) => void): Promise<CatalogProposal> {
  const wikiJsonPath = getWikiJsonPath();
  const localContent = existsSync(wikiJsonPath) ? readFileSync(wikiJsonPath, 'utf-8') : null;

  let remote: WikiOutput;
  try {
    await generateWikiCatalog(onEvent); // overwrites wiki.json with REMOTE
    remote = migrateCatalog(JSON.parse(readFileSync(wikiJsonPath, 'utf-8')) as WikiOutput);
  } finally {
    if (localContent !== null) writeFileSync(wikiJsonPath, localContent, 'utf-8');
  }

  const local = localContent
    ? migrateCatalog(JSON.parse(localContent) as WikiOutput).pages
    : [];
  const base = (await loadBaseFromSnapshot()) ?? local;
  const plan = computeMergePlan({ base, local, remote: remote.pages });

  logger.info(`合并提案: +${plan.adds.length} 新增 / ${plan.updates.length} 更新 / ${plan.conflicts.length} 冲突 / ${plan.removes.length} 移除`);
  return { plan, local, remote };
}

/**
 * Persist a merged catalog: rewrite wiki.json + re-run finalize (sidebar/index/glossary).
 */
export async function persistMergedCatalog(pages: WikiPage[], remote: WikiOutput): Promise<void> {
  const config = await loadConfig();
  await generateWikiJson(pages, config, remote.techStackSummary, remote.glossary);
  await finalizeWiki(getWikiDir(), { pages, glossary: remote.glossary });
}

/**
 * Deep-dive a topic page: run a scoped agent to propose child sub-pages, normalize them,
 * and return an adds-only proposal that flows through the standard merge-review UI.
 */
export async function generateDeepDiveProposal(
  topicPageId: string,
  onEvent?: (e: CatalogEvent) => void,
): Promise<CatalogProposal> {
  const wikiJsonPath = getWikiJsonPath();
  const localContent = existsSync(wikiJsonPath) ? readFileSync(wikiJsonPath, 'utf-8') : null;
  if (localContent === null) throw new Error('深挖需要现有的 wiki.json');

  const current = migrateCatalog(JSON.parse(localContent) as WikiOutput);
  const topic = current.pages.find((p) => p.id === topicPageId);
  if (!topic) throw new Error('未找到深挖主题页面');

  let proposedRaw: WikiPage[];
  try {
    await generateDeepDiveCatalog(topic, onEvent); // overwrites wiki.json with the proposed children
    proposedRaw = migrateCatalog(JSON.parse(readFileSync(wikiJsonPath, 'utf-8')) as WikiOutput).pages;
  } finally {
    writeFileSync(wikiJsonPath, localContent, 'utf-8');
  }

  const existingIds = new Set(current.pages.map((p) => p.id));
  const candidates = proposedRaw.filter((c) => !c.id || !existingIds.has(c.id));
  const children = normalizeDeepDiveChildren(candidates, topic);
  const plan = buildAddsOnlyPlan(children);

  logger.info(`深挖提案: 主题「${topic.title}」→ ${children.length} 个子页面`);
  return { plan, local: current.pages, remote: current };
}
