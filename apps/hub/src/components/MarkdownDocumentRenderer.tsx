import { createContext, useContext, useEffect, useMemo, useState, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import type { HubWikiAsset } from '@open-zread/hub-contract';
import { MermaidDiagram, WikiCodeBlock } from './OpenZreadReader';

const InsideCodeBlock = createContext(false);
type MarkdownSourcePosition = {
  position?: {
    start?: { line?: number };
    end?: { line?: number };
  };
};

function sourceLineAttributes(node: MarkdownSourcePosition | undefined, lineOffset: number) {
  if (!node?.position?.start?.line || !node.position.end?.line) return {};
  return {
    'data-markdown-source-start-line': node.position.start.line + lineOffset,
    'data-markdown-source-end-line': node.position.end.line + lineOffset,
  };
}

function MarkdownCode({ className, children, ...props }: ComponentProps<'code'>) {
  const isBlock = useContext(InsideCodeBlock);
  const language = className?.match(/language-([^\s]+)/i)?.[1] ?? 'text';
  const source = String(children).replace(/\n$/, '');

  if (isBlock && language.toLowerCase() === 'mermaid') {
    return <MermaidDiagram source={source} />;
  }
  if (isBlock) return <WikiCodeBlock language={language} content={source} />;
  return <code className={className ?? 'wiki-markdown-inline-code'} {...props}>{children}</code>;
}

function safeExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

function removeFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
}

function frontmatterLineOffset(content: string): number {
  const match = content.match(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/);
  return match ? (match[0].match(/\n/g)?.length ?? 0) : 0;
}

export interface MarkdownDocumentRendererProps {
  content: string;
  projectId: string;
  documentPath: string;
  readAsset: (projectId: string, documentPath: string, assetPath: string) => Promise<HubWikiAsset>;
  onOpenRelativeLink?: (href: string) => void;
  onOpenExternalLink?: (href: string) => void;
}

function imageSources(content: string): string[] {
  const sources: string[] = [];
  const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of content.matchAll(pattern)) {
    const source = match[1];
    if (source && !safeExternalHref(source) && !sources.includes(source)) sources.push(source);
  }
  return sources;
}

export function MarkdownDocumentRenderer({ content, projectId, documentPath, readAsset, onOpenRelativeLink, onOpenExternalLink }: MarkdownDocumentRendererProps) {
  const references = useMemo(() => imageSources(content), [content]);
  const lineOffset = frontmatterLineOffset(content);
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setLoadedImages({});
    void Promise.all(references.map(async (reference) => {
      try {
        const asset = await readAsset(projectId, documentPath, reference);
        const url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }));
        urls.push(url);
        return [reference, url] as const;
      } catch {
        return null;
      }
    })).then((images) => {
      if (active) setLoadedImages(Object.fromEntries(images.filter((image): image is readonly [string, string] => image !== null)));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documentPath, projectId, readAsset, references]);

  const components: Components = {
    pre: ({ node, children }) => <div {...sourceLineAttributes(node, lineOffset)}><InsideCodeBlock.Provider value><>{children}</></InsideCodeBlock.Provider></div>,
    code: MarkdownCode,
    p: ({ node, ...props }) => <p {...sourceLineAttributes(node, lineOffset)} {...props} />,
    li: ({ node, ...props }) => <li {...sourceLineAttributes(node, lineOffset)} {...props} />,
    blockquote: ({ node, ...props }) => <blockquote {...sourceLineAttributes(node, lineOffset)} {...props} />,
    h1: ({ id, node, children, ...props }) => <h1 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h1>,
    h2: ({ id, node, children, ...props }) => <h2 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h2>,
    h3: ({ id, node, children, ...props }) => <h3 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h3>,
    h4: ({ id, node, children, ...props }) => <h4 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h4>,
    h5: ({ id, node, children, ...props }) => <h5 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h5>,
    h6: ({ id, node, children, ...props }) => <h6 {...sourceLineAttributes(node, lineOffset)} id={id} data-markdown-heading="true" {...props}>{children}</h6>,
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      if (safeExternalHref(href)) {
        return onOpenExternalLink
          ? <button type="button" className="wiki-reader-inline-link" data-testid="markdown-external-link" onClick={() => onOpenExternalLink(href)}>{children}</button>
          : <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
        return <span className="wiki-reader-image-placeholder" title="不支持此类链接">{children}</span>;
      }
      return onOpenRelativeLink
        ? <button type="button" className="wiki-reader-inline-link" data-testid="markdown-relative-link" onClick={() => onOpenRelativeLink(href)}>{children}</button>
        : <span className="wiki-reader-image-placeholder" title="此相对链接尚不可用">{children}</span>;
    },
    img: ({ src, alt }) => {
      if (src && /^https?:\/\//i.test(src)) {
        return onOpenExternalLink
          ? <button type="button" className="wiki-reader-inline-link" data-testid="markdown-external-image-link" onClick={() => onOpenExternalLink(src)}>在系统浏览器中打开外部图片：{alt || src}</button>
          : <span className="wiki-reader-image-placeholder">外部图片未自动加载：{alt || src}</span>;
      }
      const imageSource = src ? loadedImages[src] : undefined;
      if (imageSource) return <img className="wiki-reader-image" src={imageSource} alt={alt ?? ''} loading="lazy" />;
      return <span className="wiki-reader-image-placeholder">Image: {alt || src || '未命名图片'}</span>;
    },
    table: ({ node, children }) => <div {...sourceLineAttributes(node, lineOffset)} className="wiki-reader-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}><table className="wiki-reader-table">{children}</table></div>,
    td: ({ node, ...props }) => <td {...sourceLineAttributes(node, lineOffset)} {...props} />,
    th: ({ node, ...props }) => <th {...sourceLineAttributes(node, lineOffset)} {...props} />,
    input: ({ type, checked }) => <input type={type} checked={checked} disabled readOnly aria-label="Markdown task item" />,
  };

  return (
    <div className="wiki-reader-markdown markdown-document-renderer" data-testid="markdown-rendered-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
        {removeFrontmatter(content)}
      </ReactMarkdown>
    </div>
  );
}
