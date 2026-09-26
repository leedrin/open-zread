import { describe, expect, test } from 'bun:test';
import { resolveMarkdownLinkTarget } from '../lib/markdown-links';

describe('resolveMarkdownLinkTarget', () => {
  test('resolves Markdown links and fragments relative to the current document', () => {
    expect(resolveMarkdownLinkTarget('docs/guides/intro.md', '../README.md#usage'))
      .toEqual({ path: 'docs/README.md', fragment: 'usage' });
    expect(resolveMarkdownLinkTarget('docs/guides/intro.md', '#overview'))
      .toEqual({ path: 'docs/guides/intro.md', fragment: 'overview' });
    expect(resolveMarkdownLinkTarget('docs/guides/intro.md', './api%20reference.ts?raw=1'))
      .toEqual({ path: 'docs/guides/api reference.ts' });
  });

  test('rejects links that could escape the project or smuggle path separators', () => {
    expect(resolveMarkdownLinkTarget('README.md', '../outside.md')).toBeNull();
    expect(resolveMarkdownLinkTarget('docs/intro.md', '../../outside.md')).toBeNull();
    expect(resolveMarkdownLinkTarget('docs/intro.md', '%2e%2e%2foutside.md')).toBeNull();
    expect(resolveMarkdownLinkTarget('docs/intro.md', 'src%5cmain.ts')).toBeNull();
    expect(resolveMarkdownLinkTarget('docs/intro.md', 'file:///C:/secret.txt')).toBeNull();
    expect(resolveMarkdownLinkTarget('docs/intro.md', '//example.com/file.md')).toBeNull();
  });
});
