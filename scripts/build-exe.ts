import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';

const TARGETS = {
  'bun-windows-x64': { os: 'windows', arch: 'x64', ext: '.exe' },
  'bun-darwin-arm64': { os: 'darwin', arch: 'arm64', ext: '' },
  'bun-darwin-x64': { os: 'darwin', arch: 'x64', ext: '' },
  'bun-linux-x64': { os: 'linux', arch: 'x64', ext: '' },
} as const;

type TargetKey = keyof typeof TARGETS;

const ROOT = resolve(import.meta.dir, '..');
const SRC_ENTRY = join(ROOT, 'apps', 'cli', 'src', 'index.tsx');
const OUT_DIR = join(ROOT, 'dist', 'exe');
const SHIM_PATH = join(ROOT, 'scripts', 'yoga-wasm-auto-shim.ts');

function findFileRecursively(dir: string, target: string): string | null {
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === target) return fullPath;
        if (stat.isDirectory()) {
          const found = findFileRecursively(fullPath, target);
          if (found) return found;
        }
      } catch {
        // Ignore packages that disappear during an install or contain unreadable files.
      }
    }
  } catch {
    // Ignore missing dependency directories and report a useful error at the call site.
  }
  return null;
}

function findWasm(name: string, required: boolean): string | null {
  const found = findFileRecursively(join(ROOT, 'node_modules'), name);
  if (!found && required) {
    throw new Error(`${name} not found in node_modules`);
  }
  return found;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let target: TargetKey | undefined;
  let all = false;
  let skipBuild = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && args[i + 1]) {
      target = args[i + 1] as TargetKey;
      i++;
    } else if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length) as TargetKey;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--skip-build') {
      skipBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!target && !all) {
    console.error('Error: --target <platform> or --all is required\n');
    printUsage();
    process.exit(1);
  }

  if (target && !(target in TARGETS)) {
    console.error(`Error: Unknown target "${target}"\n`);
    printUsage();
    process.exit(1);
  }

  return { target, all, skipBuild };
}

function printUsage() {
  console.log(`Usage: bun run scripts/build-exe.ts [options]

Options:
  --target <platform>  Build for specific platform
  --all                Build for all platforms
  --skip-build         Skip turbo build (use existing dist/)
  --help               Show this help

Platforms:
  ${Object.keys(TARGETS).join('\n  ')}

Examples:
  bun run scripts/build-exe.ts --target=bun-windows-x64
  bun run scripts/build-exe.ts --all --skip-build
`);
}

export function copyAssets(targetDir: string) {
  const browseDist = join(ROOT, 'apps', 'browse', 'dist');
  if (existsSync(browseDist)) {
    cpSync(browseDist, join(targetDir, 'browse'), { recursive: true });
    console.log('  Copied browse/ directory');
  } else {
    console.warn('  Warning: browse/ dist not found — run "bun run build" first');
  }

  for (const name of ['yoga.wasm', 'tree-sitter.wasm', 'mappings.wasm']) {
    const source = findWasm(name, name !== 'mappings.wasm');
    if (source) {
      copyFileSync(source, join(targetDir, name));
      console.log(`  Copied ${name}`);
    } else {
      console.warn(`  Warning: ${name} not found in node_modules`);
    }
  }
}

export interface StandaloneCliBuildResult {
  targetDir: string;
  executablePath: string;
  version: string;
}

export async function buildStandaloneCli(
  target: TargetKey,
  targetDir: string,
  exeName?: string,
): Promise<StandaloneCliBuildResult> {
  if (!existsSync(SRC_ENTRY)) {
    throw new Error(`Source entry not found: ${SRC_ENTRY}`);
  }

  if (!existsSync(SHIM_PATH)) {
    throw new Error(`Shim not found: ${SHIM_PATH}`);
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'cli', 'package.json'), 'utf-8'));
  const info = TARGETS[target];
  const outputName = exeName ?? (target === 'bun-windows-x64'
    ? 'open-zread.exe'
    : `open-zread-${info.os}-${info.arch}${info.ext}`);
  const outfile = join(targetDir, outputName);

  mkdirSync(targetDir, { recursive: true });

  console.log(`\nBuilding ${outputName}...`);

  const result = await Bun.build({
    entrypoints: [SRC_ENTRY],
    compile: {
      target,
      outfile,
    },
    plugins: [
      {
        name: 'yoga-wasm-shim',
        setup(build) {
          build.onResolve({ filter: /^yoga-wasm-web\/auto$/ }, () => ({
            path: SHIM_PATH,
          }));
          build.onResolve({ filter: /^yoga-wasm-web$/ }, () => ({
            path: join(
              ROOT, 'node_modules', '.bun', 'yoga-wasm-web@0.3.3',
              'node_modules', 'yoga-wasm-web', 'dist', 'index.js'
            ),
          }));
        },
      },
    ],
    define: {
      'globalThis.CLI_VERSION': JSON.stringify(pkg.version),
      'globalThis.IS_PACKAGED': 'true',
    },
  });

  if (!result.success) {
    const logs = result.logs.map((log) => `    ${log}`).join('\n');
    throw new Error(`Build failed for ${outputName}:\n${logs}`);
  }

  const size = statSync(outfile).size;
  const mb = (size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${outputName} (${mb} MB)`);

  console.log('  Copying assets...');
  copyAssets(targetDir);

  console.log(`  ✓ Output: ${targetDir}`);
  return { targetDir, executablePath: outfile, version: pkg.version };
}

async function runBuild(parsed: ReturnType<typeof parseArgs>) {
  const targets = parsed.all
    ? (Object.keys(TARGETS) as TargetKey[])
    : [parsed.target as TargetKey];

  for (const target of targets) {
    const info = TARGETS[target];
    const exeName = target === 'bun-windows-x64'
      ? 'open-zread.exe'
      : `open-zread-${info.os}-${info.arch}${info.ext}`;
    const targetDir = join(OUT_DIR, `open-zread-${info.os}-${info.arch}`);
    await buildStandaloneCli(target, targetDir, exeName);
  }
}

if (import.meta.main) {
  const parsed = parseArgs();

  if (!parsed.skipBuild) {
    console.log('Running turbo build (for browse frontend)...');
    const proc = Bun.spawn(['bun', 'run', 'build'], {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error('Build failed');
      process.exit(1);
    }
  } else {
    console.log('Skipping turbo build (--skip-build)');
  }

  try {
    await runBuild(parsed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
