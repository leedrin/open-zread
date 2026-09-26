import { describe, expect, test } from 'bun:test';
import type {
  HubProject,
  HubProjectMarkdownTree,
  HubProjectMarkdownSearchResponse,
  HubMarkdownAnswerResponse,
  HubTask,
  HubWikiInstanceList,
  HubWikiChangeSet,
  HubWikiHistoryEntry,
  HubWikiAnswerResponse,
  HubWikiBatchMutationResponse,
  HubWikiMergeResponse,
  HubWikiPageDraftResponse,
  HubWikiPageMutationResponse,
  HubWikiSearchResponse,
} from '@open-zread/hub-contract';
import {
  createHubApplicationService,
  type HubTransport,
} from '../lib/application-service';

const project: HubProject = {
  id: 'project-1',
  name: 'Example project',
  path: 'C:\\Work\\Example project',
  previousPaths: [],
  sourceControl: 'git',
  availability: 'available',
  wiki: {
    openZread: 'readable',
    zread: 'missing',
  },
  favorite: false,
};

const task: HubTask = {
  taskId: 'task-1',
  kind: 'generation',
  status: 'running',
  projectId: project.id,
  wikiId: 'open_zread@.',
  provider: 'open_zread',
  operation: 'generate',
  model: 'Hub shared model configuration',
  startedAt: '1720000000000',
};

const zreadTask: HubTask = {
  ...task,
  taskId: 'task-zread-1',
  wikiId: 'zread@.',
  provider: 'zread',
  model: 'Zread native configuration',
};

const changeSet: HubWikiChangeSet = {
  changeSetId: 'change-1',
  projectId: project.id,
  provider: 'open_zread',
  slug: 'overview',
  relativePath: 'Core/overview.md',
  before: '# Before',
  after: '# After',
  status: 'preview',
  createdAt: '1720000000000',
};

const historyEntry: HubWikiHistoryEntry = {
  id: 'change-1',
  projectId: project.id,
  provider: 'open_zread',
  label: 'OpenZread change change-1',
  createdAt: '1720000000000',
  current: false,
  pageCount: 1,
};

const searchResponse: HubWikiSearchResponse = {
  query: '协同',
  results: [{
    projectId: project.id,
    projectName: project.name,
    provider: 'open_zread',
    wikiId: 'open_zread@.',
    sourceRoot: '.',
    slug: 'overview',
    title: 'Overview',
    snippet: 'Provider 协同工作',
    path: 'Core/overview.md',
  }],
  failures: [{
    projectId: project.id,
    projectName: project.name,
    provider: 'zread',
    wikiId: 'zread@systems',
    sourceRoot: 'systems',
    message: 'Wiki catalog is unreadable.',
  }],
  markdownResults: [{
    sourceKind: 'local_markdown',
    projectId: project.id,
    projectName: project.name,
    path: 'docs/guide.md',
    title: 'Guide',
    snippet: 'Provider 协同工作',
    matchKind: 'content',
    matchLine: 8,
    matchColumn: 12,
    matchLength: 2,
  }],
  markdownFailures: [],
};

const projectMarkdownSearchResponse: HubProjectMarkdownSearchResponse = {
  projectId: project.id,
  query: '协同',
  results: searchResponse.markdownResults,
  scanComplete: true,
  scannedFiles: 12,
  errors: [],
};

const markdownAnswer: HubMarkdownAnswerResponse = {
  projectId: project.id,
  path: 'docs/guide.md',
  title: 'Guide',
  model: 'anthropic/claude-test',
  answer: 'A read-only answer based on this document.',
};

const pageMutation: HubWikiPageMutationResponse = {
  projectId: project.id,
  provider: 'open_zread',
  slug: 'provider-collaboration',
  action: 'created',
  relativePath: 'Architecture/provider-collaboration.md',
};

const batchMutation: HubWikiBatchMutationResponse = {
  projectId: project.id,
  provider: 'open_zread',
  mutations: [pageMutation, { ...pageMutation, slug: 'second-page', relativePath: 'Architecture/second-page.md' }],
};

const mergeResponse: HubWikiMergeResponse = {
  status: 'clean',
  content: '# Merged',
  conflicts: [],
};

const answerResponse: HubWikiAnswerResponse = {
  projectId: project.id,
  provider: 'open_zread',
  slug: 'overview',
  answer: 'The page explains the architecture.',
  references: [{ slug: 'overview', title: 'Overview' }],
};

