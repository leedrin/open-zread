import { describe, expect, test } from 'bun:test';
import type { HubOpenZreadWiki, HubZreadWiki } from '@open-zread/hub-contract';
import {
  createHubApplicationService,
  type HubTransport,
} from '../lib/application-service';

function createTransport(
  responses: Record<string, unknown>,
  commands: Array<{ command: string; args?: Record<string, unknown> }>,
): HubTransport {
  return {
    invoke: async (command, args) => {
      commands.push({ command, args });
      return responses[command];
    },
    listen: async () => () => undefined,
    selectProjectDirectory: async () => null,
    copyText: async () => undefined,
  };
}

const wikiPayload: HubOpenZreadWiki = {
  provider: 'open_zread',
  wikiId: 'open_zread@.',
  sourceRoot: '.',
  status: 'partial',
  catalog: {
    id: 'catalog-1',
    generatedAt: '2026-09-17T00:00:00.000Z',
    language: 'zh',
    native: {
      id: 'catalog-1',
      providerMeta: { opaque: 'preserve-me' },
    },
  },
  pages: [
    {
      slug: 'architecture',
      title: '架构设计',
      file: 'architecture.md',
      section: '核心',
      level: 'Beginner',
      associatedFiles: ['src/main.ts'],
      status: 'readable',
      content: '# 架构设计\n\n```mermaid\nflowchart LR\n```',
      native: { providerOnlyField: true },
    },
    {
      slug: 'broken',
      title: '损坏页面',
      file: 'broken.md',
      section: '核心',
      associatedFiles: [],
      status: 'missing',
      error: 'Markdown page is missing.',
      native: { custom: 'kept' },
    },
  ],
};

const zreadPayload: HubZreadWiki = {
  ...wikiPayload,
  provider: 'zread',
  wikiId: 'zread@.',
  currentPointer: 'versions/2026-09-17-120000',
  versionId: '2026-09-17-120000',
};

describe('OpenZread Reader application-service interface', () => {
  test('reads a partial Wiki while preserving catalog and page native fields', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({
      read_hub_open_zread_wiki: wikiPayload,
      read_hub_open_zread_source: { path: 'src/main.ts', content: 'export {}\n' },
      read_hub_open_zread_asset: { path: 'images/diagram.png', mimeType: 'image/png', bytes: [137, 80, 78, 71] },
    }, commands));

    const parsedWiki = await service.readOpenZreadWiki(' project-1 ');
    expect(parsedWiki).toEqual(wikiPayload);
    await expect(service.readOpenZreadSource('project-1', ' src/main.ts ')).resolves.toEqual({
      path: 'src/main.ts',
      content: 'export {}\n',
    });
    await expect(service.readOpenZreadAsset('project-1', '核心/architecture.md', 'images/diagram.png'))
      .resolves.toEqual({
        path: 'images/diagram.png',
        mimeType: 'image/png',
        bytes: [137, 80, 78, 71],
      });

    expect(commands).toEqual([
      { command: 'read_hub_open_zread_wiki', args: { projectId: 'project-1' } },
      { command: 'read_hub_open_zread_source', args: { projectId: 'project-1', path: 'src/main.ts' } },
      {
        command: 'read_hub_open_zread_asset',
        args: { projectId: 'project-1', pagePath: '核心/architecture.md', assetPath: 'images/diagram.png' },
      },
    ]);
  });

  test('rejects malformed page data at the IPC boundary', async () => {
    const service = createHubApplicationService(createTransport({
      read_hub_open_zread_wiki: {
        ...wikiPayload,
        pages: [{ ...wikiPayload.pages[0], native: null }],
      },
    }, []));

    await expect(service.readOpenZreadWiki('project-1')).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });

  test('rejects empty reader identifiers before crossing the transport seam', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({}, calls));

    await expect(service.readOpenZreadWiki(' ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.readOpenZreadSource('project-1', ' ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.readOpenZreadAsset('project-1', '', 'diagram.png'))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toEqual([]);
  });

  test('reads Zread through the same normalized Wiki model and preserves current version metadata', async () => {
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const service = createHubApplicationService(createTransport({
      read_hub_zread_wiki: zreadPayload,
      read_hub_zread_source: { path: 'src/main.ts', content: '' },
      read_hub_zread_asset: { path: 'images/diagram.png', mimeType: 'image/png', bytes: [1, 2, 3] },
    }, commands));

    await expect(service.readZreadWiki(' project-1 ')).resolves.toEqual(zreadPayload);
    await expect(service.readZreadSource('project-1', ' src/main.ts ')).resolves.toEqual({
      path: 'src/main.ts',
      content: '',
    });
    await expect(service.readZreadAsset('project-1', 'Start/overview.md', 'images/diagram.png'))
      .resolves.toEqual({
        path: 'images/diagram.png',
        mimeType: 'image/png',
        bytes: [1, 2, 3],
      });
    expect(commands).toEqual([
      { command: 'read_hub_zread_wiki', args: { projectId: 'project-1' } },
      { command: 'read_hub_zread_source', args: { projectId: 'project-1', path: 'src/main.ts' } },
      {
        command: 'read_hub_zread_asset',
        args: { projectId: 'project-1', pagePath: 'Start/overview.md', assetPath: 'images/diagram.png' },
      },
    ]);
  });

  test('rejects malformed Zread current-version metadata at the IPC boundary', async () => {
    const service = createHubApplicationService(createTransport({
      read_hub_zread_wiki: { ...zreadPayload, currentPointer: 42 },
    }, []));

    await expect(service.readZreadWiki('project-1')).rejects.toMatchObject({
      name: 'HubProtocolError',
      code: 'internal_error',
    });
  });
});
