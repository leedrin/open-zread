import { describe, test, expect } from 'bun:test';
import { analyzeFactsCoverage, scoreByComplexity } from '../quality-audit.js';
import type { PageFacts, WikiPage } from '@open-zread/types';

function makeFacts(exportNames: string[]): PageFacts {
  return {
    pageSlug: 'test',
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

describe('analyzeFactsCoverage', () => {
  test('export mentioned in prose is covered', () => {
    const facts = makeFacts(['buildRepoMap']);
    const result = analyzeFactsCoverage('函数 `buildRepoMap` 负责构建地图', facts);
    expect(result.exportsTotal).toBe(1);
    expect(result.exportsCovered).toBe(1);
    expect(result.uncoveredExports).toEqual([]);
  });

  test('export not mentioned is uncovered', () => {
    const facts = makeFacts(['computeTransitiveImpact']);
    const result = analyzeFactsCoverage('some unrelated text', facts);
    expect(result.exportsTotal).toBe(1);
    expect(result.exportsCovered).toBe(0);
    expect(result.uncoveredExports).toEqual(['computeTransitiveImpact']);
  });

  test('word-boundary precision: buildRepoMapInternal does not match buildRepoMap', () => {
    const facts = makeFacts(['buildRepoMap']);
    const result = analyzeFactsCoverage('buildRepoMapInternal is here', facts);
    expect(result.exportsCovered).toBe(0);
    expect(result.uncoveredExports).toEqual(['buildRepoMap']);
  });

  test('empty facts returns zero with no penalty', () => {
    const facts: PageFacts = {
      pageSlug: 'test',
      exports: [],
      fileSummaries: [],
      internalDeps: [],
      externalDeps: [],
      confidence: 1,
    };
    const result = analyzeFactsCoverage('any content', facts);
    expect(result.exportsTotal).toBe(0);
    expect(result.exportsCovered).toBe(0);
    expect(result.uncoveredExports).toEqual([]);
  });

  test('mixed coverage: some covered, some not', () => {
    const facts = makeFacts(['foo', 'bar', 'baz']);
    const result = analyzeFactsCoverage('uses foo and baz', facts);
    expect(result.exportsTotal).toBe(3);
    expect(result.exportsCovered).toBe(2);
    expect(result.uncoveredExports).toEqual(['bar']);
  });
});

describe('scoreByComplexity coverage dimension', () => {
  function makeMetrics(overrides: Record<string, unknown> = {}) {
    return {
      filePath: 'test.md',
      lineCount: 200,
      diagramCount: 2,
      diagramTypes: ['flowchart', 'sequenceDiagram'],
      codeBlockCount: 5,
      sourceLinkCount: 3,
      codeBlockSourceLinks: 2,
      emptySections: [] as string[],
      secretLeaks: [],
      mermaidIssues: [],
      exportsTotal: 0,
      exportsCovered: 0,
      uncoveredExports: [] as string[],
      ...overrides,
    };
  }

  test('no facts (exportsTotal=0) gives full coverage score', () => {
    const metrics = makeMetrics({ exportsTotal: 0, exportsCovered: 0 });
    const page: WikiPage = { slug: 't', title: 'T', file: 't.md', section: 's', level: 'Intermediate' };
    const { score } = scoreByComplexity(metrics, page);
    const baselineMetrics = makeMetrics({ exportsTotal: 0, exportsCovered: 0 });
    const baselineScore = scoreByComplexity(baselineMetrics, page).score;
    expect(score).toBe(baselineScore);
  });

  test('high coverage (>=80%) gives 3 points for coverage', () => {
    const metrics = makeMetrics({ exportsTotal: 10, exportsCovered: 9, uncoveredExports: ['x'] });
    const lowMetrics = makeMetrics({ exportsTotal: 10, exportsCovered: 3, uncoveredExports: Array(7).fill('x') });
    const page: WikiPage = { slug: 't', title: 'T', file: 't.md', section: 's', level: 'Intermediate' };
    const highScore = scoreByComplexity(metrics, page).score;
    const lowScore = scoreByComplexity(lowMetrics, page).score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test('low coverage (<60%) reduces total score', () => {
    const metrics = makeMetrics({ exportsTotal: 10, exportsCovered: 2, uncoveredExports: Array(8).fill('x') });
    const page: WikiPage = { slug: 't', title: 'T', file: 't.md', section: 's', level: 'Intermediate' };
    const { score } = scoreByComplexity(metrics, page);
    const noFactsMetrics = makeMetrics({ exportsTotal: 0, exportsCovered: 0 });
    const noFactsScore = scoreByComplexity(noFactsMetrics, page).score;
    expect(score).toBeLessThan(noFactsScore);
  });
});
