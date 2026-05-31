import type { GlossaryTerm, WikiPage } from '@open-zread/types';

export const GLOSSARY_PAGE_ID = 'glossary-page';
export const GLOSSARY_PAGE_SLUG = 'glossary';
export const GLOSSARY_PAGE_SECTION = '术语表';
export const GLOSSARY_PAGE_FILE = 'glossary.md';

/** Deterministically render the unified glossary + bidirectional term<->page mapping. No LLM. */
export function renderGlossaryPage(glossary: GlossaryTerm[], pages: WikiPage[]): string {
  const active = pages.filter((p) => p.status !== 'tombstone');
  const lines: string[] = ['# 统一术语表', ''];

  if (glossary.length === 0) {
    lines.push('（暂无术语）', '');
    return lines.join('\n');
  }

  for (const term of glossary) {
    lines.push(`## ${term.term}`, '');
    if (term.aliases && term.aliases.length > 0) {
      lines.push(`**别名**：${term.aliases.join('、')}`, '');
    }
    lines.push(term.definition, '');

    const canonical = term.canonicalPage
      ? active.find((p) => p.slug === term.canonicalPage)
      : undefined;
    if (canonical) {
      lines.push(`**权威页面**：[${canonical.title}](${canonical.section}/${canonical.file})`, '');
    }

    const appearsIn = active.filter((p) => p.concepts?.includes(term.term));
    if (appearsIn.length > 0) {
      lines.push('**出现于**：');
      for (const p of appearsIn) {
        lines.push(`- [${p.title}](${p.section}/${p.file})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Ensure a reserved, stable glossary page exists in the catalog. Idempotent. */
export function ensureGlossaryPage(pages: WikiPage[]): WikiPage[] {
  if (pages.some((p) => p.id === GLOSSARY_PAGE_ID)) return pages;
  const glossaryPage: WikiPage = {
    id: GLOSSARY_PAGE_ID,
    slug: GLOSSARY_PAGE_SLUG,
    title: '统一术语表',
    file: GLOSSARY_PAGE_FILE,
    section: GLOSSARY_PAGE_SECTION,
    level: 'Beginner',
    docType: 'reference',
    origin: 'ai',
    locked: false,
    status: 'active',
  };
  return [...pages, glossaryPage];
}
