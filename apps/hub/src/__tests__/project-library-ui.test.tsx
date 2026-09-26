import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, test } from 'bun:test';
import type { HubHealth, HubProject } from '@open-zread/hub-contract';
import HubApp from '../App';
import { MermaidDiagram, WikiCodeBlock, articleHeadingScrollTop, parseMarkdownBlocks, sourceLanguage, sourceLinkTarget } from '../components/OpenZreadReader';
import { MarkdownDocumentRenderer } from '../components/MarkdownDocumentRenderer';
import { createHubApplicationService, type HubTransport } from '../lib/application-service';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('');
}

test('Wiki heading navigation computes an exact position inside the article scroller', () => {
  expect(articleHeadingScrollTop(420, 120, 860)).toBe(1144);
});

test('standalone Markdown reading renders GFM, Mermaid and highlighted code without executing raw HTML', async () => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<MarkdownDocumentRenderer content={'# Guide\n\n| Name | State |\n| --- | --- |\n| Wiki | ready |\n\n- [x] indexed\n\n```lua\nlocal ok = true\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n<script>alert(1)</script>'} projectId={firstProject.id} documentPath="docs/guide.md" readAsset={async () => ({ path: 'assets/example.png', mimeType: 'image/png', bytes: [] })} />);
  });

  expect(renderer?.root.findByProps({ 'data-testid': 'markdown-rendered-content' })).toBeDefined();
  expect(renderer?.root.findByProps({ 'data-markdown-heading': 'true' }).props.id).toBe('guide');
  expect(renderer?.root.findByProps({ className: 'wiki-reader-table' })).toBeDefined();
  expect(renderer?.root.findByProps({ 'data-language': 'lua' })).toBeDefined();
  expect(renderer?.root.findByProps({ 'data-testid': 'mermaid-block' })).toBeDefined();
  expect(renderer?.root.findAllByType('script')).toHaveLength(0);
  await act(async () => renderer?.unmount());
});

test('Markdown rendered blocks retain original source line positions after front matter', async () => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<MarkdownDocumentRenderer
      content={'---\ntitle: Guide\n---\n# Overview\n\nThe target phrase is here.'}
      projectId={firstProject.id}
      documentPath="docs/guide.md"
      readAsset={async () => ({ path: '', mimeType: 'image/png', bytes: [] })}
    />);
  });
  const heading = renderer?.root.findByProps({ 'data-markdown-heading': 'true' });
  const paragraph = renderer?.root.findAllByType('p').find((item) => textContent(item).includes('target phrase'));
  expect(heading?.props['data-markdown-source-start-line']).toBe(4);
  expect(paragraph?.props['data-markdown-source-start-line']).toBe(6);
  await act(async () => renderer?.unmount());
});

test('Markdown external links are delegated to an explicit safe opener callback', async () => {
  let renderer: ReactTestRenderer | undefined;
  const opened: string[] = [];
  await act(async () => {
    renderer = create(<MarkdownDocumentRenderer
      content={'[Website](https://example.com/docs) [Email](mailto:team@example.com) [Unsafe](javascript:alert(1)) ![Remote](https://example.com/image.png)'}
      projectId={firstProject.id}
      documentPath="docs/guide.md"
      readAsset={async () => ({ path: '', mimeType: 'image/png', bytes: [] })}
      onOpenExternalLink={(href) => opened.push(href)}
    />);
  });
  const externalLinks = renderer?.root.findAllByProps({ 'data-testid': 'markdown-external-link' }) ?? [];
  expect(externalLinks).toHaveLength(2);
  await act(async () => externalLinks[0]?.props.onClick());
  await act(async () => externalLinks[1]?.props.onClick());
  const externalImage = renderer?.root.findByProps({ 'data-testid': 'markdown-external-image-link' });
  await act(async () => externalImage?.props.onClick());
  expect(opened).toEqual(['https://example.com/docs', 'mailto:team@example.com', 'https://example.com/image.png']);
  expect(renderer?.root.findAllByType('img')).toHaveLength(0);
  expect(renderer?.root.findAllByType('script')).toHaveLength(0);
  await act(async () => renderer?.unmount());
});

test('Markdown images load through the current document-relative asset service and release object URLs', async () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const revoked: string[] = [];
  const requests: Array<{ projectId: string; documentPath: string; assetPath: string }> = [];
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:markdown-image' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => revoked.push(url) });
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(<MarkdownDocumentRenderer
        content="![Diagram](../assets/diagram.png)"
        projectId={firstProject.id}
        documentPath="docs/guide.md"
        readAsset={async (projectId, documentPath, assetPath) => {
          requests.push({ projectId, documentPath, assetPath });
          return { path: 'assets/diagram.png', mimeType: 'image/png', bytes: [137, 80, 78, 71] };
        }}
      />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(requests).toEqual([{ projectId: firstProject.id, documentPath: 'docs/guide.md', assetPath: '../assets/diagram.png' }]);
    expect(renderer?.root.findByType('img').props.src).toBe('blob:markdown-image');
    await act(async () => renderer?.unmount());
    expect(revoked).toEqual(['blob:markdown-image']);
  } finally {
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});

test('Wiki fenced code blocks render language-token highlighting without inline-code chip styles', async () => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<WikiCodeBlock language="typescript" content="const answer: number = 42;" />);
  });
  const codeBlock = renderer?.root.findByProps({ 'data-testid': 'wiki-code-block' });
  expect(codeBlock?.props['data-language']).toBe('typescript');
  expect(codeBlock?.findAllByType('span').some((token) => token.props.className !== 'linenumber' && token.props.style?.color)).toBe(true);
  await act(async () => renderer?.unmount());
});

test('Wiki code blocks and linked Lua source files use Lua syntax highlighting', async () => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<WikiCodeBlock language="lua" content="local function greet(name)\n  return 'hello ' .. name\nend" />);
  });
  const codeBlock = renderer?.root.findByProps({ 'data-testid': 'wiki-code-block' });
  expect(codeBlock?.props['data-language']).toBe('lua');
  expect(codeBlock?.findAllByType('span').some((token) => token.props.className !== 'linenumber' && token.props.style?.color)).toBe(true);
  expect(sourceLinkTarget('Assets/Scripts/player.lua')).toEqual({ path: 'Assets/Scripts/player.lua' });
  expect(sourceLanguage('Assets/Scripts/player.lua')).toBe('lua');
  await act(async () => renderer?.unmount());
});

const healthyResponse: HubHealth = {
  appVersion: '0.1.0-test',
  runtime: 'tauri',
  os: 'windows',
  service: { name: 'Hub Application Service', status: 'healthy' },
  runner: { status: 'available', version: '1.2.2', executablePath: 'open-zread.exe' },
  providers: [
    {
      provider: 'open_zread',
      content: { status: 'project_scoped' },
      generator: {
        status: 'available',
        version: '1.2.2',
        executablePath: 'open-zread.exe',
        executableSource: 'embedded',
        diagnostics: [],
      },
      configSource: 'hub_shared',
      capabilities: {
        generate: true,
        regenerate: true,
        sync: false,
        login: false,
        customApiKeyLogin: false,
        machineReadable: false,
        unattended: false,
        existingDraftActions: false,
        skipFailedPages: false,
        cliSelfUpdate: false,
        structuredProgress: false,
        incrementalWikiUpdate: false,
      },
    },
    {
      provider: 'zread',
      content: { status: 'project_scoped' },
      generator: {
        status: 'not_configured',
        version: 'unknown',
        executablePath: 'Not detected',
        executableSource: 'not_detected',
        diagnostics: [],
      },
      configSource: 'not_configured',
      capabilities: {
        generate: false,
        regenerate: false,
        sync: false,
        login: false,
        customApiKeyLogin: false,
        machineReadable: false,
        unattended: false,
        existingDraftActions: false,
        skipFailedPages: false,
        cliSelfUpdate: false,
        structuredProgress: false,
        incrementalWikiUpdate: false,
      },
    },
  ],
};

const firstProject: HubProject = {
  id: 'project-1',
  name: 'Alpha project',
  path: 'C:\\Work\\Alpha',
  previousPaths: [],
  sourceControl: 'git',
  availability: 'available',
  wiki: { openZread: 'readable', zread: 'readable' },
  favorite: false,
};

const secondProject: HubProject = {
  id: 'project-2',
  name: 'Beta project',
  path: 'C:\\Work\\Beta',
  previousPaths: [],
  sourceControl: 'non_git',
  availability: 'missing',
  availabilityReason: 'The registered directory does not exist.',
  wiki: { openZread: 'unavailable', zread: 'unavailable' },
  favorite: false,
};

