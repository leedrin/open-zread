import { join, resolve } from 'path';

export const HUB_RUNNER_RESOURCE_DIR = 'open-zread';
export const HUB_RUNNER_EXECUTABLE = 'open-zread.exe';
export const HUB_RUNNER_MANIFEST = 'open-zread.manifest.json';

export interface HubRunnerManifest {
  schemaVersion: 1;
  provider: 'open-zread';
  version: string;
  executable: typeof HUB_RUNNER_EXECUTABLE;
  resources: readonly ['browse', 'yoga.wasm', 'tree-sitter.wasm', 'mappings.wasm'];
}

export interface HubRunnerResourceLayout {
  rootDir: string;
  executablePath: string;
  manifestPath: string;
  browsePath: string;
  yogaWasmPath: string;
  treeSitterWasmPath: string;
  mappingsWasmPath: string;
}

export function getHubRunnerResourceLayout(resourceDir: string): HubRunnerResourceLayout {
  const rootDir = resolve(resourceDir, HUB_RUNNER_RESOURCE_DIR);
  return {
    rootDir,
    executablePath: join(rootDir, HUB_RUNNER_EXECUTABLE),
    manifestPath: join(rootDir, HUB_RUNNER_MANIFEST),
    browsePath: join(rootDir, 'browse'),
    yogaWasmPath: join(rootDir, 'yoga.wasm'),
    treeSitterWasmPath: join(rootDir, 'tree-sitter.wasm'),
    mappingsWasmPath: join(rootDir, 'mappings.wasm'),
  };
}

export function createHubRunnerManifest(version: string): HubRunnerManifest {
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    throw new Error('The embedded OpenZread runner version is required.');
  }

  return {
    schemaVersion: 1,
    provider: 'open-zread',
    version: normalizedVersion,
    executable: HUB_RUNNER_EXECUTABLE,
    resources: ['browse', 'yoga.wasm', 'tree-sitter.wasm', 'mappings.wasm'],
  };
}
