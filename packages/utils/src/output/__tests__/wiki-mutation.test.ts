import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AppConfig, WikiPage } from '@open-zread/types';
import { generateWikiJson } from '../wiki-content.js';
import {
  mutateWikiBlueprint,
  findSlugConflicts,
  deleteWikiPage,
  updateWikiPageMetadata,
} from '../wiki-mutation.js';
import { getWikiPageFilePath } from '../../file-io.js';
import { DEFAULT_CONFIG } from '../../config/index.js';

function samplePages(): WikiPage[] {
  return [
    {
      slug: 'overview',
      title: '项目概览',
      file: 'overview.md',
      section: '入门指南',
      level: 'Beginner',
      associatedFiles: ['README.md'],
    },
    {
      slug: 'core-engine',
      title: '核心引擎',
      file: 'core-engine.md',
      section: '核心架构',
      group: '引擎',
      level: 'Advanced',
      associatedFiles: ['src/engine.ts'],
    },
  ];
}

const config: AppConfig = { ...DEFAULT_CONFIG };

describe('findSlugConflicts (pure)', () => {
  test('returns empty when no conflicts', () => {
    const conflicts = findSlugConflicts(samplePages(), ['new-topic']);
    expect(conflicts).toEqual([]);
  });

  test('detects conflict against existing pages', () => {
    const conflicts = findSlugConflicts(samplePages(), ['overview', 'new-topic']);
    expect(conflicts).toEqual(['overview']);
  });

  test('detects duplicate slugs within the candidate batch itself', () => {
    const conflicts = findSlugConflicts(samplePages(), ['a', 'a']);
    expect(conflicts).toEqual(['a']);
  });

  test('excludeSlug lets a page conflict-check against itself without false positive', () => {
    const conflicts = findSlugConflicts(samplePages(), ['overview'], 'overview');
    expect(conflicts).toEqual([]);
  });
});

describe('wiki-mutation file operations', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(async () => {
    cwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'oz-wiki-mutation-'));
    process.chdir(tmpDir);
    await generateWikiJson(samplePages(), config, {
      techStack: { languages: ['TypeScript'], frameworks: [], buildTools: [] },
      projectType: 'library',
      entryPoints: ['src/index.ts'],
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('mutateWikiBlueprint applies mutator and preserves techStackSummary', async () => {
    const result = await mutateWikiBlueprint((pages) => [
      ...pages,
      {
        slug: 'new-topic',
        title: '新主题',
        file: 'new-topic.md',
        section: '入门指南',
        level: 'Beginner',
      },
    ]);

    expect(result.pages.map((p) => p.slug)).toEqual(['overview', 'core-engine', 'new-topic']);
    expect(result.techStackSummary?.projectType).toBe('library');
  });

  test('deleteWikiPage removes the page from wiki.json and deletes the file (tolerates missing file)', async () => {
    // 磁盘上并没有真实的 .md 文件（测试没有创建），验证不因文件缺失而报错
    const removed = await deleteWikiPage('overview');
    expect(removed?.slug).toBe('overview');

    const raw = readFileSync(join(tmpDir, '.open-zread', 'wiki', 'wiki.json'), 'utf-8');
    const pages = JSON.parse(raw).pages as WikiPage[];
    expect(pages.map((p) => p.slug)).toEqual(['core-engine']);
  });

  test('deleteWikiPage is a no-op when slug does not exist', async () => {
    const removed = await deleteWikiPage('does-not-exist');
    expect(removed).toBeNull();
  });

  test('updateWikiPageMetadata updates title without touching files', async () => {
    const { page, sectionChanged, associatedFilesChanged } = await updateWikiPageMetadata({
      slug: 'overview',
      title: '项目概览（更新）',
    });

    expect(page.title).toBe('项目概览（更新）');
    expect(sectionChanged).toBe(false);
    expect(associatedFilesChanged).toBe(false);
  });

  test('updateWikiPageMetadata moves the markdown file when section changes', async () => {
    const oldPath = getWikiPageFilePath('入门指南', 'overview.md');
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir(join(tmpDir, '.open-zread', 'wiki', '入门指南'), { recursive: true });
    await writeFile(oldPath, '# Overview');

    const { page, sectionChanged } = await updateWikiPageMetadata({
      slug: 'overview',
      section: '新分类',
    });

    expect(sectionChanged).toBe(true);
    expect(page.section).toBe('新分类');
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(getWikiPageFilePath('新分类', 'overview.md'))).toBe(true);
  });

  test('updateWikiPageMetadata rejects a slug rename that collides with another page', async () => {
    await expect(
      updateWikiPageMetadata({ slug: 'overview', newSlug: 'core-engine' })
    ).rejects.toThrow();
  });

  test('updateWikiPageMetadata rejects a section change that collides on section+file', async () => {
    // core-engine 与 overview 的 file 名不同，改 section 不会冲突
    await expect(
      updateWikiPageMetadata({ slug: 'core-engine', section: '入门指南', title: '核心引擎' })
    ).resolves.toBeDefined();

    // 构造真正的撞车场景：追加一篇与 overview 同名 file、不同 section 的页面，
    // 再尝试把它挪到 overview 所在的 section
    await mutateWikiBlueprint((pages) => [
      ...pages,
      {
        slug: 'other-overview',
        title: '另一篇同名文件',
        file: 'overview.md',
        section: '其他分类',
        level: 'Beginner',
      },
    ]);

    await expect(
      updateWikiPageMetadata({ slug: 'other-overview', section: '入门指南' })
    ).rejects.toThrow();
  });

  test('updateWikiPageMetadata reports associatedFilesChanged only when the value actually differs', async () => {
    const unchanged = await updateWikiPageMetadata({
      slug: 'overview',
      associatedFiles: ['README.md'],
    });
    expect(unchanged.associatedFilesChanged).toBe(false);

    const changed = await updateWikiPageMetadata({
      slug: 'overview',
      associatedFiles: ['README.md', 'package.json'],
    });
    expect(changed.associatedFilesChanged).toBe(true);
  });
});
