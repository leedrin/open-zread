import { describe, test, expect } from 'bun:test';
import { buildTutorialPrompt, buildHowToPrompt } from '../prompt-builders.js';
import type { WikiPage, PageFacts, GlossaryTerm } from '@open-zread/types';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    slug: 'test-page',
    title: '测试页面',
    file: 'test-page.md',
    section: '测试章节',
    level: 'Beginner',
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

describe('buildTutorialPrompt', () => {
  test('contains single-path instruction', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page);

    expect(prompt).toContain('单一路径');
    expect(prompt).toContain('禁止"或者你也可以');
  });

  test('contains cross-quadrant links', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page);

    expect(prompt).toContain('跨象限互链');
    expect(prompt).toContain('Explanation');
    expect(prompt).toContain('API 参考文档');
  });

  test('glossary injected when provided', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const glossary: GlossaryTerm[] = [
      { term: 'Repo Map', definition: '三层地图' },
    ];
    const prompt = buildTutorialPrompt(page, undefined, glossary);

    expect(prompt).toContain('Repo Map');
    expect(prompt).toContain('三层地图');
  });

  test('docType shown as tutorial', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page);

    expect(prompt).toContain('**文档类型**: tutorial');
  });

  test('facts section injected when exports present', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const facts = makeFacts(['buildSomething']);
    const prompt = buildTutorialPrompt(page, facts);

    expect(prompt).toContain('buildSomething');
    expect(prompt).toContain('权威数据源');
  });

  test('no facts section when no facts', () => {
    const page = makePage({ section: '上手教程', docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page);

    expect(prompt).not.toContain('权威数据源');
  });
});

describe('buildHowToPrompt', () => {
  test('contains task-title format instruction', () => {
    const page = makePage({ section: '操作指南', docType: 'howto', title: '如何新增 Provider' });
    const prompt = buildHowToPrompt(page);

    expect(prompt).toContain('如何[动词][对象]');
  });

  test('contains verification and troubleshooting requirements', () => {
    const page = makePage({ section: '操作指南', docType: 'howto' });
    const prompt = buildHowToPrompt(page);

    expect(prompt).toContain('验证');
    expect(prompt).toContain('常见问题与排错');
  });

  test('contains cross-quadrant links', () => {
    const page = makePage({ section: '操作指南', docType: 'howto' });
    const prompt = buildHowToPrompt(page);

    expect(prompt).toContain('跨象限互链');
    expect(prompt).toContain('教程文档');
    expect(prompt).toContain('API 参考文档');
  });

  test('docType shown as howto', () => {
    const page = makePage({ section: '操作指南', docType: 'howto' });
    const prompt = buildHowToPrompt(page);

    expect(prompt).toContain('**文档类型**: howto');
  });

  test('glossary injected when provided', () => {
    const page = makePage({ section: '操作指南', docType: 'howto' });
    const glossary: GlossaryTerm[] = [
      { term: 'Provider', definition: 'LLM 提供者' },
    ];
    const prompt = buildHowToPrompt(page, undefined, glossary);

    expect(prompt).toContain('Provider');
    expect(prompt).toContain('LLM 提供者');
  });
});