function createLibraryService(
  commands: Array<{ command: string; args?: Record<string, unknown> }>,
  copied: string[],
  onTaskListener?: (listener: (event: { payload: unknown }) => void) => void,
  selectedDirectory = 'D:\\Projects\\Beta',
  initialProjects: HubProject[] = [firstProject, secondProject],
  stableMarkdownTree = false,
  moveMarkdownSameName = false,
  partialMarkdownAfterRefresh = false,
  conflictMarkdownSave = false,
  staleMarkdownSearchHit = false,
  wikiInstances: Array<{ wikiId: string; provider: 'open_zread' | 'zread'; sourceRoot: string; label: string; status: 'readable' | 'partial' | 'invalid' }> = [],
) {
  let projects = initialProjects;
  let pendingOperation = 'edit';
  let markdownScanCount = 0;
  let markdownContent = '# Guide\n\n[Read me](README.md#usage)\n\n[Outside](../../outside.md)';
  let markdownRevision = 'guide-rev-1';
  const transport: HubTransport = {
    invoke: async (command, args) => {
      commands.push({ command, args });
      if (command === 'get_hub_health') return healthyResponse;
      if (command === 'list_hub_projects') return projects;
      if (command === 'list_hub_project_wikis') return {
        projectId: args?.projectId,
        instances: wikiInstances,
        scanComplete: true,
        scannedDirectories: 1,
      };
      if (command === 'locate_hub_project_wikis') return {
        projectId: args?.projectId,
        instances: [{
          wikiId: 'open_zread@framework',
          provider: 'open_zread',
          sourceRoot: 'framework',
          label: 'framework · OpenZread',
          status: 'readable',
        }],
        scanComplete: true,
        scannedDirectories: 2,
      };
      if (command === 'list_hub_project_markdown') {
        markdownScanCount += 1;
        const name = stableMarkdownTree || markdownScanCount === 1 ? 'guide.md' : 'refreshed.md';
        const movedFolder = markdownScanCount === 1 ? 'a' : 'b';
        const roots = moveMarkdownSameName
          ? [{
            kind: 'directory',
            name: 'docs',
            relativePath: 'docs',
            children: [{
              kind: 'directory',
              name: movedFolder,
              relativePath: `docs/${movedFolder}`,
              children: [{ kind: 'file', name: 'guide.md', relativePath: `docs/${movedFolder}/guide.md`, title: 'Guide' }],
            }],
          }]
          : stableMarkdownTree
            ? [{
              kind: 'directory',
              name: 'docs',
              relativePath: 'docs',
              children: [{ kind: 'file', name, relativePath: `docs/${name}`, title: markdownContent.match(/^#\s+(.+)$/m)?.[1] ?? 'Guide' }],
            }]
            : [{
              kind: 'file',
              name,
              relativePath: name,
              title: name === 'guide.md' ? markdownContent.match(/^#\s+(.+)$/m)?.[1] ?? 'Guide' : name,
            }];
        return {
          projectId: args?.projectId,
          roots,
          scanComplete: !(partialMarkdownAfterRefresh && markdownScanCount > 1),
          scannedDirectories: 1,
          scannedFiles: 1,
          errors: [],
          ...(partialMarkdownAfterRefresh && markdownScanCount > 1
            ? { warning: 'Markdown 扫描达到测试预算，结果不完整。' }
            : {}),
        };
      }
      if (command === 'read_hub_project_markdown') {
        const relativePath = String(args?.relativePath);
        const content = staleMarkdownSearchHit ? '# Updated after search' : markdownContent;
        return {
          projectId: args?.projectId,
          relativePath,
          title: relativePath === 'README.md' ? 'Usage' : content.match(/^#\s+(.+)$/m)?.[1] ?? 'Guide',
          content: relativePath === 'README.md'
            ? '# Usage\n\n[Lua source](src/main.lua)'
            : content,
          revision: relativePath === 'README.md' ? 'usage-rev-1' : markdownRevision,
        };
      }
      if (command === 'save_hub_project_markdown') {
        if (conflictMarkdownSave) {
          markdownContent = '# External edit';
          markdownRevision = 'external-rev-2';
        }
        if (args?.baseRevision !== markdownRevision) throw new Error('Markdown file changed since it was opened.');
        markdownContent = String(args?.content);
        markdownRevision = 'guide-rev-2';
        return {
          projectId: args?.projectId,
          relativePath: args?.relativePath,
          title: 'Updated Guide',
          content: markdownContent,
          revision: markdownRevision,
        };
      }
      if (command === 'read_hub_project_markdown_source') {
        return { path: String(args?.sourcePath), content: 'local answer = 42\n' };
      }
      if (command === 'ask_hub_project_markdown') {
        return {
          projectId: args?.projectId,
          path: args?.relativePath,
          title: 'Guide',
          model: 'test-provider/test-model',
          answer: 'Use a small, explicit interface.',
        };
      }
      if (command === 'set_hub_project_favorite') {
        const updated = { ...firstProject, favorite: args?.favorite === true };
        projects = projects.map((project) => project.id === updated.id ? updated : project);
        return updated;
      }
      if (command === 'rename_hub_project') {
        const updated = { ...firstProject, name: String(args?.name) };
        projects = projects.map((project) => project.id === updated.id ? updated : project);
        return updated;
      }
      if (command === 'relocate_hub_project') {
        const updated = {
          ...secondProject,
          path: String(args?.path),
          previousPaths: [secondProject.path],
          availability: 'available' as const,
        };
        projects = projects.map((project) => project.id === updated.id ? updated : project);
        return updated;
      }
      if (command === 'open_hub_project_folder') {
        return { ...firstProject, lastOpenedAt: '123' };
      }
      if (command === 'open_hub_project_terminal') {
        return { ...firstProject, lastOpenedAt: '124' };
      }
      if (command === 'read_hub_open_zread_wiki') {
        return {
          provider: 'open_zread',
          wikiId: args?.wikiId ?? 'open_zread@.',
          sourceRoot: args?.wikiId === 'open_zread@framework' ? 'framework' : '.',
          status: 'partial',
          catalog: {
            id: 'catalog-1',
            generatedAt: '2026-09-17T00:00:00.000Z',
            language: 'zh',
            native: { providerMeta: { opaque: 'keep-me' } },
          },
          pages: [
            {
              slug: 'architecture',
              title: '架构设计',
              file: 'architecture.md',
              section: '核心',
              associatedFiles: ['src/main.ts'],
              status: 'readable',
              content: '# 架构设计\n\n| Provider | 状态 | 说明 |\n|:--|--:|:--:|\n| OpenZread | 可读 | `本地 Wiki` |\n\n```mermaid\nflowchart LR\n  A[项目] --> B[Wiki]\n```',
              native: { providerOnly: true },
            },
            {
              slug: 'broken',
              title: '损坏页面',
              file: 'broken.md',
              section: '核心',
              associatedFiles: [],
              status: 'missing',
              error: 'The Markdown page is missing.',
              native: { providerOnly: 'kept' },
            },
            {
              slug: 'details',
              title: '补充说明',
              file: 'details.md',
              section: '附录',
              associatedFiles: [],
              status: 'readable',
              content: '# 补充说明',
              native: { providerOnly: 'details' },
            },
          ],
        };
      }
      if (command === 'start_hub_open_zread_task') {
        return {
          taskId: 'task-1',
          kind: args?.operation === 'sync' ? 'update' : 'generation',
          status: 'running',
          projectId: String(args?.projectId),
          wikiId: String(args?.wikiId),
          provider: 'open_zread',
          operation: args?.operation,
          model: 'Hub shared model configuration',
          startedAt: '1720000000000',
        };
      }
      if (command === 'preview_hub_wiki_change') {
        pendingOperation = 'edit';
        return {
          changeSetId: 'change-1',
          projectId: String(args?.projectId),
          provider: args?.provider,
          slug: String(args?.slug),
          relativePath: '核心/architecture.md',
          before: '# 架构设计',
          after: String(args?.content),
          status: 'preview',
          createdAt: '1720000000000',
          operation: 'edit',
          baseRevision: 'page-revision',
          versionPointer: null,
          files: [{ relativePath: '核心/architecture.md', action: 'update', before: '# 架构设计', after: String(args?.content), baseRevision: 'page-revision' }],
          validation: { status: 'passed', checks: ['Page content is unchanged since preview.'], warnings: [] },
        };
      }
      if (command === 'preview_hub_wiki_structure_change') {
        const request = args?.request as { operation: string; pages?: Array<{ slug: string }> };
        pendingOperation = request.operation;
        return {
          changeSetId: 'structure-change-1',
          projectId: String(args?.projectId),
          provider: args?.provider,
          slug: request.pages?.[0]?.slug ?? 'architecture',
          relativePath: 'Core/overview.md',
          before: '',
          after: '# New page',
          status: 'preview',
          createdAt: '1720000000000',
          operation: request.operation,
          baseRevision: 'catalog-rev',
          versionPointer: null,
          files: [
            { relativePath: 'Core/overview.md', action: 'create', before: null, after: '# New page', baseRevision: 'absent' },
            { relativePath: 'wiki.json', action: 'update', before: '{"pages":[]}', after: '{"pages":[{}]}', baseRevision: 'catalog-rev' },
          ],
          validation: { status: 'passed', checks: ['Target paths are inside the Wiki root.'], warnings: [] },
        };
      }
      if (command === 'apply_hub_wiki_change') {
        return {
          changeSetId: 'change-1',
          projectId: firstProject.id,
          provider: 'open_zread',
          slug: 'architecture',
          relativePath: '核心/architecture.md',
          before: '# 架构设计',
          after: '# Updated architecture',
          status: 'applied',
          createdAt: '1720000000000',
          operation: pendingOperation,
        };
      }
      if (command === 'list_hub_wiki_history') {
        return [{
          id: 'change-1',
          projectId: firstProject.id,
          provider: 'open_zread',
          label: 'OpenZread change change-1',
          createdAt: '1720000000000',
          current: false,
          pageCount: 1,
        }];
      }
      if (command === 'restore_hub_wiki_history') {
        return {
          id: 'change-1',
          projectId: firstProject.id,
          provider: 'open_zread',
          label: 'OpenZread change change-1',
          createdAt: '1720000000000',
          current: false,
          pageCount: 1,
        };
      }
      if (command === 'search_hub_wiki') {
        const query = String(args?.query);
        return {
          query,
          results: [{
            projectId: firstProject.id,
            projectName: firstProject.name,
            provider: 'open_zread',
            wikiId: 'open_zread@framework',
            sourceRoot: 'framework',
            slug: 'architecture',
            title: '架构设计',
            snippet: 'Provider 协同工作',
            path: '核心/architecture.md',
          }],
          failures: [],
          markdownResults: [{
            sourceKind: 'local_markdown',
            projectId: firstProject.id,
            projectName: firstProject.name,
            path: 'guide.md',
            title: 'Guide',
            snippet: 'Guide local Markdown hit',
            matchKind: 'content',
            matchLine: 1,
            matchColumn: 3,
            matchLength: query.length,
          }],
          markdownFailures: [],
        };
      }
      if (command === 'search_hub_project_markdown') {
        const query = String(args?.query);
        return {
          projectId: args?.projectId,
          query,
          results: [{
            sourceKind: 'local_markdown',
            projectId: args?.projectId,
            projectName: firstProject.name,
            path: 'guide.md',
            title: 'Guide',
            snippet: `Guide contains ${query}`,
            matchKind: 'content',
            matchLine: 1,
            matchColumn: 3,
            matchLength: query.length,
          }],
          scanComplete: true,
          scannedFiles: 1,
          errors: [],
        };
      }
      if (command === 'read_hub_open_zread_source') {
        return { path: 'src/main.ts', content: 'export const main = true;\n' };
      }
      if (command === 'read_hub_zread_wiki') {
        return {
          provider: 'zread',
          status: 'readable',
          currentPointer: 'versions/2026-09-17-120000',
          versionId: '2026-09-17-120000',
          catalog: {
            id: '2026-09-17-120000',
            generatedAt: '2026-09-17T12:00:00.000Z',
            language: 'zh',
            native: { providerMeta: { source: 'zread' } },
          },
          pages: [
            {
              slug: 'overview',
              title: 'Zread 概览',
              file: 'overview.md',
              section: 'Start',
              associatedFiles: [],
              status: 'readable',
              content: '# Zread 当前版本',
              native: { source: 'zread' },
            },
          ],
        };
      }
      if (command === 'read_hub_zread_source') {
        return { path: 'src/main.ts', content: 'export const zread = true;\n' };
      }
      if (command === 'remove_hub_project') {
        projects = projects.filter((project) => project.id !== args?.projectId);
        return null;
      }
      return null;
    },
    listen: async (_event, listener) => { onTaskListener?.(listener); return () => undefined; },
    selectProjectDirectory: async () => selectedDirectory,
    copyText: async (text) => {
      copied.push(text);
    },
  };
  return createHubApplicationService(transport);
}

async function openProjectMenu(renderer: ReactTestRenderer | undefined, projectName = firstProject.name) {
  const trigger = renderer?.root.findByProps({ 'aria-label': `${projectName} 更多操作` });
  await act(async () => {
    trigger?.props.onClick();
    await Promise.resolve();
  });
}

describe('Project Library UI', () => {
  test('locates and merges Wiki instances from a selected project subdirectory', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, 'C:\\Work\\Alpha\\framework');
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '定位 Alpha project 的 Wiki 子目录' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({
      command: 'locate_hub_project_wikis',
      args: { projectId: firstProject.id, directory: 'C:\\Work\\Alpha\\framework' },
    });
    const locatedWiki = renderer?.root.findByProps({ 'data-parent-project': firstProject.id });
    expect(locatedWiki).toBeDefined();
    if (locatedWiki) expect(textContent(locatedWiki)).toContain('framework · OpenZread');
    expect(renderer?.root.findByProps({ role: 'status' })).toBeDefined();
    await act(async () => {
      locatedWiki?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'read_hub_open_zread_wiki',
      args: { projectId: firstProject.id, wikiId: 'open_zread@framework' },
    });
    await act(async () => renderer?.unmount());
  });

  test('refreshes the Markdown tree by rescanning and replacing stale paths', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' })).toBeDefined();
    expect(commands.filter((call) => call.command === 'list_hub_project_markdown')).toHaveLength(1);
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '刷新 Alpha project 的 Markdown 目录树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.filter((call) => call.command === 'list_hub_project_markdown')).toHaveLength(2);
    expect(renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'refreshed.md' })).toHaveLength(2);
    expect(renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'guide.md' })).toHaveLength(0);
    const markdownWorkspace = renderer?.root.findByProps({ 'data-testid': 'project-markdown-workspace' });
    expect(markdownWorkspace ? textContent(markdownWorkspace) : '')
      .toContain('当前 Markdown 文件已移动或删除');
    await act(async () => renderer?.unmount());
  });

  test('previews a Markdown draft and writes it only after explicit confirmation', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, [firstProject], true);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-markdown-tree-path': 'docs' }).props.onClick());
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'docs/guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-edit-button' }).props.onClick());
    const editor = renderer?.root.findByProps({ 'data-testid': 'markdown-editor-input' });
    await act(async () => editor?.props.onChange({ currentTarget: { value: '# Updated Guide\n\nSaved from the editor.' } }));
    expect(commands.some((call) => call.command === 'save_hub_project_markdown')).toBe(false);
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-preview-button' }).props.onClick());
    const editPreview = renderer?.root.findByProps({ 'data-testid': 'markdown-edit-preview' });
    const initialDiff = renderer?.root.findByProps({ className: 'markdown-diff-details' });
    if (!editPreview || !initialDiff) throw new Error('Markdown preview and diff should render');
    expect(editPreview).toBeDefined();
    expect(textContent(initialDiff)).toContain('Saved from the editor.');
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'markdown-save-confirm' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'save_hub_project_markdown',
      args: {
        projectId: firstProject.id,
        relativePath: 'docs/guide.md',
        baseRevision: 'guide-rev-1',
        content: '# Updated Guide\n\nSaved from the editor.',
      },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-save-success' })).toBeDefined();
    expect(renderer?.root.findAllByProps({ 'data-testid': 'markdown-saved-draft' })).toHaveLength(0);
    const updatedTreeFiles = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/guide.md' }) ?? [];
    if (updatedTreeFiles.length === 0) throw new Error('Updated Markdown entry should remain in the tree');
    expect(updatedTreeFiles.some((file) => textContent(file).includes('Updated Guide'))).toBe(true);
    await act(async () => renderer?.unmount());
  });

  test('guards leaving a dirty Markdown draft and lets the user keep and resume it', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, [firstProject], true);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-markdown-tree-path': 'docs' }).props.onClick());
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'docs/guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-edit-button' }).props.onClick());
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-editor-input' }).props.onChange({ currentTarget: { value: '# My unsaved draft' } }));
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-close-reading' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-leave-dialog' })).toBeDefined();
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-leave-cancel' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-editor-view' })).toBeDefined();

    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-close-reading' }).props.onClick());
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-leave-keep' }).props.onClick());
    expect(renderer?.root.findAllByProps({ 'data-testid': 'markdown-leave-dialog' })).toHaveLength(0);
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'docs/guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-saved-draft' })).toBeDefined();
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-edit-button' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-editor-input' }).props.value).toBe('# My unsaved draft');
    expect(commands.some((call) => call.command === 'save_hub_project_markdown')).toBe(false);
    await act(async () => renderer?.unmount());
  });

  test('keeps the draft after an external edit conflict and offers disk comparison and draft copy', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const copied: string[] = [];
    const service = createLibraryService(commands, copied, undefined, undefined, [firstProject], false, false, false, true);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-edit-button' }).props.onClick());
    const draftContent = '# My draft survives a conflict';
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-editor-input' }).props.onChange({ currentTarget: { value: draftContent } }));
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-preview-button' }).props.onClick());
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'markdown-save-confirm' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.filter((call) => call.command === 'save_hub_project_markdown')).toHaveLength(1);
    expect(renderer?.root.findByProps({ role: 'alert' })).toBeDefined();
    const conflictedPreview = renderer?.root.findByProps({ 'data-testid': 'markdown-edit-preview' });
    if (!conflictedPreview) throw new Error('Conflict should leave the preview open');
    expect(textContent(conflictedPreview)).toContain(draftContent);

    const compareButton = renderer?.root.findAllByType('button').find((button) => textContent(button) === '重新比较磁盘版本');
    await act(async () => {
      compareButton?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const diff = renderer?.root.findByProps({ className: 'markdown-diff-details' });
    if (!diff) throw new Error('Disk comparison should remain visible');
    expect(textContent(diff)).toContain('# External edit');
    expect(textContent(diff)).toContain(draftContent);
    const copyButton = renderer?.root.findAllByType('button').find((button) => textContent(button) === '复制草稿');
    await act(async () => { copyButton?.props.onClick(); await Promise.resolve(); });
    expect(copied).toContain(draftContent);
    expect(commands.some((call) => call.command === 'save_hub_project_markdown' && call.args?.content === '# External edit')).toBe(false);
    await act(async () => renderer?.unmount());
  });

  test('Markdown workspace sidebars can be resized and independently collapsed', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />, {
        createNodeMock: (element) => typeof element.props === 'object' && element.props !== null
          && 'className' in element.props && element.props.className === 'markdown-workspace-body'
          ? { clientWidth: 1400, getBoundingClientRect: () => ({ left: 0, right: 1400 }) }
          : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const treeResize = renderer?.root.findByProps({ 'data-testid': 'markdown-tree-resize-handle' });
    expect(treeResize?.props['aria-valuenow']).toBe(250);
    await act(async () => {
      treeResize?.props.onPointerDown({ preventDefault() {}, pointerId: 4, currentTarget: { setPointerCapture() {} } });
      treeResize?.props.onPointerMove({ pointerId: 4, clientX: 390 });
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-tree-resize-handle' }).props['aria-valuenow']).toBe(390);
    expect(renderer?.root.findByProps({ 'data-testid': 'project-markdown-workspace' }).findByProps({ className: 'markdown-workspace-body' }).props.style.gridTemplateColumns)
      .toBe('390px 8px minmax(0, 1fr) 8px 280px');

    await act(async () => renderer?.root.findByProps({ 'aria-label': '隐藏 Markdown 目录' }).props.onClick());
    expect(renderer?.root.findAllByProps({ 'data-testid': 'markdown-tree-resize-handle' })).toHaveLength(0);
    expect(renderer?.root.findAllByProps({ 'data-testid': 'markdown-workspace-tree' })).toHaveLength(0);
    await act(async () => renderer?.root.findByProps({ 'aria-label': '隐藏阅读侧栏' }).props.onClick());
    expect(renderer?.root.findAllByProps({ 'data-testid': 'markdown-inspector-resize-handle' })).toHaveLength(0);
    expect(renderer?.root.findByProps({ className: 'markdown-workspace-body' }).props.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    await act(async () => renderer?.unmount());
  });

  test('Markdown outline jumps inside the article scroller and Ask AI explains its pending connection', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;
    const scrollCalls: number[] = [];
    const heading = {
      id: 'guide',
      textContent: 'Guide',
      tagName: 'H1',
      getBoundingClientRect: () => ({ top: 600 }),
    };
    await act(async () => {
      renderer = create(<HubApp service={service} />, {
        createNodeMock: (element) => typeof element.props === 'object' && element.props !== null
          && 'className' in element.props && element.props.className === 'markdown-workspace-article'
          ? {
            scrollTop: 0,
            getBoundingClientRect: () => ({ top: 100 }),
            querySelectorAll: () => [heading],
            scrollTo: ({ top }: { top: number }) => scrollCalls.push(top),
          }
          : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const outlineHeading = renderer?.root.findByProps({ 'data-testid': 'markdown-outline-heading-guide' });
    if (!outlineHeading) throw new Error('Markdown outline heading was not rendered');
    expect(textContent(outlineHeading)).toBe('Guide');
    expect(outlineHeading?.props['aria-current']).toBe('location');
    await act(async () => outlineHeading?.props.onClick());
    expect(scrollCalls).toEqual([484]);
    await act(async () => renderer?.root.findByProps({ id: 'markdown-inspector-ask-tab' }).props.onClick());
    const askPanel = renderer?.root.findByProps({ 'data-testid': 'markdown-ask-panel' });
    if (!askPanel) throw new Error('Markdown Ask panel was not rendered');
    expect(textContent(askPanel)).toContain('发送给 Hub 已配置的模型');
    expect(textContent(askPanel)).toContain('不会自动修改原文');
    expect(renderer?.root.findByProps({ 'aria-label': '询问当前 Markdown 文档' }).props.disabled).toBe(false);
    await act(async () => renderer?.unmount());
  });

  test('Markdown Ask AI sends only the current file and selection; adoption requires preview and explicit save', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    const previousGetSelection = Object.getOwnPropertyDescriptor(globalThis, 'getSelection');
    Object.defineProperty(globalThis, 'getSelection', {
      configurable: true,
      value: () => ({ anchorNode: {}, toString: () => 'Only this selected passage' }),
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />, {
          createNodeMock: (element) => typeof element.props === 'object' && element.props !== null
            && 'className' in element.props && element.props.className === 'markdown-workspace-article'
            ? { contains: () => true, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [], scrollTo() {} }
            : null,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` })
          .findAllByType('button').find((button) => textContent(button) === '打开项目')?.props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'project-tab-markdown' }).props.onClick());
      await act(async () => {
        renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => renderer?.root.findByProps({ className: 'markdown-workspace-article' }).props.onMouseUp());
      await act(async () => renderer?.root.findByProps({ id: 'markdown-inspector-ask-tab' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'markdown-ask-selection' })).toBeDefined();

      await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-ask-question' }).props.onChange({ currentTarget: { value: 'What is the point?' } }));
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'markdown-ask-form' }).props.onSubmit({ preventDefault() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands).toContainEqual({
        command: 'ask_hub_project_markdown',
        args: {
          projectId: firstProject.id,
          relativePath: 'guide.md',
          question: 'What is the point?',
          selectedText: 'Only this selected passage',
        },
      });
      const answer = renderer?.root.findByProps({ 'data-testid': 'markdown-ask-answer' });
      if (!answer) throw new Error('Markdown Ask AI answer was not rendered');
      expect(textContent(answer)).toContain('test-provider/test-model');
      expect(textContent(answer)).toContain('guide.md');

      await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-ask-adopt' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'markdown-editor-view' })).toBeDefined();
      expect(renderer?.root.findByProps({ 'data-testid': 'markdown-editor-input' }).props.value).toContain('## AI 建议\n\nUse a small, explicit interface.');
      expect(commands.some(({ command }) => command === 'save_hub_project_markdown')).toBe(false);
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-preview-button' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'markdown-edit-preview' })).toBeDefined();
      expect(commands.some(({ command }) => command === 'save_hub_project_markdown')).toBe(false);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'markdown-save-confirm' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands.some(({ command }) => command === 'save_hub_project_markdown')).toBe(true);
    } finally {
      if (previousGetSelection) Object.defineProperty(globalThis, 'getSelection', previousGetSelection);
      else Reflect.deleteProperty(globalThis, 'getSelection');
      await act(async () => renderer?.unmount());
    }
  });

  test('Markdown tab has a clear no-selection state and no Wiki-only generation actions', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const projectCard = renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` });
    const openButton = projectCard?.findAllByType('button').find((button) => textContent(button) === '打开项目');
    await act(async () => {
      openButton?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-tab-markdown' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const workspace = renderer?.root.findByProps({ 'data-testid': 'project-markdown-workspace' });
    if (!workspace) throw new Error('Markdown workspace was not rendered');
    expect(textContent(workspace)).toContain('选择一篇 Markdown 文档');
    expect(textContent(workspace)).not.toContain('Wiki Provider');
    expect(textContent(workspace)).not.toContain('New page');
    expect(textContent(workspace)).not.toContain('History & restore');
    expect(textContent(workspace)).not.toContain('生成');
    expect(workspace.findByProps({ 'aria-label': '调整 Markdown 目录宽度' })).toBeDefined();
    expect(workspace.findByProps({ 'aria-label': '调整 Markdown 阅读侧栏宽度' })).toBeDefined();
    await act(async () => renderer?.unmount());
  });

  test('refresh keeps valid Markdown selection and expanded directories in both project trees', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, true);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const globalDocs = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs' })[0];
    await act(async () => {
      globalDocs?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const globalGuide = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/guide.md' })[0];
    await act(async () => {
      globalGuide?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '刷新 Alpha project 的 Markdown 目录树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const directoryNodes = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs' }) ?? [];
    const selectedNodes = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/guide.md' }) ?? [];
    expect(commands.filter((call) => call.command === 'list_hub_project_markdown')).toHaveLength(2);
    expect(directoryNodes).toHaveLength(2);
    expect(directoryNodes.every((node) => node.props['aria-expanded'] === true)).toBe(true);
    expect(selectedNodes).toHaveLength(2);
    expect(selectedNodes.every((node) => node.props['aria-current'] === 'page')).toBe(true);
    expect(commands.filter((call) => call.command === 'read_hub_project_markdown')).toHaveLength(2);
    await act(async () => renderer?.unmount());
  });

  test('refresh does not redirect a moved Markdown file to another path with the same name', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, false, true);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (const path of ['docs', 'docs/a']) {
      const item = renderer?.root.findAllByProps({ 'data-markdown-tree-path': path })[0];
      await act(async () => {
        item?.props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const originalFile = renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/a/guide.md' })[0];
    await act(async () => {
      originalFile?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '刷新 Alpha project 的 Markdown 目录树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const workspace = renderer?.root.findByProps({ 'data-testid': 'project-markdown-workspace' });
    expect(workspace ? textContent(workspace) : '').toContain('当前 Markdown 文件已移动或删除');
    expect(renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/a/guide.md' })).toHaveLength(0);
    expect(renderer?.root.findAllByProps({ 'data-markdown-tree-path': 'docs/b/guide.md' })).toHaveLength(0);
    expect(commands.filter((call) => call.command === 'read_hub_project_markdown'))
      .toEqual([{ command: 'read_hub_project_markdown', args: { projectId: firstProject.id, relativePath: 'docs/a/guide.md' } }]);
    await act(async () => renderer?.unmount());
  });

  test('partial Markdown scans show the reason and offer a retry from the project tree', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, false, false, true);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '刷新 Alpha project 的 Markdown 目录树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const warning = renderer?.root.findByProps({ className: 'project-tree-message is-warning' });
    expect(warning ? textContent(warning) : '').toContain('Markdown 扫描达到测试预算');
    expect(warning?.props.role).toBe('status');
    await act(async () => {
      warning?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.filter((call) => call.command === 'list_hub_project_markdown')).toHaveLength(3);
    await act(async () => renderer?.unmount());
  });

  test('persists Markdown scroll position by project and file path', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;
    const articleNodes: Array<{ scrollTop: number }> = [];
    const mountHub = () => create(<HubApp service={service} />, {
      createNodeMock: (element) => {
        const props = element.props;
        if (typeof props === 'object' && props !== null && 'className' in props
          && props.className === 'markdown-workspace-article') {
          const node = { scrollTop: 0 };
          articleNodes.push(node);
          return node;
        }
        return null;
      },
    });
    try {
      await act(async () => {
        renderer = mountHub();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ className: 'markdown-workspace-article' }).props.onScroll({
          currentTarget: { scrollTop: 640 },
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 160));
      });
      const preferences = JSON.parse(stored.get('open-zread-hub.preferences.v1') ?? '{}') as {
        markdownScrollPositions?: Record<string, number>;
      };
      expect(preferences.markdownScrollPositions?.[`${firstProject.id}:guide.md`]).toBe(640);
      await act(async () => renderer?.unmount());
      await act(async () => {
        renderer = mountHub();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(renderer?.root.findByProps({ 'data-markdown-heading': 'true' })).toBeDefined();
      expect(articleNodes.at(-1)?.scrollTop).toBe(640);
      await act(async () => renderer?.unmount());
    } finally {
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('opens relative Markdown links in the workspace and source links in a highlighted preview', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '展开 Alpha project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-markdown-tree-path': 'guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const links = renderer?.root.findAllByProps({ 'data-testid': 'markdown-relative-link' }) ?? [];
    expect(links).toHaveLength(2);
    await act(async () => links[1]?.props.onClick());
    expect(renderer?.root.findByProps({ role: 'alert' }).children.join(' ')).toContain('位于项目目录之外');
    expect(commands.some((call) => call.command === 'read_hub_project_markdown' && call.args?.relativePath === '../../outside.md')).toBe(false);

    await act(async () => {
      renderer?.root.findAllByProps({ 'data-testid': 'markdown-relative-link' })
        .find((link) => textContent(link).includes('Read me'))?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'read_hub_project_markdown',
      args: { projectId: firstProject.id, relativePath: 'README.md' },
    });
    expect(renderer?.root.findAllByProps({ 'data-markdown-heading': 'true' }).some((heading) => heading.props.id === 'usage')).toBe(true);

    await act(async () => {
      renderer?.root.findAllByProps({ 'data-testid': 'markdown-relative-link' })
        .find((link) => textContent(link).includes('Lua source'))?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'read_hub_project_markdown_source',
      args: { projectId: firstProject.id, documentPath: 'README.md', sourcePath: 'src/main.lua' },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'source-content-text' }).children.join(' ')).toContain('local answer = 42');
    await act(async () => renderer?.root.findByProps({ 'aria-label': '关闭源码预览' }).props.onClick());
    await act(async () => renderer?.unmount());
  });

  test('discovers both Wiki and Markdown trees when entering a project', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const projectCard = renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` });
    const openButton = projectCard?.findAllByType('button').find((button) => textContent(button) === '打开项目');
    expect(openButton).toBeDefined();
    await act(async () => {
      openButton?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({ command: 'list_hub_project_wikis', args: { projectId: firstProject.id } });
    expect(commands).toContainEqual({ command: 'list_hub_project_markdown', args: { projectId: firstProject.id } });
    await act(async () => renderer?.unmount());
  });

  test('searches saved Wiki content and opens the matching Provider Reader', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'global-search-input' }).props.onChange({ target: { value: '协同' } });
    });
    await act(async () => {
      renderer?.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'search-results' })).toBeDefined();
    expect(commands).toContainEqual({ command: 'search_hub_wiki', args: { query: '协同' } });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'search-result-project-1-open_zread@framework-architecture' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'read_hub_open_zread_wiki',
      args: { projectId: firstProject.id, wikiId: 'open_zread@framework' },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-architecture' })).toBeDefined();
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'app-back' }).props.onClick();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'search-results' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'global-search-input' }).props.value).toBe('协同');
    await act(async () => {
      renderer?.unmount();
    });
  });

  test('global search mixes Markdown results and revalidates before opening the exact document', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'global-search-input' }).props.onChange({ target: { value: 'Guide' } });
    });
    await act(async () => {
      renderer?.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const result = renderer?.root.findByProps({ 'data-testid': `search-result-markdown-${firstProject.id}-guide.md` });
    if (!result) throw new Error('Global Markdown search result was not rendered');
    expect(textContent(result)).toContain('Guide');
    await act(async () => {
      result?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'read_hub_project_markdown',
      args: { projectId: firstProject.id, relativePath: 'guide.md' },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'project-markdown-workspace' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-rendered-content' })).toBeDefined();
    await act(async () => renderer?.unmount());
  });

  test('stale global Markdown results show a refresh message instead of opening the old hit', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, false, false, false, false, true);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'global-search-input' }).props.onChange({ target: { value: 'Guide' } });
    });
    await act(async () => {
      renderer?.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': `search-result-markdown-${firstProject.id}-guide.md` }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer?.root.findAllByProps({ 'data-testid': 'project-markdown-workspace' })).toHaveLength(0);
    expect(renderer?.root.findByProps({ className: 'search-failures' }).children.join(' ')).toContain('搜索结果已过期');
    expect(commands).toContainEqual({ command: 'list_hub_project_markdown', args: { projectId: firstProject.id } });
    await act(async () => renderer?.unmount());
  });

  test('project Markdown search opens its hit and preserves the query for body positioning', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    const articleScrolls: number[] = [];
    const articleNode = {
      scrollTop: 0,
      scrollTo: ({ top }: { top: number }) => articleScrolls.push(top),
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [
        { dataset: { markdownSourceStartLine: '2', markdownSourceEndLine: '2' }, textContent: 'Guide', getBoundingClientRect: () => ({ top: 600 }) },
        { dataset: { markdownSourceStartLine: '1', markdownSourceEndLine: '1' }, textContent: 'Guide', getBoundingClientRect: () => ({ top: 220 }) },
      ],
    };
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />, {
        createNodeMock: (element) => element.type === 'article'
          && typeof element.props === 'object' && element.props !== null
          && 'className' in element.props && element.props.className === 'markdown-workspace-article' ? articleNode : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` })
      .findAllByType('button').find((button) => textContent(button) === '打开项目')?.props.onClick());
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'project-tab-markdown' }).props.onClick());

    await act(async () => renderer?.root.findByProps({ 'data-testid': 'markdown-local-search-input' }).props.onChange({ currentTarget: { value: 'Guide' } }));
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'markdown-local-search-form' }).props.onSubmit({ preventDefault: () => undefined });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-local-search-results' })).toBeDefined();
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'markdown-local-result-guide.md' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'search_hub_project_markdown',
      args: { projectId: firstProject.id, query: 'Guide' },
    });
    expect(articleScrolls).toEqual([104]);
    await act(async () => renderer?.unmount());
  });

  test('filters by name/path and toggles favorite-only view', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    expect(renderer?.root.findAllByProps({ className: 'project-card' })).toHaveLength(2);

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'nav-projects' }).props.onClick();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-filter' }).props.onChange({
        target: { value: 'beta' },
      });
    });
    expect(renderer?.root.findAllByProps({ className: 'project-card' })).toHaveLength(1);
    expect(renderer?.root.findByProps({ 'data-testid': 'project-project-2' })).toBeDefined();

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-filter' }).props.onChange({
        target: { value: '' },
      });
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'favorite-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'favorite-project-1' }).props['aria-pressed']).toBe(true);

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'favorite-filter' }).props.onChange({
        target: { checked: true },
      });
    });
    expect(renderer?.root.findAllByProps({ className: 'project-card' })).toHaveLength(1);
    expect(() => renderer?.root.findByProps({ 'data-testid': 'project-project-2' })).toThrow();

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('sorts projects by name or added date and composes with favorite filtering', async () => {
    const sortedProjects: HubProject[] = [
      { ...firstProject, addedAt: '200', favorite: true },
      { ...secondProject, addedAt: '100' },
      { ...firstProject, id: 'project-3', name: 'Charlie project', path: 'C:\\Work\\Charlie', addedAt: '300' },
    ];
    const service = createLibraryService([], [], undefined, undefined, sortedProjects);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-projects' }).props.onClick());

    const names = () => renderer?.root.findAllByProps({ className: 'project-card' }).map((card) => {
      const title = card.findByProps({ className: 'project-name-button' });
      return textContent(title);
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'project-sort' }).props.onChange({ target: { value: 'name-asc' } }));
    expect(names()).toEqual(['Alpha project', 'Beta project', 'Charlie project']);
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'project-sort' }).props.onChange({ target: { value: 'added-newest' } }));
    expect(names()).toEqual(['Charlie project', 'Alpha project', 'Beta project']);
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'favorite-filter' }).props.onChange({ target: { checked: true } }));
    expect(names()).toEqual(['Alpha project']);
    await act(async () => renderer?.unmount());
  });

  test('exposes safe project actions without deleting source content', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const copied: string[] = [];
    const service = createLibraryService(commands, copied);
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    let renderer: ReactTestRenderer | undefined;

    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />);
        await Promise.resolve();
      });

      await openProjectMenu(renderer);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'copy-path-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await openProjectMenu(renderer);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-folder-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await openProjectMenu(renderer, secondProject.name);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'relocate-project-2' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(copied).toEqual([firstProject.path]);
      expect(renderer?.root.findAllByProps({ className: 'project-path' }).map((node) => node.children.join(' '))).toContain('D:\\Projects\\Beta');

      await openProjectMenu(renderer, secondProject.name);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'remove-project-2' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(() => renderer?.root.findByProps({ 'data-testid': 'project-project-2' })).toThrow();
      expect(commands.map(({ command }) => command)).toContain('remove_hub_project');
    } finally {
      globalThis.confirm = originalConfirm;
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  test('offers resume and restart after a failed OpenZread generation with a saved checkpoint', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let taskListener: ((event: { payload: unknown }) => void) | undefined;
    const service = createLibraryService(commands, [], (listener) => { taskListener = listener; });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-projects' }).props.onClick());
    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'generate-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-tasks' }).props.onClick());
    await act(async () => taskListener?.({ payload: {
      taskId: 'task-1', projectId: firstProject.id, wikiId: 'open_zread@.', kind: 'generation', status: 'failed', phase: 'failed',
      occurredAt: '2026-09-25T00:00:00.000Z', message: 'Wiki content generation was incomplete: 4/13 pages succeeded; 9 failed.',
      details: 'page-5: HTTP 429: provider quota exceeded\nError: provider quota exceeded',
      progress: { current: 13, total: 13, succeeded: 4, failed: 9 }, canResume: true,
    } }));

    expect(renderer?.root.findByProps({ 'data-testid': 'task-panel-progress' }).children.join(' '))
      .toContain('成功 4 · 失败 9 · 共 13 页');
    expect(renderer?.root.findByProps({ 'data-testid': 'task-error-details' }).children.join(' '))
      .toContain('page-5: HTTP 429: provider quota exceeded');
    expect(renderer?.root.findByProps({ 'data-testid': 'continue-active-task' }).children).toContain('继续未完成页面');
    expect(renderer?.root.findByProps({ 'data-testid': 'restart-active-task' }).children).toContain('从头重试');
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'continue-active-task' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.filter((call) => call.command === 'start_hub_open_zread_task').at(-1)?.args)
      .toEqual({ projectId: firstProject.id, wikiId: 'open_zread@.', operation: 'generate', resume: true });
    await act(async () => renderer?.unmount());
  });

  test('renames a project display name in place without changing its registered path', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-projects' }).props.onClick());
    await act(async () => renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` }).findByProps({ className: 'project-name-button' }).props.onClick());
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '项目显示名称' }).props.onChange({ target: { value: 'Renamed Alpha' } });
    });
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': '项目显示名称' }).props.onKeyDown({ key: 'Enter' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({
      command: 'rename_hub_project',
      args: { projectId: firstProject.id, name: 'Renamed Alpha' },
    });
    const renamedCard = renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` });
    expect(renamedCard).toBeDefined();
    if (renamedCard) {
      expect(textContent(renamedCard)).toContain('Renamed Alpha');
      expect(textContent(renamedCard)).toContain(firstProject.path);
    }
    await act(async () => renderer?.unmount());
  });

  test('opens the OpenZread Reader with Mermaid, partial-page state, and source references', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;
    let articleScrollTop = 0;
    let articleScrollWrites = 0;
    const articleNode = {
      get scrollTop() { return articleScrollTop; },
      set scrollTop(value: number) { articleScrollTop = value; articleScrollWrites += 1; },
      getBoundingClientRect: () => ({ top: 0, bottom: 700, left: 0, right: 900, width: 900, height: 700, x: 0, y: 0, toJSON: () => ({}) }),
      querySelectorAll: () => [],
    };

    await act(async () => {
      renderer = create(<HubApp service={service} />, { createNodeMock: (element) => element.type === 'article' ? articleNode : null });
      await Promise.resolve();
    });

    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-architecture' })).toBeDefined();
    const sectionMarker = renderer?.root.findByProps({ 'aria-label': 'Jump to 架构设计' });
    expect(sectionMarker).toBeDefined();
    await act(async () => sectionMarker?.props.onMouseEnter());
    expect(sectionMarker?.props.className).toContain('is-hovered');
    expect(sectionMarker?.findByProps({ role: 'tooltip' }).children.join(' ')).toBe('架构设计');
    await act(async () => sectionMarker?.props.onMouseLeave());
    articleScrollWrites = 0;
    articleNode.scrollTop = 420;
    articleScrollWrites = 0;
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-reader-article' }).props.onScroll();
    });
    expect(articleScrollWrites).toBe(0);
    expect(renderer?.root.findByProps({ 'data-testid': 'mermaid-block' }).props['data-language']).toBe('mermaid');
    const table = renderer?.root.findByProps({ 'data-testid': 'markdown-table' });
    expect(table?.findAllByType('th')).toHaveLength(3);
    expect(table?.findAllByType('td').map(textContent)).toEqual(['OpenZread', '可读', '本地 Wiki']);
    expect(table?.findAllByType('td')[1]?.props.style.textAlign).toBe('right');
    expect(renderer?.root.findByProps({ 'data-testid': 'markdown-table-scroll' }).props.tabIndex).toBe(0);
    expect(renderer?.root.findByProps({ id: 'main-content' }).props.className).toContain('hub-content-project');
    const projectWorkspace = renderer?.root.findByProps({ 'data-testid': 'project-workspace' });
    const projectWorkspaceChildren = projectWorkspace?.children.filter((child): child is ReactTestInstance => typeof child !== 'string');
    expect(projectWorkspaceChildren?.map((child) => child.props.className)).toEqual(['project-section-nav', 'project-wiki-workspace']);

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-broken' }).props.onClick();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-error-broken' }).children.join(' '))
      .toContain('missing');

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-architecture' }).props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'source-src-main-ts' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'source-content-text' }).children.join(' '))
      .toContain('export const main = true;');
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-source-preview' })).toBeDefined();
    await act(async () => renderer?.root.findByProps({ 'aria-label': '关闭源码预览' }).props.onClick());
    expect(renderer?.root.findAllByProps({ 'data-testid': 'wiki-source-preview' })).toHaveLength(0);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('parses aligned Markdown tables, escaped pipes, and renders Mermaid SVG with an isolated error fallback', async () => {
    const [table] = parseMarkdownBlocks('| Name | Details |\n| :--- | ---: |\n| API | `a\\|b` |')
      .filter((block) => block.type === 'table');
    expect(table).toEqual({
      type: 'table',
      headers: ['Name', 'Details'],
      rows: [['API', '`a|b`']],
      alignments: ['left', 'right'],
    });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<MermaidDiagram source="flowchart LR\nA --> B" renderSvg={async () => '<svg viewBox="0 0 20 10"><path /></svg>'} />);
      await Promise.resolve();
    });
    const diagram = renderer?.root.findByProps({ 'data-testid': 'mermaid-block' });
    expect(diagram?.props['data-status']).toBe('rendered');
    expect(diagram?.findByProps({ className: 'wiki-reader-diagram-svg' }).props.src).toContain('data:image/svg+xml');
    expect(diagram?.findByProps({ className: 'wiki-reader-diagram-svg' }).props.alt).toBe('Mermaid diagram');
    await act(async () => diagram?.findAllByType('button').find((button) => textContent(button) === 'Mermaid 源码')?.props.onClick());
    expect(diagram?.findByProps({ className: 'wiki-reader-code wiki-reader-mermaid-source' }).findByType('code').children).toEqual(['flowchart LR\\nA --> B']);
    await act(async () => diagram?.findAllByType('button').find((button) => textContent(button) === '图表')?.props.onClick());
    expect(diagram?.findByProps({ className: 'wiki-reader-diagram-svg' })).toBeDefined();
    await act(async () => diagram?.findByProps({ className: 'wiki-reader-diagram-svg' }).props.onError());
    expect(diagram?.props['data-status']).toBe('error');
    expect(diagram?.findByType('code').children).toEqual(['flowchart LR\\nA --> B']);
    await act(async () => renderer?.unmount());

    await act(async () => {
      renderer = create(<MermaidDiagram source="not a diagram" renderSvg={async () => { throw new Error('syntax error'); }} />);
      await Promise.resolve();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'mermaid-block' }).props['data-status']).toBe('error');
    expect(renderer?.root.findByProps({ role: 'alert' }).children.join('')).toContain('syntax error');
    expect(renderer?.root.findByType('code').children).toEqual(['not a diagram']);
    await act(async () => renderer?.unmount());
  });

  test('starts an explicit OpenZread generation task from a Project card', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'generate-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({
      command: 'start_hub_open_zread_task',
      args: { projectId: firstProject.id, wikiId: 'open_zread@.', operation: 'generate', resume: false },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'active-task' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'task-status' }).children).toEqual(['running']);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('keeps a nested Wiki identity on maintenance generation and checkpoint resume', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let taskListener: ((event: { payload: unknown }) => void) | undefined;
    const service = createLibraryService(
      commands,
      [],
      (listener) => { taskListener = listener; },
      undefined,
      undefined,
      false,
      false,
      false,
      false,
      false,
      [{ wikiId: 'open_zread@framework', provider: 'open_zread', sourceRoot: 'framework', label: 'framework · OpenZread', status: 'readable' }],
    );
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': `project-${firstProject.id}` })
        .findAllByType('button').find((button) => textContent(button) === '打开项目')?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'data-testid': 'project-tab-maintenance' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-testid': 'maintenance-instance-open_zread@framework' })).toBeDefined();
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'maintenance-generate-open_zread@framework' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands.filter((call) => call.command === 'start_hub_open_zread_task').at(-1)?.args).toEqual({
      projectId: firstProject.id,
      wikiId: 'open_zread@framework',
      operation: 'generate',
      resume: false,
    });
    expect(textContent(renderer?.root.findByProps({ 'data-testid': 'active-task' }) as ReactTestInstance)).toContain('open_zread@framework');

    await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-tasks' }).props.onClick());
    await act(async () => taskListener?.({ payload: {
      taskId: 'task-1',
      projectId: firstProject.id,
      wikiId: 'open_zread@framework',
      kind: 'generation',
      status: 'failed',
      phase: 'failed',
      occurredAt: '2026-09-25T00:00:00.000Z',
      message: 'Nested Wiki generation paused.',
      progress: { current: 2, total: 4, succeeded: 2, failed: 0 },
      canResume: true,
    } }));
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'continue-active-task' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.filter((call) => call.command === 'start_hub_open_zread_task').at(-1)?.args).toEqual({
      projectId: firstProject.id,
      wikiId: 'open_zread@framework',
      operation: 'generate',
      resume: true,
    });
    await act(async () => renderer?.unmount());
  });

  test('opens the selected Wiki instance from the lazy sidebar tree and restores selection after collapsing the sidebar', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, false, false, false, false, false, [
      { wikiId: 'open_zread@.', provider: 'open_zread', sourceRoot: '.', label: '根目录 · OpenZread', status: 'readable' },
      { wikiId: 'open_zread@framework', provider: 'open_zread', sourceRoot: 'framework', label: 'framework · OpenZread', status: 'readable' },
    ]);
    let renderer: ReactTestRenderer | undefined;
    let treeToggleFocusCount = 0;

    await act(async () => {
      renderer = create(<HubApp service={service} />, {
        createNodeMock: (element) => typeof element.props === 'object' && element.props !== null
          && 'className' in element.props && element.props.className === 'global-tree-toggle'
          ? { focus: () => { treeToggleFocusCount += 1; } }
          : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-testid': `nav-projects` })).toBeDefined();
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': `展开 ${firstProject.name}` }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const nestedWiki = renderer?.root.findByProps({ 'data-tree-item-id': `wiki:${firstProject.id}:open_zread@framework` });
    expect(nestedWiki).toBeDefined();
    await act(async () => {
      nestedWiki?.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({
      command: 'read_hub_open_zread_wiki',
      args: { projectId: firstProject.id, wikiId: 'open_zread@framework' },
    });
    expect(renderer?.root.findByProps({ 'data-tree-item-id': `wiki:${firstProject.id}:open_zread@framework` }).props['aria-current']).toBe('page');

    await act(async () => renderer?.root.findByProps({ 'aria-label': '收起侧栏' }).props.onClick());
    expect(renderer?.root.findAllByProps({ id: 'project-library-tree' })).toHaveLength(0);
    await act(async () => renderer?.root.findByProps({ 'aria-label': '展开侧栏' }).props.onClick());
    expect(renderer?.root.findByProps({ 'data-tree-item-id': `wiki:${firstProject.id}:open_zread@framework` }).props['aria-current']).toBe('page');
    await act(async () => {
      renderer?.root.findByProps({ role: 'tree' }).props.onKeyDown({
        key: 'Escape',
        target: { closest: () => null },
        currentTarget: {},
        preventDefault() {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'aria-label': '展开项目树' }).props['aria-expanded']).toBe(false);
    expect(treeToggleFocusCount).toBe(1);
    await act(async () => renderer?.unmount());
  });

  test('opens a recent reading entry in its original nested Wiki instance', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = new Map<string, string>([['open-zread-hub.preferences.v1', JSON.stringify({
      version: 1,
      view: 'home',
      recentWikiVisits: [{
        projectId: firstProject.id,
        provider: 'open_zread',
        wikiId: 'open_zread@framework',
        sourceRoot: 'framework',
        slug: 'architecture',
        title: 'Framework architecture',
        visitedAt: 1720000000000,
      }],
    })]]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const recentEntry = renderer?.root.findByProps({ 'data-testid': `recent-wiki-${firstProject.id}-open_zread@framework-architecture` });
      expect(recentEntry).toBeDefined();
      expect(textContent(recentEntry as ReactTestInstance)).toContain('framework');
      await act(async () => {
        recentEntry?.props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(commands).toContainEqual({
        command: 'read_hub_open_zread_wiki',
        args: { projectId: firstProject.id, wikiId: 'open_zread@framework' },
      });
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-architecture' })).toBeDefined();
    } finally {
      await act(async () => renderer?.unmount());
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('previews and applies a manual page ChangeSet back to the original Wiki file', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'edit-wiki-page-architecture' }).props.onClick();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-editor-content' }).props.onChange({
        target: { value: '# Updated architecture' },
      });
      renderer?.root.findByProps({ 'data-testid': 'preview-wiki-change' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'changeset-preview' })).toBeDefined();
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'apply-wiki-change' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands).toContainEqual({
      command: 'apply_hub_wiki_change',
      args: { changeSetId: 'change-1' },
    });
    expect(renderer?.root.findAllByProps({ 'data-testid': 'changeset-preview' })).toHaveLength(0);
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-architecture' })).toBeDefined();
    await act(async () => {
      renderer?.unmount();
    });
  });

  test('previews page creation and only writes the original Wiki files after explicit confirmation', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'new-wiki-page' }).props.onClick();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'new-wiki-page-slug' }).props.onChange({ target: { value: 'overview' } });
      renderer?.root.findByProps({ 'data-testid': 'new-wiki-page-title' }).props.onChange({ target: { value: 'Overview' } });
      renderer?.root.findByProps({ 'data-testid': 'new-wiki-page-content' }).props.onChange({ target: { value: '# New page' } });
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'new-wiki-page-form' }).props.onSubmit({ preventDefault() {} });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.map(({ command }) => command)).toContain('preview_hub_wiki_structure_change');
    expect(commands.map(({ command }) => command)).not.toContain('apply_hub_wiki_change');
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-structure-review' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-structure-file-list' }).findAllByType('details')).toHaveLength(2);

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'apply-wiki-change' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(commands.map(({ command }) => command)).toContain('apply_hub_wiki_change');
    expect(renderer?.root.findAllByProps({ 'data-testid': 'wiki-structure-review' })).toHaveLength(0);
    await act(async () => renderer?.unmount());
  });

  test('previews metadata moves and deletions before either operation is written', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />);
        await Promise.resolve();
      });
      await openProjectMenu(renderer);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'edit-wiki-metadata-architecture' }).props.onClick());
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'wiki-metadata-slug' }).props.onChange({ target: { value: 'architecture-next' } });
        renderer?.root.findByProps({ 'data-testid': 'wiki-metadata-section' }).props.onChange({ target: { value: 'Guides' } });
      });
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'wiki-metadata-form' }).props.onSubmit({ preventDefault() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands.find(({ command }) => command === 'preview_hub_wiki_structure_change')?.args?.request).toMatchObject({
        operation: 'metadata', slug: 'architecture', newSlug: 'architecture-next', section: 'Guides',
      });
      expect(commands.map(({ command }) => command)).not.toContain('apply_hub_wiki_change');
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'apply-wiki-change' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands.map(({ command }) => command)).toContain('apply_hub_wiki_change');

      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'delete-wiki-page-architecture' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands.filter(({ command }) => command === 'preview_hub_wiki_structure_change').at(-1)?.args?.request)
        .toEqual({ operation: 'delete', slug: 'architecture' });
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-structure-review' })).toBeDefined();
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'apply-wiki-change' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands.filter(({ command }) => command === 'apply_hub_wiki_change')).toHaveLength(2);
    } finally {
      globalThis.confirm = originalConfirm;
      await act(async () => renderer?.unmount());
    }
  });

  test('asks before leaving a Reader with an unconfirmed draft and preserves it when the user stays', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, [], undefined, undefined, undefined, false, false, false, false, false, [
      { wikiId: 'open_zread@.', provider: 'open_zread', sourceRoot: '.', label: '根目录 · OpenZread', status: 'readable' },
      { wikiId: 'open_zread@framework', provider: 'open_zread', sourceRoot: 'framework', label: 'framework · OpenZread', status: 'readable' },
    ]);
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = () => false;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />);
        await Promise.resolve();
      });
      await openProjectMenu(renderer);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'edit-wiki-page-architecture' }).props.onClick());
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'wiki-editor-content' }).props.onChange({ target: { value: '# Unsaved draft' } }));
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-home' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'close-wiki-reader' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
      expect((renderer?.root.findByProps({ 'data-testid': 'wiki-editor-content' }).props.value)).toBe('# Unsaved draft');

      await act(async () => renderer?.root.findByProps({ 'data-testid': 'wiki-instance-switch-open_zread@framework' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-instance-switch-open_zread@.' }).props['aria-pressed']).toBe(true);
      expect((renderer?.root.findByProps({ 'data-testid': 'wiki-editor-content' }).props.value)).toBe('# Unsaved draft');

      globalThis.confirm = () => true;
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'wiki-instance-switch-open_zread@framework' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands).toContainEqual({
        command: 'read_hub_open_zread_wiki',
        args: { projectId: firstProject.id, wikiId: 'open_zread@framework' },
      });
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-instance-switch-open_zread@framework' }).props['aria-pressed']).toBe(true);
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'nav-home' }).props.onClick());
      expect(renderer?.root.findAllByProps({ 'data-testid': 'open-zread-reader' })).toHaveLength(0);
    } finally {
      globalThis.confirm = originalConfirm;
      await act(async () => renderer?.unmount());
    }
  });

  test('lists Wiki history from the Reader and restores an explicit snapshot', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<HubApp service={service} />);
        await Promise.resolve();
      });
      await openProjectMenu(renderer);
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => renderer?.root.findByProps({ 'data-testid': 'open-wiki-qa' }).props.onClick());
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-qa-panel' })).toBeDefined();
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-wiki-history' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(renderer?.root.findByProps({ 'data-testid': 'wiki-history' })).toBeDefined();
      expect(renderer?.root.findAllByProps({ 'data-testid': 'wiki-qa-panel' })).toHaveLength(0);
      await act(async () => {
        renderer?.root.findByProps({ className: 'wiki-history-entry' }).findByType('button').props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(commands).toContainEqual({
        command: 'restore_hub_wiki_history',
        args: {
          projectId: firstProject.id,
          provider: 'open_zread',
          wikiId: 'open_zread@.',
          historyId: 'change-1',
        },
      });
    } finally {
      globalThis.confirm = originalConfirm;
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  test('opens the Zread Reader without a permanent project card and keeps project details in settings', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer?.root.findByProps({ 'data-testid': 'zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-overview' })).toBeDefined();
    expect(() => renderer?.root.findByProps({ className: 'project-workspace-header' })).toThrow();
    expect(renderer?.root.findByProps({ 'data-testid': 'project-wiki-toolbar' })).toBeDefined();
    expect(() => renderer?.root.findByProps({ className: 'wiki-reader-header' })).toThrow();
    expect(() => renderer?.root.findByProps({ className: 'wiki-reader-history-bar' })).toThrow();
    expect(renderer?.root.findByProps({ className: 'wiki-reader-toolbar-meta' }).props.title)
      .toContain('versions/2026-09-17-120000');

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-tab-settings' }).props.onClick();
    });
    expect(renderer?.root.findByProps({ className: 'project-settings-details' }).findAllByType('dd')[0]?.children.join(''))
      .toBe(firstProject.path);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('switches Providers without mixing page position or directory expansion state', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    await openProjectMenu(renderer);
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-wiki-search' }).props.onChange({ target: { value: '补充' } });
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-details' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-details' }).props['aria-label'])
      .toBe('补充说明, readable');
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-details' }).findAllByType('small'))
      .toHaveLength(0);
    expect(() => renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-architecture' })).toThrow();
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'project-wiki-search' }).props.onChange({ target: { value: '' } });
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-details' }).props.onClick();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-section-toggle-1' }).props.onClick();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-section-toggle-1' }).props['aria-expanded']).toBe(false);
    expect(renderer?.root.findByProps({ className: 'wiki-reader-section-chevron' })).toBeDefined();

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'provider-switch-zread' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-overview' })).toBeDefined();

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'provider-switch-open_zread' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-details' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-section-toggle-1' }).props['aria-expanded']).toBe(false);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