const draftResponse: HubWikiPageDraftResponse = {
  provider: 'open_zread',
  slug: 'provider-collaboration',
  title: 'Provider Collaboration',
  section: 'Architecture',
  content: '# Collaboration',
  associatedFiles: ['src/provider.ts'],
};

function createTransport(
  responses: Record<string, unknown>,
  copied: string[],
  commands: Array<{ command: string; args?: Record<string, unknown> }>,
): HubTransport {
  return {
    invoke: async (command, args) => {
      commands.push({ command, args });
      return responses[command];
    },
    listen: async () => () => undefined,
    selectProjectDirectory: async () => null,
    copyText: async (text) => {
      copied.push(text);
    },
  };
}

describe('Project Library application-service interface', () => {
  test('lists nested Wiki instances with stable identities and scan status', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const listing: HubWikiInstanceList = {
      projectId: project.id,
      instances: [
        { wikiId: 'open_zread@.', provider: 'open_zread', sourceRoot: '.', label: '根目录 · OpenZread', status: 'readable' },
        { wikiId: 'zread@framework', provider: 'zread', sourceRoot: 'framework', label: 'framework · Zread', status: 'partial' },
      ],
      scanComplete: false,
      scannedDirectories: 20_000,
      warning: 'Wiki discovery reached its directory limit.',
    };
    const service = createHubApplicationService(createTransport({
      list_hub_project_wikis: listing,
    }, [], calls));

    await expect(service.listProjectWikis(project.id)).resolves.toEqual(listing);
    expect(calls).toEqual([{ command: 'list_hub_project_wikis', args: { projectId: project.id } }]);
  });

  test('locates Wiki instances from a user-selected in-project directory', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const listing: HubWikiInstanceList = {
      projectId: project.id,
      instances: [{ wikiId: 'open_zread@framework', provider: 'open_zread', sourceRoot: 'framework', label: 'framework · OpenZread', status: 'readable' }],
      scanComplete: true,
      scannedDirectories: 4,
    };
    const service = createHubApplicationService(createTransport({
      locate_hub_project_wikis: listing,
    }, [], calls));

    await expect(service.locateProjectWikis(project.id, ' C:\\Work\\Example project\\framework ')).resolves.toEqual(listing);
    expect(calls).toEqual([{
      command: 'locate_hub_project_wikis',
      args: { projectId: project.id, directory: 'C:\\Work\\Example project\\framework' },
    }]);
  });

  test('passes the selected Wiki instance to Reader and resource commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const wikiId = 'open_zread@framework';
    const service = createHubApplicationService(createTransport({
      read_hub_open_zread_wiki: {
        provider: 'open_zread',
        wikiId,
        sourceRoot: 'framework',
        status: 'readable',
        catalog: { native: {} },
        pages: [],
      },
      read_hub_open_zread_source: { path: 'src/main.ts', content: 'export {};' },
      read_hub_open_zread_asset: { path: 'diagram.png', mimeType: 'image/png', bytes: [137, 80] },
    }, [], calls));

    await expect(service.readOpenZreadWiki(project.id, wikiId)).resolves.toMatchObject({ wikiId, sourceRoot: 'framework' });
    await expect(service.readOpenZreadSource(project.id, 'src/main.ts', wikiId)).resolves.toEqual({
      path: 'src/main.ts', content: 'export {};',
    });
    await expect(service.readOpenZreadAsset(project.id, 'docs/page.md', 'diagram.png', wikiId)).resolves.toEqual({
      path: 'diagram.png', mimeType: 'image/png', bytes: [137, 80],
    });
    expect(calls).toEqual([
      { command: 'read_hub_open_zread_wiki', args: { projectId: project.id, wikiId } },
      { command: 'read_hub_open_zread_source', args: { projectId: project.id, path: 'src/main.ts', wikiId } },
      { command: 'read_hub_open_zread_asset', args: { projectId: project.id, pagePath: 'docs/page.md', assetPath: 'diagram.png', wikiId } },
    ]);
  });

  test('rescans and reads Markdown documents through local-file commands', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const tree: HubProjectMarkdownTree = {
      projectId: project.id,
      roots: [{
        kind: 'directory',
        name: 'docs',
        relativePath: 'docs',
        children: [{
          kind: 'file',
          name: 'guide.md',
          relativePath: 'docs/guide.md',
          title: 'Guide',
          bytes: 32,
          modifiedAt: '1720000000000',
        }],
      }],
      scanComplete: true,
      scannedDirectories: 2,
      scannedFiles: 1,
      errors: [],
    };
    const document = {
      projectId: project.id,
      relativePath: 'docs/guide.md',
      title: 'Guide',
      content: '# Guide',
      revision: 'guide-rev-1',
    };
    const image = { path: 'assets/diagram.png', mimeType: 'image/png', bytes: [137, 80, 78, 71] };
    const source = { path: 'src/main.lua', content: 'local answer = 42\n' };
    const service = createHubApplicationService(createTransport({
      list_hub_project_markdown: tree,
      read_hub_project_markdown: document,
      save_hub_project_markdown: { ...document, title: 'Updated Guide', content: '# Updated Guide', revision: 'guide-rev-2' },
      read_hub_project_markdown_asset: image,
      read_hub_project_markdown_source: source,
    }, [], calls));

    await expect(service.listProjectMarkdown(` ${project.id} `)).resolves.toEqual(tree);
    await expect(service.readProjectMarkdown(project.id, 'docs/guide.md')).resolves.toEqual(document);
    await expect(service.saveProjectMarkdown(project.id, 'docs/guide.md', 'guide-rev-1', '# Updated Guide')).resolves.toEqual({
      ...document,
      title: 'Updated Guide',
      content: '# Updated Guide',
      revision: 'guide-rev-2',
    });
    await expect(service.readProjectMarkdownAsset(project.id, 'docs/guide.md', '../assets/diagram.png')).resolves.toEqual(image);
    await expect(service.readProjectMarkdownSource(project.id, 'docs/guide.md', '../src/main.lua')).resolves.toEqual(source);
    expect(calls).toEqual([
      { command: 'list_hub_project_markdown', args: { projectId: project.id } },
      { command: 'read_hub_project_markdown', args: { projectId: project.id, relativePath: 'docs/guide.md' } },
      { command: 'save_hub_project_markdown', args: { projectId: project.id, relativePath: 'docs/guide.md', baseRevision: 'guide-rev-1', content: '# Updated Guide' } },
      {
        command: 'read_hub_project_markdown_asset',
        args: { projectId: project.id, documentPath: 'docs/guide.md', assetPath: '../assets/diagram.png' },
      },
      {
        command: 'read_hub_project_markdown_source',
        args: { projectId: project.id, documentPath: 'docs/guide.md', sourcePath: '../src/main.lua' },
      },
    ]);
  });

  test('routes project management actions through typed commands', async () => {
    const relocatedProject = {
      ...project,
      path: 'D:\\Projects\\Example project',
      previousPaths: [project.path],
      favorite: true,
      lastOpenedAt: '456',
    };
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const copied: string[] = [];
    const service = createHubApplicationService(createTransport({
      rename_hub_project: { ...project, name: 'Renamed project' },
      set_hub_project_favorite: relocatedProject,
      relocate_hub_project: relocatedProject,
      open_hub_project_folder: relocatedProject,
      open_hub_project_terminal: relocatedProject,
      remove_hub_project: null,
    }, copied, commands));

    await expect(service.renameProject(project.id, ' Renamed project ')).resolves.toMatchObject({ name: 'Renamed project' });
    await expect(service.setProjectFavorite(project.id, true)).resolves.toEqual(relocatedProject);
    await expect(service.relocateProject(project.id, relocatedProject.path)).resolves.toEqual(relocatedProject);
    await expect(service.openProjectFolder(project.id)).resolves.toEqual(relocatedProject);
    await expect(service.openProjectTerminal(project.id)).resolves.toEqual(relocatedProject);
    await expect(service.removeProject(project.id)).resolves.toBeUndefined();
    await expect(service.copyProjectPath(`  ${relocatedProject.path}  `)).resolves.toBeUndefined();

    expect(commands).toEqual([
      { command: 'rename_hub_project', args: { projectId: project.id, name: 'Renamed project' } },
      { command: 'set_hub_project_favorite', args: { projectId: project.id, favorite: true } },
      { command: 'relocate_hub_project', args: { projectId: project.id, path: relocatedProject.path } },
      { command: 'open_hub_project_folder', args: { projectId: project.id } },
      { command: 'open_hub_project_terminal', args: { projectId: project.id } },
      { command: 'remove_hub_project', args: { projectId: project.id } },
    ]);
    expect(copied).toEqual([relocatedProject.path]);
  });

  test('rejects malformed project action responses at the IPC boundary', async () => {
    const service = createHubApplicationService(createTransport({
      set_hub_project_favorite: { ...project, availability: 'unknown' },
    }, [], []));

    await expect(service.setProjectFavorite(project.id, true)).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });

  test('rejects empty project ids and paths before crossing the transport seam', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({}, [], calls));

    await expect(service.openProjectFolder('  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.renameProject('  ', 'Renamed')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.renameProject(project.id, '  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.setProjectFavorite('', true)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.relocateProject(project.id, '  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.copyProjectPath('  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.askProjectMarkdown(project.id, 'docs/guide.md', '  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.askProjectMarkdown('  ', 'docs/guide.md', 'Question')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toEqual([]);
  });

  test('starts OpenZread generation and sync through the typed task command', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({
      start_hub_open_zread_task: task,
      start_hub_zread_task: zreadTask,
      preview_hub_wiki_change: changeSet,
      apply_hub_wiki_change: { ...changeSet, status: 'applied' },
      list_hub_wiki_history: [historyEntry],
      restore_hub_wiki_history: historyEntry,
      search_hub_wiki: searchResponse,
      search_hub_project_markdown: projectMarkdownSearchResponse,
      ask_hub_project_markdown: markdownAnswer,
      create_hub_wiki_page: pageMutation,
      create_hub_wiki_pages: batchMutation,
      delete_hub_wiki_page: { ...pageMutation, action: 'deleted' },
      update_hub_wiki_page_metadata: { ...pageMutation, action: 'updated' },
      merge_hub_wiki_text: mergeResponse,
      ask_hub_wiki: answerResponse,
      rewrite_hub_wiki_page: changeSet,
      draft_hub_wiki_page: draftResponse,
    }, [], calls));

    await expect(service.startOpenZreadTask(project.id, 'open_zread@.', 'generate')).resolves.toEqual(task);
    await expect(service.startOpenZreadTask(project.id, 'open_zread@.', 'generate', true)).resolves.toEqual(task);
    await expect(service.startZreadTask(project.id, 'zread@.')).resolves.toEqual(zreadTask);
    await expect(service.previewWikiChange(project.id, 'open_zread', 'overview', '# After')).resolves.toEqual(changeSet);
    await expect(service.applyWikiChange(changeSet.changeSetId)).resolves.toMatchObject({ status: 'applied' });
    await expect(service.listWikiHistory(project.id, 'open_zread')).resolves.toEqual([historyEntry]);
    await expect(service.restoreWikiHistory(project.id, 'open_zread', historyEntry.id)).resolves.toEqual(historyEntry);
    await expect(service.searchWiki(' 协同 ')).resolves.toEqual(searchResponse);
    await expect(service.searchProjectMarkdown(` ${project.id} `, ' 协同 ')).resolves.toEqual(projectMarkdownSearchResponse);
    await expect(service.askProjectMarkdown(project.id, ' docs/guide.md ', ' What is this? ', ' selected excerpt ')).resolves.toEqual(markdownAnswer);
    await expect(service.createWikiPage(project.id, 'open_zread', {
      slug: ' provider-collaboration ',
      title: 'Provider Collaboration',
      section: 'Architecture',
      group: 'Core',
      content: '# Collaboration',
      associatedFiles: ['src/provider.ts'],
    })).resolves.toEqual(pageMutation);
    await expect(service.createWikiPages(project.id, 'open_zread', [
      {
        slug: 'provider-collaboration',
        title: 'Provider Collaboration',
        section: 'Architecture',
        content: '# Collaboration',
        associatedFiles: ['src/provider.ts'],
      },
      {
        slug: 'second-page',
        title: 'Second page',
        section: 'Architecture',
        content: '# Second',
        associatedFiles: [],
      },
    ])).resolves.toEqual(batchMutation);
    await expect(service.deleteWikiPage(project.id, 'open_zread', ' provider-collaboration ')).resolves.toMatchObject({ action: 'deleted' });
    await expect(service.updateWikiPageMetadata(project.id, 'open_zread', 'provider-collaboration', {
      newSlug: 'provider-collaboration-v2',
      title: 'Provider Collaboration v2',
      section: 'Architecture',
    })).resolves.toMatchObject({ action: 'updated' });
    await expect(service.mergeWikiText('# Base', '# Local', '# Incoming')).resolves.toEqual(mergeResponse);
    await expect(service.askWiki(project.id, 'open_zread', 'overview', 'What is this?')).resolves.toEqual(answerResponse);
    await expect(service.rewriteWikiPage(project.id, 'open_zread', 'overview', 'Clarify it', 'Architecture')).resolves.toEqual(changeSet);
    await expect(service.draftWikiPage(project.id, 'open_zread', 'Provider collaboration')).resolves.toEqual(draftResponse);
    expect(calls).toEqual([
      { command: 'start_hub_open_zread_task', args: { projectId: project.id, wikiId: 'open_zread@.', operation: 'generate', resume: false } },
      { command: 'start_hub_open_zread_task', args: { projectId: project.id, wikiId: 'open_zread@.', operation: 'generate', resume: true } },
      { command: 'start_hub_zread_task', args: { projectId: project.id, wikiId: 'zread@.' } },
      {
        command: 'preview_hub_wiki_change',
        args: { projectId: project.id, provider: 'open_zread', slug: 'overview', content: '# After' },
      },
      { command: 'apply_hub_wiki_change', args: { changeSetId: changeSet.changeSetId } },
      { command: 'list_hub_wiki_history', args: { projectId: project.id, provider: 'open_zread' } },
      {
        command: 'restore_hub_wiki_history',
        args: { projectId: project.id, provider: 'open_zread', historyId: historyEntry.id },
      },
      { command: 'search_hub_wiki', args: { query: '协同' } },
      { command: 'search_hub_project_markdown', args: { projectId: project.id, query: '协同' } },
      { command: 'ask_hub_project_markdown', args: { projectId: project.id, relativePath: 'docs/guide.md', question: 'What is this?', selectedText: 'selected excerpt' } },
      {
        command: 'create_hub_wiki_page',
        args: {
          projectId: project.id,
          provider: 'open_zread',
          slug: 'provider-collaboration',
          title: 'Provider Collaboration',
          section: 'Architecture',
          group: 'Core',
          content: '# Collaboration',
          associatedFiles: ['src/provider.ts'],
        },
      },
      {
        command: 'create_hub_wiki_pages',
        args: {
          projectId: project.id,
          provider: 'open_zread',
          pages: [
            {
              slug: 'provider-collaboration',
              title: 'Provider Collaboration',
              section: 'Architecture',
              content: '# Collaboration',
              associatedFiles: ['src/provider.ts'],
            },
            {
              slug: 'second-page',
              title: 'Second page',
              section: 'Architecture',
              content: '# Second',
              associatedFiles: [],
            },
          ],
        },
      },
      {
        command: 'delete_hub_wiki_page',
        args: { projectId: project.id, provider: 'open_zread', slug: 'provider-collaboration' },
      },
      {
        command: 'update_hub_wiki_page_metadata',
        args: {
          projectId: project.id,
          provider: 'open_zread',
          slug: 'provider-collaboration',
          newSlug: 'provider-collaboration-v2',
          title: 'Provider Collaboration v2',
          section: 'Architecture',
        },
      },
      {
        command: 'merge_hub_wiki_text',
        args: { base: '# Base', local: '# Local', incoming: '# Incoming' },
      },
      {
        command: 'ask_hub_wiki',
        args: { projectId: project.id, provider: 'open_zread', slug: 'overview', question: 'What is this?' },
      },
      {
        command: 'rewrite_hub_wiki_page',
        args: {
          projectId: project.id,
          provider: 'open_zread',
          slug: 'overview',
          instruction: 'Clarify it',
          sectionHeading: 'Architecture',
        },
      },
      {
        command: 'draft_hub_wiki_page',
        args: { projectId: project.id, provider: 'open_zread', topic: 'Provider collaboration' },
      },
    ]);
  });

  test('preserves project and Wiki identity when parsing task progress events', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const payload = {
      taskId: 'nested-task',
      projectId: project.id,
      wikiId: 'open_zread@framework',
      kind: 'generation',
      status: 'failed',
      phase: 'page-generation',
      occurredAt: '1720000000000',
      message: 'Generation paused.',
      details: 'framework/page.md: provider timeout',
      progress: { current: 3, total: 5, succeeded: 2, failed: 1 },
      canResume: true,
    };
    let received: unknown;
    const base = createTransport({}, [], commands);
    const service = createHubApplicationService({
      ...base,
      listen: async (_event, listener) => {
        listener({ payload });
        return () => undefined;
      },
    });

    await service.subscribeToTaskEvents((event) => { received = event; });

    expect(received).toEqual({
      taskId: 'nested-task',
      projectId: project.id,
      wikiId: 'open_zread@framework',
      kind: 'generation',
      status: 'failed',
      phase: 'page-generation',
      occurredAt: '1720000000000',
      message: 'Generation paused.',
      details: 'framework/page.md: provider timeout',
      progress: { current: 3, total: 5, succeeded: 2, failed: 1 },
      canResume: true,
    });
  });

  test('binds nested Wiki edits, AI actions and history commands to the selected instance', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const wikiId = 'open_zread@framework';
    const service = createHubApplicationService(createTransport({
      preview_hub_wiki_change: { ...changeSet, wikiId },
      preview_hub_wiki_structure_change: { ...changeSet, wikiId, operation: 'delete' },
      list_hub_wiki_history: [{ ...historyEntry, wikiId }],
      restore_hub_wiki_history: { ...historyEntry, wikiId },
      create_hub_wiki_page: { ...pageMutation, wikiId },
      create_hub_wiki_pages: { ...batchMutation, wikiId },
      delete_hub_wiki_page: { ...pageMutation, wikiId, action: 'deleted' },
      update_hub_wiki_page_metadata: { ...pageMutation, wikiId, action: 'updated' },
      ask_hub_wiki: answerResponse,
      rewrite_hub_wiki_page: { ...changeSet, wikiId },
      draft_hub_wiki_page: draftResponse,
    }, [], calls));

    await service.previewWikiChange(project.id, 'open_zread', 'overview', '# Updated', wikiId);
    await service.previewWikiStructureChange(project.id, 'open_zread', { operation: 'delete', slug: 'overview' }, wikiId);
    await service.listWikiHistory(project.id, 'open_zread', wikiId);
    await service.restoreWikiHistory(project.id, 'open_zread', historyEntry.id, wikiId);
    await service.createWikiPage(project.id, 'open_zread', {
      slug: 'new-page', title: 'New page', section: 'Architecture', content: '# New', associatedFiles: [],
    }, wikiId);
    await service.createWikiPages(project.id, 'open_zread', [{
      slug: 'batch-page', title: 'Batch page', section: 'Architecture', content: '# Batch', associatedFiles: [],
    }], wikiId);
    await service.deleteWikiPage(project.id, 'open_zread', 'overview', wikiId);
    await service.updateWikiPageMetadata(project.id, 'open_zread', 'overview', { title: 'Renamed overview' }, wikiId);
    await service.askWiki(project.id, 'open_zread', 'overview', 'Question', 'Selected passage', wikiId);
    await service.rewriteWikiPage(project.id, 'open_zread', 'overview', 'Clarify', 'Architecture', wikiId);
    await service.draftWikiPage(project.id, 'open_zread', 'New topic', 'Architecture', wikiId);

    expect(calls.map(({ command, args }) => [command, args?.wikiId])).toEqual([
      ['preview_hub_wiki_change', wikiId],
      ['preview_hub_wiki_structure_change', wikiId],
      ['list_hub_wiki_history', wikiId],
      ['restore_hub_wiki_history', wikiId],
      ['create_hub_wiki_page', wikiId],
      ['create_hub_wiki_pages', wikiId],
      ['delete_hub_wiki_page', wikiId],
      ['update_hub_wiki_page_metadata', wikiId],
      ['ask_hub_wiki', wikiId],
      ['rewrite_hub_wiki_page', wikiId],
      ['draft_hub_wiki_page', wikiId],
    ]);
  });

  test('rejects invalid task inputs before crossing the transport seam', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({}, [], calls));

    await expect(service.startOpenZreadTask('  ', 'open_zread@.', 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.startOpenZreadTask(project.id, '  ', 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.startOpenZreadTask(project.id, 'open_zread@.', 'unsupported' as 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.createWikiPage(project.id, 'open_zread', {
      slug: ' ', title: 'Title', section: 'Section', content: '', associatedFiles: [],
    })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.updateWikiPageMetadata(project.id, 'open_zread', 'overview', {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toEqual([]);
  });
});
