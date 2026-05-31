import { describe, test, expect } from 'bun:test';
import { buildRegeneratePrompt } from '../regenerate-with-feedback.js';
import type { WikiPage } from '@open-zread/types';
import type { DocMetrics } from '@open-zread/utils';

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

function makeMetrics(overrides: Partial<DocMetrics> = {}): DocMetrics {
  return {
    filePath: 'test.md',
    lineCount: 200,
    diagramCount: 1,
    diagramTypes: ['flowchart'],
    codeBlockCount: 5,
    sourceLinkCount: 3,
    codeBlockSourceLinks: 5,
    emptySections: [],
    secretLeaks: [],
    mermaidIssues: [],
    exportsTotal: 0,
    exportsCovered: 0,
    uncoveredExports: [],
    ...overrides,
  };
}

describe('buildRegeneratePrompt', () => {
  test('lists only failing dimensions', () => {
    const page = makePage();
    const metrics = makeMetrics({ diagramCount: 0 });

    const prompt = buildRegeneratePrompt(page, metrics);

    expect(prompt).toContain('[缺图]');
    expect(prompt).not.toContain('[缺溯源]');
    expect(prompt).not.toContain('[行数不足]');
  });

  test('lists uncovered exports by name', () => {
    const page = makePage();
    const metrics = makeMetrics({ uncoveredExports: ['foo', 'bar'] });

    const prompt = buildRegeneratePrompt(page, metrics);

    expect(prompt).toContain('foo');
    expect(prompt).toContain('bar');
    expect(prompt).toContain('[未覆盖 API]');
  });

  test('preserve-correct instruction is present', () => {
    const page = makePage();
    const metrics = makeMetrics();

    const prompt = buildRegeneratePrompt(page, metrics);

    expect(prompt).toContain('保持已正确的部分不变');
  });

  test('mermaid errors are listed', () => {
    const page = makePage();
    const metrics = makeMetrics({
      mermaidIssues: [
        { severity: 'error', line: 5, message: 'bad syntax', suggestion: 'fix it' },
      ],
    });

    const prompt = buildRegeneratePrompt(page, metrics);

    expect(prompt).toContain('[Mermaid 错误]');
  });

  test('all passing metrics produce no specific feedback bullets', () => {
    const page = makePage({ level: 'Advanced' });
    const metrics = makeMetrics({
      lineCount: 400,
      diagramCount: 2,
      codeBlockSourceLinks: 5,
      codeBlockCount: 5,
    });

    const prompt = buildRegeneratePrompt(page, metrics);

    expect(prompt).not.toContain('[缺图]');
    expect(prompt).not.toContain('[缺溯源]');
    expect(prompt).not.toContain('[行数不足]');
    expect(prompt).not.toContain('[未覆盖 API]');
    expect(prompt).not.toContain('[Mermaid 错误]');
  });
});
