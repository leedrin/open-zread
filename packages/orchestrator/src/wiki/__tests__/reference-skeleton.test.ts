import { describe, test, expect } from 'bun:test';
import { buildReferenceSkeleton, buildReferencePrompt } from '../reference-skeleton.js';
import type { WikiPage, PageFacts } from '@open-zread/types';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    slug: 'ref-core',
    title: 'Core API Reference',
    file: 'ref-core.md',
    section: 'API 参考',
    level: 'Advanced',
    associatedFiles: ['packages/core/src/'],
    ...overrides,
  };
}

function makeFacts(exports: Partial<PageFacts['exports'][0]>[]): PageFacts {
  return {
    pageSlug: 'ref-core',
    exports: exports.map((e, i) => ({
      name: e.name ?? `export${i}`,
      kind: e.kind ?? 'function',
      signature: e.signature ?? `export function ${e.name ?? `export${i}`}()`,
      file: e.file ?? `src/${e.name ?? `export${i}`}.ts`,
      line: e.line,
      doc: e.doc,
    })),
    fileSummaries: [],
    internalDeps: [],
    externalDeps: [],
    confidence: 1,
  };
}

describe('buildReferenceSkeleton', () => {
  test('renders one row per export', () => {
    const facts = makeFacts([
      { name: 'foo', signature: 'export function foo(x: number): string' },
      { name: 'bar', signature: 'export const bar = 42' },
    ]);
    const skeleton = buildReferenceSkeleton(facts);

    expect(skeleton).toContain('| API | 签名 | 说明 | 源 |');
    expect(skeleton).toContain('`foo`');
    expect(skeleton).toContain('`bar`');
    const lines = skeleton.split('\n');
    expect(lines.length).toBe(4); // header + separator + 2 rows
  });

  test('doc comment seeds description column', () => {
    const facts = makeFacts([
      { name: 'buildRepoMap', doc: 'Builds the three-layer repo map' },
    ]);
    const skeleton = buildReferenceSkeleton(facts);

    expect(skeleton).toContain('Builds the three-layer repo map');
  });

  test('source link includes line number when present', () => {
    const facts = makeFacts([
      { name: 'foo', file: 'src/foo.ts', line: 42 },
    ]);
    const skeleton = buildReferenceSkeleton(facts);

    expect(skeleton).toContain('src/foo.ts#L42');
  });

  test('source link omits anchor when line is absent', () => {
    const facts = makeFacts([
      { name: 'foo', file: 'src/foo.ts' },
    ]);
    const skeleton = buildReferenceSkeleton(facts);

    expect(skeleton).not.toContain('#L');
    expect(skeleton).toContain('[src/foo.ts](src/foo.ts)');
  });

  test('empty exports returns empty string', () => {
    const facts: PageFacts = {
      pageSlug: 'test',
      exports: [],
      fileSummaries: [],
      internalDeps: [],
      externalDeps: [],
      confidence: 1,
    };
    expect(buildReferenceSkeleton(facts)).toBe('');
  });
});

describe('buildReferencePrompt', () => {
  test('embeds skeleton when exports present', () => {
    const page = makePage();
    const facts = makeFacts([{ name: 'foo' }]);
    const prompt = buildReferencePrompt(page, facts);

    expect(prompt).toContain('## 🔴 API 骨架');
    expect(prompt).toContain('`foo`');
  });

  test('no skeleton section when exports empty', () => {
    const page = makePage();
    const facts: PageFacts = {
      pageSlug: 'test',
      exports: [],
      fileSummaries: [],
      internalDeps: [],
      externalDeps: [],
      confidence: 1,
    };
    const prompt = buildReferencePrompt(page, facts);

    expect(prompt).not.toContain('## 🔴 API 骨架');
  });

  test('contains reference-quadrant anti-pattern rules', () => {
    const page = makePage();
    const facts = makeFacts([{ name: 'foo' }]);
    const prompt = buildReferencePrompt(page, facts);

    expect(prompt).toContain('禁止增删 API');
    expect(prompt).toContain('禁止叙述');
  });

  test('contains page metadata', () => {
    const page = makePage();
    const facts = makeFacts([{ name: 'foo' }]);
    const prompt = buildReferencePrompt(page, facts);

    expect(prompt).toContain('**文档类型**: reference');
    expect(prompt).toContain(page.slug);
    expect(prompt).toContain(page.title);
  });

  test('glossary injected when provided', () => {
    const page = makePage();
    const facts = makeFacts([{ name: 'foo' }]);
    const glossary = [{ term: 'RepoMap', definition: '三层地图' }];
    const prompt = buildReferencePrompt(page, facts, glossary);

    expect(prompt).toContain('RepoMap');
    expect(prompt).toContain('三层地图');
  });
});
