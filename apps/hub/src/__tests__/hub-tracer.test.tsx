import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, test } from 'bun:test';
import type { HubHealth, HubTaskEvent } from '@open-zread/hub-contract';
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

describe('Hub React to application-service tracer bullet', () => {
  test('invokes a typed command and renders the returned health in React', async () => {
    const commands: string[] = [];
    let taskListener: ((event: { payload: unknown }) => void) | undefined;
    const transport: HubTransport = {
      invoke: async (command: string) => {
        commands.push(command);
        return healthyResponse;
      },
      listen: async (_event, listener) => {
        taskListener = listener;
        return () => undefined;
      },
    };
    const service = createHubApplicationService(transport);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<HubApp service={service} />);
      await Promise.resolve();
    });

    expect(commands).toEqual(['get_hub_health']);
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
    };
    const service = createHubApplicationService(transport);

    await expect(service.getHealth()).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });
});
