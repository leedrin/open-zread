import {
  inspectZreadCli,
  inspectZreadWiki,
  probeZreadGeneration,
  probeZreadNativeWrite,
  type ZreadCommandOptions,
  type ZreadCommandResult,
} from '../packages/wiki-provider-zread/src/index.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const usage = `Usage: bun run validate:zread-contract [options]

Options:
  --project <path>          Project to inspect (defaults to current directory)
  --executable <path>       Zread executable (defaults to PATH lookup)
  --probe-write <slug>      Rewrite one page with identical bytes to verify access
  --probe-generation        Run: zread generate --stdio --yes
  --cancel-after-ms <ms>    Cancel a live generation after the given delay
  --help                    Show this help
`;

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseCancelAfterMs(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('--cancel-after-ms must be a positive safe integer');
  }
  const delay = Number(value);
  if (!Number.isSafeInteger(delay)) {
    throw new Error('--cancel-after-ms must be a positive safe integer');
  }
  return delay;
}

export function preferNativeZreadExecutable(
  discovered: string,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): string {
  if (platform !== 'win32') {
    return discovered;
  }
  const candidate = discovered.toLowerCase().endsWith('.cmd')
    ? join(
      dirname(discovered),
      'node_modules',
      'zread_cli',
      'node_modules',
      '@zread',
      'cli-win32-x64',
      'zread.exe',
    )
    : discovered;
  if (!candidate.toLowerCase().endsWith('.exe') || !fileExists(candidate)) {
    throw new Error('Windows requires an existing native zread.exe; pass --executable explicitly');
  }
  return candidate;
}

async function runZreadCommand(
  executable: string,
  args: readonly string[],
  options?: ZreadCommandOptions,
): Promise<ZreadCommandResult> {
  const subprocess = Bun.spawn([executable, ...args], {
    cwd: options?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const abort = () => subprocess.kill();
  options?.signal?.addEventListener('abort', abort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    return {
      exitCode,
      stdout,
      stderr,
      cancelled: options?.signal?.aborted === true,
    };
  } finally {
    options?.signal?.removeEventListener('abort', abort);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(usage);
    return;
  }

  const projectRoot = readOption(args, '--project') ?? process.cwd();
  const requestedExecutable = readOption(args, '--executable')
    ?? Bun.which('zread.exe')
    ?? Bun.which('zread');
  if (!requestedExecutable) {
    throw new Error('Zread executable was not found; pass --executable explicitly');
  }
  const executable = preferNativeZreadExecutable(requestedExecutable);

  const cli = await inspectZreadCli({ executable, run: runZreadCommand });
  let wikiBefore: Awaited<ReturnType<typeof inspectZreadWiki>> | { status: 'missing_or_invalid'; error: string };
  try {
    wikiBefore = await inspectZreadWiki(projectRoot);
  } catch (error) {
    wikiBefore = {
      status: 'missing_or_invalid',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const writeSlug = readOption(args, '--probe-write');
  const nativeWrite = writeSlug
    ? await probeZreadNativeWrite(projectRoot, writeSlug)
    : undefined;

  let generation: Awaited<ReturnType<typeof probeZreadGeneration>> | undefined;
  if (args.includes('--probe-generation')) {
    const abortController = new AbortController();
    const cancelAfter = readOption(args, '--cancel-after-ms');
    const cancelTimer = cancelAfter
      ? setTimeout(() => abortController.abort(), parseCancelAfterMs(cancelAfter))
      : undefined;
    try {
      generation = await probeZreadGeneration({
        executable,
        projectRoot,
        run: runZreadCommand,
        signal: abortController.signal,
      });
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer);
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    projectRoot,
    cli,
    wikiBefore,
    nativeWrite,
    generation,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
  await main();
}
