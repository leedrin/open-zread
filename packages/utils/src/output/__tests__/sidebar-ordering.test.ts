import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSidebar } from '../finalize.js';
import type { WikiPage } from '@open-zread/types';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    slug: 'test',
    title: 'Test',
    file: 'test.md',
    section: 'section',
    level: 'Intermediate',
    ...overrides,
  };
}

describe('generateSidebar Diataxis ordering', () => {
  const testDir = join(tmpdir(), `sidebar-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function getSidebarOutput(pages: WikiPage[]): string {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    for (const page of pages) {
      const sectionDir = join(testDir, page.section);
      mkdirSync(sectionDir, { recursive: true });
      writeFileSync(join(sectionDir, page.file), '# Test\n', 'utf-8');
    }

    generateSidebar(testDir, pages);

    return readFileSync(join(testDir, '_sidebar.md'), 'utf-8');
  }

  test('full ordering: 入门指南→上手教程→操作指南→功能域→API 参考', () => {
    const pages = [
      makePage({ slug: 'core', title: 'Core', file: 'core.md', section: '核心引擎' }),
      makePage({ slug: 'api', title: 'API Ref', file: 'api.md', section: 'API 参考' }),
      makePage({ slug: 'tutorial', title: 'Quick Start', file: 'tutorial.md', section: '上手教程' }),
      makePage({ slug: 'howto', title: 'How-to', file: 'howto.md', section: '操作指南' }),
      makePage({ slug: 'guide', title: 'Guide', file: 'guide.md', section: '入门指南' }),
    ];

    const sidebar = getSidebarOutput(pages);
    const guideIdx = sidebar.indexOf('**入门指南**');
    const tutorialIdx = sidebar.indexOf('**上手教程**');
    const howtoIdx = sidebar.indexOf('**操作指南**');
    const coreIdx = sidebar.indexOf('**核心引擎**');
    const refIdx = sidebar.indexOf('**API 参考**');

    expect(guideIdx).toBeGreaterThan(-1);
    expect(tutorialIdx).toBeGreaterThan(-1);
    expect(howtoIdx).toBeGreaterThan(-1);
    expect(coreIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeGreaterThan(-1);
    expect(guideIdx).toBeLessThan(tutorialIdx);
    expect(tutorialIdx).toBeLessThan(howtoIdx);
    expect(howtoIdx).toBeLessThan(coreIdx);
    expect(coreIdx).toBeLessThan(refIdx);
  });

  test('domain-only wiki preserves insertion order', () => {
    const pages = [
      makePage({ slug: 'b', title: 'B', file: 'b.md', section: '网络引擎' }),
      makePage({ slug: 'a', title: 'A', file: 'a.md', section: '存储层' }),
    ];

    const sidebar = getSidebarOutput(pages);
    const netIdx = sidebar.indexOf('**网络引擎**');
    const storageIdx = sidebar.indexOf('**存储层**');

    expect(netIdx).toBeGreaterThan(-1);
    expect(storageIdx).toBeGreaterThan(-1);
    expect(netIdx).toBeLessThan(storageIdx);
  });

  test('unknown section falls between howto and reference', () => {
    const pages = [
      makePage({ slug: 'custom', title: 'Custom', file: 'custom.md', section: '自定义模块' }),
      makePage({ slug: 'ref', title: 'Ref', file: 'ref.md', section: 'API 参考' }),
    ];

    const sidebar = getSidebarOutput(pages);
    const customIdx = sidebar.indexOf('**自定义模块**');
    const refIdx = sidebar.indexOf('**API 参考**');

    expect(customIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeGreaterThan(-1);
    expect(customIdx).toBeLessThan(refIdx);
  });
});
