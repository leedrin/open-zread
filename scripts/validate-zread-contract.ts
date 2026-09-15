import {
  inspectZreadCli,
  inspectZreadWiki,
  probeZreadGeneration,
  probeZreadNativeWrite,
  type ZreadCommandOptions,
  type ZreadCommandResult,
} from '../packages/wiki-provider-zread/src/index.js';

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
  const executable = readOption(args, '--executable') ?? Bun.which('zread');
  if (!executable) {
    throw new Error('Zread executable was not found; pass --executable explicitly');
  }

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
      ? setTimeout(() => abortController.abort(), Number.parseInt(cancelAfter, 10))
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

await main();
