import { describe, test, expect } from 'bun:test';
import type { WikiPage } from '@open-zread/types';

describe('WikiPage docType field', () => {
  test('page with docType is valid WikiPage', () => {
    const page: WikiPage = {
      slug: 'quick-start',
      title: '快速上手',
      file: 'quick-start.md',
      section: '上手教程',
      level: 'Beginner',
      docType: 'tutorial',
      associatedFiles: ['src/index.ts'],
    };
    expect(page.docType).toBe('tutorial');
  });

  test('page without docType defaults to explanation', () => {
    const page: WikiPage = {
      slug: 'core-arch',
      title: '核心架构',
      file: 'core-arch.md',
      section: '核心引擎',
      level: 'Advanced',
    };
    expect(page.docType).toBeUndefined();
    expect(page.docType ?? 'explanation').toBe('explanation');
  });

  test('all four docType values are valid', () => {
    const types: Array<NonNullable<WikiPage['docType']>> = [
      'tutorial', 'howto', 'reference', 'explanation',
    ];
    for (const dt of types) {
      const page: WikiPage = {
        slug: `test-${dt}`,
        title: `Test ${dt}`,
        file: `test-${dt}.md`,
        section: 'test',
        level: 'Intermediate',
        docType: dt,
      };
      expect(page.docType).toBe(dt);
    }
  });

  test('docType and level are orthogonal', () => {
    const page: WikiPage = {
      slug: 'ref-core',
      title: 'Core API Reference',
      file: 'ref-core.md',
      section: 'API 参考',
      level: 'Advanced',
      docType: 'reference',
    };
    expect(page.docType).toBe('reference');
    expect(page.level).toBe('Advanced');
  });
});
