/**
 * Wiki Blueprint Mutation Helpers
 *
 * 轻量维护操作（新增/删除/编辑元数据）共享的 wiki.json 读-改-写、
 * slug 唯一性校验、页面文件迁移/删除逻辑。
 *
 * 全部是确定性操作，不依赖 Agent，供 CLI 直接调用，也供
 * @open-zread/orchestrator 的工具包装后交给 Agent 调用。
 */

import { rename, rm } from 'fs/promises';
import { dirname } from 'path';
import type { WikiPage } from '@open-zread/types';
import { loadConfig } from '../config/index.js';
import { ensureDir, fileExists, getWikiPageFilePath } from '../file-io.js';
import { loadWikiBlueprint, generateWikiJson } from './wiki-content.js';

/**
 * 统一的 wiki.json 读-改-写辅助函数
 *
 * 加载现有 wiki.json，对 pages 应用 mutator，写回时显式透传原有
 * techStackSummary（除非 mutator 有意在别处替换），避免各操作各自
 * 手写 load→改 pages→write 时漏传字段。
 */
export async function mutateWikiBlueprint(
  mutator: (pages: WikiPage[]) => WikiPage[] | Promise<WikiPage[]>
): Promise<import('@open-zread/types').WikiOutput> {
  const blueprint = await loadWikiBlueprint();
  const nextPages = await mutator(blueprint.pages);
  const config = await loadConfig();
  await generateWikiJson(nextPages, config, blueprint.techStackSummary);
  return loadWikiBlueprint();
}

/**
 * 共享的 slug 唯一性校验
 *
 * 对照 existingPages（排除 excludeSlug 自身，用于"编辑页面时改自己的
 * slug"场景），返回 candidateSlugs 中与现有页面冲突、或彼此重复的 slug 列表。
 * 空数组表示全部合法。
 */
export function findSlugConflicts(
  existingPages: WikiPage[],
  candidateSlugs: string[],
  excludeSlug?: string
): string[] {
  const existingSlugSet = new Set(
    existingPages.filter((p) => p.slug !== excludeSlug).map((p) => p.slug)
  );

  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const slug of candidateSlugs) {
    if (existingSlugSet.has(slug) || seen.has(slug)) {
      conflicts.push(slug);
    }
    seen.add(slug);
  }
  return conflicts;
}

/**
 * 删除主题
 *
 * 确定性操作，无需 Agent：从 wiki.json 移除该页面并删除对应的 .md 文件。
 * 不涉及 WikiStore.archivePage/versioning 那套死代码路径。
 * 磁盘文件缺失时不报错（force: true），不阻塞 wiki.json 的清理。
 */
export async function deleteWikiPage(slug: string): Promise<WikiPage | null> {
  const blueprint = await loadWikiBlueprint();
  const removedPage = blueprint.pages.find((p) => p.slug === slug) ?? null;
  if (!removedPage) return null;

  await mutateWikiBlueprint((pages) => pages.filter((p) => p.slug !== slug));

  const filePath = getWikiPageFilePath(removedPage.section, removedPage.file);
  await rm(filePath, { force: true });

  return removedPage;
}

export interface UpdatePageMetadataInput {
  /** 待修改页面的当前 slug，用于定位目标页面 */
  slug: string;
  /** 可选：重命名 slug */
  newSlug?: string;
  title?: string;
  section?: string;
  group?: string;
  associatedFiles?: string[];
}

export interface UpdatePageMetadataOutcome {
  page: WikiPage;
  sectionChanged: boolean;
  associatedFilesChanged: boolean;
}

/**
 * 编辑页面元数据（title/section/group/associatedFiles，可选 slug 重命名）
 *
 * section 变化时同步搬移磁盘上的 .md 文件（先移动文件，成功后再写
 * wiki.json；写回失败则尝试把文件移回原路径，best-effort）。
 * associatedFiles 是否变化通过返回值告知调用方，是否触发内容重新生成
 * 由调用方（CLI/orchestrator 层）决定，本函数不依赖 Agent 或内容生成逻辑。
 */
export async function updateWikiPageMetadata(
  input: UpdatePageMetadataInput
): Promise<UpdatePageMetadataOutcome> {
  const blueprint = await loadWikiBlueprint();
  const target = blueprint.pages.find((p) => p.slug === input.slug);
  if (!target) {
    throw new Error(`页面不存在: ${input.slug}`);
  }

  const nextSlug = input.newSlug ?? target.slug;
  const nextSection = input.section ?? target.section;
  const sectionChanged = nextSection !== target.section;
  const associatedFilesChanged =
    input.associatedFiles !== undefined &&
    JSON.stringify(input.associatedFiles) !== JSON.stringify(target.associatedFiles ?? []);

  if (nextSlug !== target.slug) {
    const slugConflicts = findSlugConflicts(blueprint.pages, [nextSlug], target.slug);
    if (slugConflicts.length > 0) {
      throw new Error(`新 slug 与现有页面冲突: ${nextSlug}`);
    }
  }

  if (sectionChanged) {
    const pathConflict = blueprint.pages.find(
      (p) => p.slug !== target.slug && p.section === nextSection && p.file === target.file
    );
    if (pathConflict) {
      throw new Error(`目标路径已被页面 ${pathConflict.slug} 占用: ${nextSection}/${target.file}`);
    }
  }

  const oldFilePath = getWikiPageFilePath(target.section, target.file);
  const newFilePath = getWikiPageFilePath(nextSection, target.file);

  if (sectionChanged && (await fileExists(oldFilePath))) {
    await ensureDir(dirname(newFilePath));
    await rename(oldFilePath, newFilePath);
  }

  const updatedPage: WikiPage = {
    ...target,
    slug: nextSlug,
    title: input.title ?? target.title,
    section: nextSection,
    group: input.group ?? target.group,
    associatedFiles: input.associatedFiles ?? target.associatedFiles,
  };

  try {
    await mutateWikiBlueprint((pages) =>
      pages.map((p) => (p.slug === target.slug ? updatedPage : p))
    );
  } catch (err: unknown) {
    // best-effort 回滚文件搬移，不掩盖原始错误
    if (sectionChanged && (await fileExists(newFilePath))) {
      try {
        await rename(newFilePath, oldFilePath);
      } catch {
        // 回滚失败：磁盘文件与 wiki.json 状态不一致，需要用户手动核实
      }
    }
    throw err;
  }

  return { page: updatedPage, sectionChanged, associatedFilesChanged };
}
