import { existsSync, readFileSync, statSync, cpSync, mkdirSync, copyFileSync } from 'fs';
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

function findYogaWasm(): string {
  const candidates = [
    join(ROOT, 'node_modules', '.bun', 'yoga-wasm-web@0.3.3', 'node_modules', 'yoga-wasm-web', 'dist', 'yoga.wasm'),
    join(ROOT, 'node_modules', 'yoga-wasm-web', 'dist', 'yoga.wasm'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('yoga.wasm not found in node_modules');
}

function findTreeSitterWasm(): string {
  const candidates = [
    join(ROOT, 'node_modules', '.bun', 'web-tree-sitter@0.20.8', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    join(ROOT, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('tree-sitter.wasm not found in node_modules');
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

function copyAssets(targetDir: string) {
  const browseDist = join(ROOT, 'apps', 'browse', 'dist');
  if (existsSync(browseDist)) {
    cpSync(browseDist, join(targetDir, 'browse'), { recursive: true });
    console.log('  Copied browse/ directory');
  } else {
    console.warn('  Warning: browse/ dist not found — run "bun run build" first');
  }

  const yogaWasm = findYogaWasm();
  copyFileSync(yogaWasm, join(targetDir, 'yoga.wasm'));
  console.log('  Copied yoga.wasm');

  const treeSitterWasm = findTreeSitterWasm();
  copyFileSync(treeSitterWasm, join(targetDir, 'tree-sitter.wasm'));
  console.log('  Copied tree-sitter.wasm');
}

async function runBuild() {
  if (!existsSync(SRC_ENTRY)) {
    console.error(`Source entry not found: ${SRC_ENTRY}`);
    process.exit(1);
  }

  if (!existsSync(SHIM_PATH)) {
    console.error(`Shim not found: ${SHIM_PATH}`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'cli', 'package.json'), 'utf-8'));

  const targets = parsed.all
    ? (Object.keys(TARGETS) as TargetKey[])
    : [parsed.target as TargetKey];

  for (const target of targets) {
    const info = TARGETS[target];
    const exeName = `open-zread-${info.os}-${info.arch}${info.ext}`;
    const targetDir = join(OUT_DIR, `open-zread-${info.os}-${info.arch}`);
    const outfile = join(targetDir, exeName);

    mkdirSync(targetDir, { recursive: true });

    console.log(`\nBuilding ${exeName}...`);

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

    if (result.success) {
      const size = statSync(outfile).size;
      const mb = (size / 1024 / 1024).toFixed(1);
      console.log(`  ✓ ${exeName} (${mb} MB)`);
    } else {
      console.error(`  ✗ Build failed for ${exeName}:`);
      for (const log of result.logs) {
        console.error(`    ${log}`);
      }
      process.exit(1);
    }

    console.log('  Copying assets...');
    copyAssets(targetDir);

    console.log(`  ✓ Output: ${targetDir}`);
  }
}

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

await runBuild();
