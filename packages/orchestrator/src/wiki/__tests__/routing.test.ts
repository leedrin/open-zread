import { describe, test, expect } from 'bun:test';
import { buildTutorialPrompt, buildHowToPrompt } from '../../wiki/prompt-builders.js';
import { buildReferencePrompt } from '../../wiki/reference-skeleton.js';
import { buildPagePrompt } from '../../wiki/generate-wiki.js';
import type { WikiPage, PageFacts } from '@open-zread/types';

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

function makeFacts(): PageFacts {
  return {
    pageSlug: 'test-page',
    exports: [{
      name: 'foo',
      kind: 'function',
      signature: 'export function foo(): void',
      file: 'src/foo.ts',
      line: 10,
    }],
    fileSummaries: [],
    internalDeps: [],
    externalDeps: [],
    confidence: 1,
  };
}

describe('docType routing — correct template selected', () => {
  test('tutorial docType produces tutorial prompt', () => {
    const page = makePage({ docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page, makeFacts());
    expect(prompt).toContain('**文档类型**: tutorial');
    expect(prompt).toContain('你将构建什么');
  });

  test('howto docType produces howto prompt', () => {
    const page = makePage({ docType: 'howto' });
    const prompt = buildHowToPrompt(page, makeFacts());
    expect(prompt).toContain('**文档类型**: howto');
    expect(prompt).toContain('如何[动词][对象]');
  });

  test('reference docType produces reference prompt', () => {
    const page = makePage({ docType: 'reference' });
    const prompt = buildReferencePrompt(page, makeFacts());
    expect(prompt).toContain('**文档类型**: reference');
    expect(prompt).toContain('禁止增删 API');
  });

  test('explanation docType produces explanation prompt', () => {
    const page = makePage({ docType: 'explanation' });
    const prompt = buildPagePrompt(page, makeFacts());
    expect(prompt).toContain('开源架构师和代码库领航员');
  });

  test('undefined docType defaults to explanation prompt', () => {
    const page = makePage();
    const prompt = buildPagePrompt(page, makeFacts());
    expect(prompt).toContain('开源架构师和代码库领航员');
  });

  test('reference prompt contains API skeleton from facts', () => {
    const page = makePage({ docType: 'reference' });
    const facts = makeFacts();
    const prompt = buildReferencePrompt(page, facts);
    expect(prompt).toContain('API 骨架');
    expect(prompt).toContain('`foo`');
    expect(prompt).toContain('src/foo.ts#L10');
  });

  test('tutorial prompt does not contain reference skeleton', () => {
    const page = makePage({ docType: 'tutorial' });
    const prompt = buildTutorialPrompt(page, makeFacts());
    expect(prompt).not.toContain('API 骨架');
  });

  test('howto prompt does not contain reference skeleton', () => {
    const page = makePage({ docType: 'howto' });
    const prompt = buildHowToPrompt(page, makeFacts());
    expect(prompt).not.toContain('API 骨架');
  });
});
