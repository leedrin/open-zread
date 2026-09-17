import { describe, expect, test } from 'bun:test';
import type {
  HubProject,
  HubTask,
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
  provider: 'open_zread',
  operation: 'generate',
  model: 'Hub shared model configuration',
  startedAt: '1720000000000',
};

const zreadTask: HubTask = {
  ...task,
  taskId: 'task-zread-1',
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
    slug: 'overview',
    title: 'Overview',
    snippet: 'Provider 协同工作',
    path: 'Core/overview.md',
  }],
  failures: [],
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
      set_hub_project_favorite: relocatedProject,
      relocate_hub_project: relocatedProject,
      open_hub_project_folder: relocatedProject,
      open_hub_project_terminal: relocatedProject,
      remove_hub_project: null,
    }, copied, commands));

    await expect(service.setProjectFavorite(project.id, true)).resolves.toEqual(relocatedProject);
    await expect(service.relocateProject(project.id, relocatedProject.path)).resolves.toEqual(relocatedProject);
    await expect(service.openProjectFolder(project.id)).resolves.toEqual(relocatedProject);
    await expect(service.openProjectTerminal(project.id)).resolves.toEqual(relocatedProject);
    await expect(service.removeProject(project.id)).resolves.toBeUndefined();
    await expect(service.copyProjectPath(`  ${relocatedProject.path}  `)).resolves.toBeUndefined();

    expect(commands).toEqual([
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
    await expect(service.setProjectFavorite('', true)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.relocateProject(project.id, '  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.copyProjectPath('  ')).rejects.toMatchObject({ code: 'invalid_request' });
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
      create_hub_wiki_page: pageMutation,
      create_hub_wiki_pages: batchMutation,
      delete_hub_wiki_page: { ...pageMutation, action: 'deleted' },
      update_hub_wiki_page_metadata: { ...pageMutation, action: 'updated' },
      merge_hub_wiki_text: mergeResponse,
      ask_hub_wiki: answerResponse,
      rewrite_hub_wiki_page: changeSet,
      draft_hub_wiki_page: draftResponse,
    }, [], calls));

    await expect(service.startOpenZreadTask(project.id, 'generate')).resolves.toEqual(task);
    await expect(service.startZreadTask(project.id)).resolves.toEqual(zreadTask);
    await expect(service.previewWikiChange(project.id, 'open_zread', 'overview', '# After')).resolves.toEqual(changeSet);
    await expect(service.applyWikiChange(changeSet.changeSetId)).resolves.toMatchObject({ status: 'applied' });
    await expect(service.listWikiHistory(project.id, 'open_zread')).resolves.toEqual([historyEntry]);
    await expect(service.restoreWikiHistory(project.id, 'open_zread', historyEntry.id)).resolves.toEqual(historyEntry);
    await expect(service.searchWiki(' 协同 ')).resolves.toEqual(searchResponse);
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
      { command: 'start_hub_open_zread_task', args: { projectId: project.id, operation: 'generate' } },
      { command: 'start_hub_zread_task', args: { projectId: project.id } },
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

  test('rejects invalid task inputs before crossing the transport seam', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({}, [], calls));

    await expect(service.startOpenZreadTask('  ', 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.startOpenZreadTask(project.id, 'unsupported' as 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.createWikiPage(project.id, 'open_zread', {
      slug: ' ', title: 'Title', section: 'Section', content: '', associatedFiles: [],
    })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.updateWikiPageMetadata(project.id, 'open_zread', 'overview', {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toEqual([]);
  });
});
