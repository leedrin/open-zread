import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { buildStandaloneCli } from './build-exe';
import {
  createHubRunnerManifest,
  getHubRunnerResourceLayout,
} from './hub-runner';

const ROOT = resolve(import.meta.dir, '..');
const HUB_RESOURCE_DIR = join(ROOT, 'apps', 'hub', 'src-tauri', 'resources');

async function runCommand(command: string[]) {
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(' ')}`);
  }
}

async function buildHubRunner() {
  console.log('Building Hub frontend and bundled OpenZread runner...');
  await runCommand(['bun', 'run', 'build']);

  const resourceLayout = getHubRunnerResourceLayout(HUB_RESOURCE_DIR);
  rmSync(resourceLayout.rootDir, { recursive: true, force: true });
  mkdirSync(resourceLayout.rootDir, { recursive: true });

  const result = await buildStandaloneCli(
    'bun-windows-x64',
    resourceLayout.rootDir,
    'open-zread.exe',
  );
  const missingResources = [
    result.executablePath,
    resourceLayout.browsePath,
    resourceLayout.yogaWasmPath,
    resourceLayout.treeSitterWasmPath,
    resourceLayout.mappingsWasmPath,
  ].filter((path) => !existsSync(path));
  if (missingResources.length > 0) {
    throw new Error(`Hub runner resources are incomplete:\n${missingResources.join('\n')}`);
  }
  writeFileSync(
    resourceLayout.manifestPath,
    `${JSON.stringify(createHubRunnerManifest(result.version), null, 2)}\n`,
    'utf8',
  );

  console.log(`Embedded OpenZread ${result.version}`);
  console.log(`Runner resources: ${resourceLayout.rootDir}`);
}

if (import.meta.main) {
  try {
    await buildHubRunner();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
