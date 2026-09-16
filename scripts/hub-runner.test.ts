import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  createHubRunnerManifest,
  getHubRunnerResourceLayout,
} from './hub-runner';

describe('Hub embedded OpenZread runner layout', () => {
  test('uses a deterministic resource-relative layout for Unicode and spaced paths', () => {
    const layout = getHubRunnerResourceLayout('F:\\安装包\\Open Zread Hub');

    expect(layout.rootDir).toBe(join('F:\\安装包\\Open Zread Hub', 'open-zread'));
    expect(layout.executablePath).toBe(join(layout.rootDir, 'open-zread.exe'));
    expect(layout.manifestPath).toBe(join(layout.rootDir, 'open-zread.manifest.json'));
    expect(layout.browsePath).toBe(join(layout.rootDir, 'browse'));
  });

  test('records the exact runner version and required adjacent resources', () => {
    expect(createHubRunnerManifest('  1.2.2  ')).toEqual({
      schemaVersion: 1,
      provider: 'open-zread',
      version: '1.2.2',
      executable: 'open-zread.exe',
      resources: ['browse', 'yoga.wasm', 'tree-sitter.wasm', 'mappings.wasm'],
    });
  });

  test('rejects an empty runner version', () => {
    expect(() => createHubRunnerManifest('  ')).toThrow('version is required');
  });
});
