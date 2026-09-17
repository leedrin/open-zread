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
      if (command === 'read_hub_open_zread_wiki') {
        return {
          provider: 'open_zread',
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
              content: '# 架构设计\n\n```mermaid\nflowchart LR\n```',
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
          provider: 'open_zread',
          operation: args?.operation,
          model: 'Hub shared model configuration',
          startedAt: '1720000000000',
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

  test('opens the OpenZread Reader with Mermaid, partial-page state, and source references', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer?.root.findByProps({ 'data-testid': 'open-zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-architecture' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'mermaid-block' })).toBeDefined();

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

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('starts an explicit OpenZread generation task from a Project card', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createLibraryService(commands, []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'generate-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(commands).toContainEqual({
      command: 'start_hub_open_zread_task',
      args: { projectId: firstProject.id, operation: 'generate' },
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'active-task' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'task-status' }).children).toEqual(['running']);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('opens the Zread Reader from the current version pointer through the shared Reader surface', async () => {
    const service = createLibraryService([], []);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer?.root.findByProps({ 'data-testid': 'zread-reader' })).toBeDefined();
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-page-overview' })).toBeDefined();
    expect(renderer?.root.findByProps({ className: 'wiki-reader-meta' }).children.join(' '))
      .toContain('versions/2026-09-17-120000');

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
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'open-open-zread-project-1' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-page-nav-details' }).props.onClick();
    });
    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'wiki-section-toggle-1' }).props.onClick();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'wiki-section-toggle-1' }).props['aria-expanded']).toBe(false);

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
