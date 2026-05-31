import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { WikiOutput, WikiPage, CatalogMergePlan } from '@open-zread/types';
import {
  getWikiJsonPath, getWikiDir, loadConfig, migrateCatalog,
  loadBaseFromSnapshot, computeMergePlan, generateWikiJson, finalizeWiki, logger,
} from '@open-zread/utils';
import { generateWikiCatalog } from '../orchestrator.js';
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
