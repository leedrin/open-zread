import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, test } from 'bun:test';
import type { HubHealth, HubProject, HubTaskEvent } from '@open-zread/hub-contract';
import HubApp from '../App';
import {
  createHubApplicationService,
  type HubTransport,
} from '../lib/application-service';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const healthyResponse: HubHealth = {
  appVersion: '0.1.0-test',
  runtime: 'tauri',
  os: 'windows',
  service: {
    name: 'Hub Application Service',
    status: 'healthy',
  },
  runner: {
    status: 'available',
    version: '1.2.2',
    executablePath: 'C:\\Program Files\\Open Zread Hub\\resources\\open-zread\\open-zread.exe',
  },
};

const registeredProject: HubProject = {
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

describe('Hub React to application-service tracer bullet', () => {
  test('invokes a typed command and renders the returned health in React', async () => {
    const commands: string[] = [];
    let taskListener: ((event: { payload: unknown }) => void) | undefined;
    const transport: HubTransport = {
      invoke: async (command: string) => {
        commands.push(command);
        return command === 'get_hub_health' ? healthyResponse : [];
      },
      listen: async (_event, listener) => {
        taskListener = listener;
        return () => undefined;
      },
      selectProjectDirectory: async () => null,
    };
    const service = createHubApplicationService(transport);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    expect(commands).toEqual(['get_hub_health', 'list_hub_projects']);
    expect(renderer?.root.findByProps({ 'data-testid': 'service-status' }).children).toEqual(['healthy']);
    expect(renderer?.root.findByProps({ 'data-testid': 'app-version' }).children).toEqual(['0.1.0-test']);
    expect(renderer?.root.findByProps({ 'data-testid': 'runner-status' }).children).toEqual(['available']);
    expect(renderer?.root.findByProps({ 'data-testid': 'runner-version' }).children).toEqual(['1.2.2']);
    expect(renderer?.root.findByProps({ 'data-testid': 'runner-path' }).children).toEqual([
      'C:\\Program Files\\Open Zread Hub\\resources\\open-zread\\open-zread.exe',
    ]);

    const taskEvent: HubTaskEvent = {
      taskId: 'task-1',
      kind: 'generation',
      status: 'running',
      phase: 'planning',
      occurredAt: '2026-09-16T00:00:00.000Z',
    };
    await act(async () => {
      taskListener?.({ payload: taskEvent });
      await Promise.resolve();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'last-task-event' }).children).toEqual(['planning', ': ', 'running']);

    await act(async () => {
      renderer?.unmount();
    });
  });

  test('rejects malformed command responses at the IPC boundary', async () => {
    const transport: HubTransport = {
      invoke: async () => ({ service: { status: 'healthy' } }),
      listen: async () => () => undefined,
      selectProjectDirectory: async () => null,
    };
    const service = createHubApplicationService(transport);

    await expect(service.getHealth()).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });

  test('rejects a health response without embedded runner information', async () => {
    const transport: HubTransport = {
      invoke: async () => ({
        ...healthyResponse,
        runner: undefined,
      }),
      listen: async () => () => undefined,
      selectProjectDirectory: async () => null,
    };
    const service = createHubApplicationService(transport);

    await expect(service.getHealth()).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });

  test('lists projects, opens the native picker, and registers through typed commands', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const transport: HubTransport = {
      invoke: async (command, args) => {
        commands.push({ command, args });
        if (command === 'list_hub_projects') return [registeredProject];
        return { project: registeredProject, created: true };
      },
      listen: async () => () => undefined,
      selectProjectDirectory: async () => registeredProject.path,
    };
    const service = createHubApplicationService(transport);

    await expect(service.listProjects()).resolves.toEqual([registeredProject]);
    await expect(service.selectProjectDirectory()).resolves.toBe(registeredProject.path);
    await expect(service.registerProject(`  ${registeredProject.path}  `)).resolves.toEqual({
      project: registeredProject,
      created: true,
    });
    expect(commands).toEqual([
      { command: 'list_hub_projects' },
      { command: 'register_hub_project', args: { path: registeredProject.path } },
    ]);
  });

  test('rejects a malformed project list at the IPC boundary', async () => {
    const transport: HubTransport = {
      invoke: async () => [{ ...registeredProject, availability: 'unknown' }],
      listen: async () => () => undefined,
      selectProjectDirectory: async () => null,
    };
    const service = createHubApplicationService(transport);

    await expect(service.listProjects()).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });

  test('renders the project library and reports duplicate registration', async () => {
    let selected = false;
    const transport: HubTransport = {
      invoke: async (command) => command === 'get_hub_health'
        ? healthyResponse
        : [registeredProject],
      listen: async () => () => undefined,
      selectProjectDirectory: async () => {
        selected = true;
        return registeredProject.path;
      },
    };
    const service = createHubApplicationService({
      ...transport,
      invoke: async (command, args) => {
        if (command === 'register_hub_project') {
          expect(args).toEqual({ path: registeredProject.path });
          return { project: registeredProject, created: false };
        }
        return transport.invoke(command, args);
      },
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });
    expect(renderer?.root.findByProps({ 'data-testid': 'project-project-1' })).toBeDefined();

    await act(async () => {
      renderer?.root.findByProps({ 'data-testid': 'add-project' }).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selected).toBe(true);
    expect(renderer?.root.findByProps({ role: 'status' }).children).toEqual([
      'Project is already in your library.',
    ]);
    await act(async () => {
      renderer?.unmount();
    });
  });
});
