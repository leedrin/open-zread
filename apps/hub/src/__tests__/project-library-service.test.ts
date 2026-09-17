import { describe, expect, test } from 'bun:test';
import type { HubProject } from '@open-zread/hub-contract';
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
});
