import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, test } from 'bun:test';
import type { HubHealth, HubProject } from '@open-zread/hub-contract';
import HubApp from '../App';
import { createHubApplicationService, type HubTransport } from '../lib/application-service';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const healthyResponse: HubHealth = {
  appVersion: '0.1.0-test',
  runtime: 'tauri',
  os: 'windows',
  service: { name: 'Hub Application Service', status: 'healthy' },
  runner: { status: 'available', version: '1.2.2', executablePath: 'open-zread.exe' },
};

const firstProject: HubProject = {
  id: 'project-1',
  name: 'Alpha project',
  path: 'C:\\Work\\Alpha',
  previousPaths: [],
  sourceControl: 'git',
  availability: 'available',
  wiki: { openZread: 'readable', zread: 'missing' },
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
) {
  let projects = [firstProject, secondProject];
  const transport: HubTransport = {
    invoke: async (command, args) => {
      commands.push({ command, args });
      if (command === 'get_hub_health') return healthyResponse;
      if (command === 'list_hub_projects') return projects;
      if (command === 'set_hub_project_favorite') {
        const updated = { ...firstProject, favorite: args?.favorite === true };
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
      if (command === 'remove_hub_project') {
        projects = projects.filter((project) => project.id !== args?.projectId);
        return null;
      }
      return null;
    },
    listen: async () => () => undefined,
    selectProjectDirectory: async () => 'D:\\Projects\\Beta',
    copyText: async (text) => {
      copied.push(text);
    },
  };
  return createHubApplicationService(transport);
}

describe('Project Library UI', () => {
  test('filters by name/path and toggles favorite-only view', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    expect(renderer?.root.findAllByProps({ className: 'project-card' })).toHaveLength(2);

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

      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'copy-path-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'open-folder-project-1' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        renderer?.root.findByProps({ 'data-testid': 'relocate-project-2' }).props.onClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(copied).toEqual([firstProject.path]);
      expect(renderer?.root.findAllByProps({ className: 'project-path' }).map((node) => node.children.join(' '))).toContain('D:\\Projects\\Beta');

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
});
