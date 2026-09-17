import { describe, expect, test } from 'bun:test';
import type { HubProject, HubTask, HubWikiChangeSet } from '@open-zread/hub-contract';
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
    }, [], calls));

    await expect(service.startOpenZreadTask(project.id, 'generate')).resolves.toEqual(task);
    await expect(service.startZreadTask(project.id)).resolves.toEqual(zreadTask);
    await expect(service.previewWikiChange(project.id, 'open_zread', 'overview', '# After')).resolves.toEqual(changeSet);
    await expect(service.applyWikiChange(changeSet.changeSetId)).resolves.toMatchObject({ status: 'applied' });
    expect(calls).toEqual([
      { command: 'start_hub_open_zread_task', args: { projectId: project.id, operation: 'generate' } },
      { command: 'start_hub_zread_task', args: { projectId: project.id } },
      {
        command: 'preview_hub_wiki_change',
        args: { projectId: project.id, provider: 'open_zread', slug: 'overview', content: '# After' },
      },
      { command: 'apply_hub_wiki_change', args: { changeSetId: changeSet.changeSetId } },
    ]);
  });

  test('rejects invalid task inputs before crossing the transport seam', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({}, [], calls));

    await expect(service.startOpenZreadTask('  ', 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.startOpenZreadTask(project.id, 'unsupported' as 'generate')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toEqual([]);
  });
});
