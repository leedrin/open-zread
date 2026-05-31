import { describe, test, expect } from 'bun:test';
import { buildPagePrompt } from '../../wiki/generate-wiki.js';
import type { WikiPage, PageFacts, GlossaryTerm } from '@open-zread/types';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    slug: 'test-page',
    title: '测试页面',
    file: 'test-page.md',
    section: '测试章节',
    level: 'Intermediate',
    ...overrides,
  };
}

function makeFacts(exportNames: string[]): PageFacts {
  return {
    pageSlug: 'test-page',
    exports: exportNames.map(name => ({
      name,
      kind: 'function' as const,
      signature: `export function ${name}()`,
      file: `src/${name}.ts`,
    })),
    fileSummaries: [],
    internalDeps: [],
    externalDeps: [],
    confidence: 1,
  };
}

describe('buildPagePrompt glossary injection', () => {
  test('glossary section is injected before Facts when present', () => {
    const page = makePage();
    const facts = makeFacts(['foo']);
    const glossary: GlossaryTerm[] = [
      { term: 'Repo Map', aliases: ['代码库地图'], definition: '三层递进式代码库摘要', canonicalPage: '3-core-architecture' },
    ];

    const prompt = buildPagePrompt(page, facts, glossary);

    const glossaryIdx = prompt.indexOf('## 📖 项目术语表（统一命名）');
    const factsIdx = prompt.indexOf('## 🔴 Facts');
    expect(glossaryIdx).toBeGreaterThan(-1);
    expect(factsIdx).toBeGreaterThan(-1);
    expect(glossaryIdx).toBeLessThan(factsIdx);
  });

  test('glossary section is omitted when not provided', () => {
    const page = makePage();
    const prompt = buildPagePrompt(page);

    expect(prompt).not.toContain('## 📖 项目术语表（统一命名）');
  });

  test('glossary section is omitted when empty array', () => {
    const page = makePage();
    const prompt = buildPagePrompt(page, undefined, []);

    expect(prompt).not.toContain('## 📖 项目术语表（统一命名）');
  });

  test('glossary renders term, aliases, and definition', () => {
    const page = makePage();
    const glossary: GlossaryTerm[] = [
      { term: 'Repo Map', aliases: ['代码库地图', '项目骨架'], definition: '三层递进式代码库摘要' },
    ];

    const prompt = buildPagePrompt(page, undefined, glossary);

    expect(prompt).toContain('**Repo Map**');
    expect(prompt).toContain('代码库地图');
    expect(prompt).toContain('项目骨架');
    expect(prompt).toContain('三层递进式代码库摘要');
  });
});
