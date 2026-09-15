import { createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ZreadNativePage {
  slug: string;
  title: string;
  relativePath: string;
  absolutePath: string;
  native: Readonly<Record<string, unknown>>;
}

export interface ZreadWikiInspection {
  status: 'readable';
  currentPointer: string;
  versionId: string;
  versionPath: string;
  catalogPath: string;
  catalog: Readonly<Record<string, unknown>>;
  pages: ZreadNativePage[];
}

export interface ZreadCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  cancelled?: boolean;
}

export interface ZreadCommandOptions {
  cwd?: string;
  signal?: AbortSignal;
}

export type ZreadCommandRunner = (
  executable: string,
  args: readonly string[],
  options?: ZreadCommandOptions,
) => Promise<ZreadCommandResult>;

export interface ZreadCliInspection {
  status: 'available';
  executable: string;
  version: {
    version: string;
    channel: string;
    goVersion: string;
    os: string;
    arch: string;
  };
  capabilities: {
    login: boolean;
    customApiKeyLogin: boolean;
    generate: boolean;
    machineReadable: boolean;
    unattended: boolean;
    existingDraftActions: boolean;
    skipFailedPages: boolean;
    cliSelfUpdate: boolean;
    incrementalWikiUpdate: false;
  };
  diagnostics: string[];
}

export interface InspectZreadCliOptions {
  executable: string;
  run: ZreadCommandRunner;
}

export interface ZreadNativeWriteProbe {
  status: 'supported';
  pagePath: string;
  catalogPath: string;
  contentHash: string;
  contentUnchanged: boolean;
  catalogUnchanged: boolean;
}

export interface ZreadPageWriteResult {
  pagePath: string;
  contentHash: string;
}

export interface ProbeZreadGenerationOptions {
  executable: string;
  projectRoot: string;
  run: ZreadCommandRunner;
  signal?: AbortSignal;
}

export interface ZreadGenerationProbe {
  status: 'succeeded' | 'authentication_failed' | 'cancelled' | 'failed' | 'incomplete_output';
  exitCode: number;
  previousPointer?: string;
  currentPointer?: string;
  outputValidated: boolean;
  versionChanged: boolean;
  diagnostics: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Zread catalog page is missing a valid ${key}`);
  }
  return value;
}

function assertContained(root: string, target: string, label: string): void {
  const relativePath = relative(root, target);
  if (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes the Zread wiki root`);
  }
}

function collectDiagnostics(...values: string[]): string[] {
  return values.flatMap((value) => value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0));
}

function parseVersionOutput(stdout: string): ZreadCliInspection['version'] {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || !isRecord(parsed.vm)) continue;
      return {
        version: requireString(parsed.vm, 'version'),
        channel: requireString(parsed.vm, 'channel'),
        goVersion: requireString(parsed.vm, 'go_version'),
        os: requireString(parsed.vm, 'os'),
        arch: requireString(parsed.vm, 'arch'),
      };
    } catch {
      continue;
    }
  }
  throw new Error('Zread version command did not return machine-readable version data');
}

export async function inspectZreadCli(options: InspectZreadCliOptions): Promise<ZreadCliInspection> {
  const versionResult = await options.run(options.executable, ['version', '--stdio']);
  if (versionResult.exitCode !== 0) {
    throw new Error(`Zread version command failed with exit code ${versionResult.exitCode}`);
  }

  const generateHelp = await options.run(options.executable, ['generate', '--help']);
  if (generateHelp.exitCode !== 0) {
    throw new Error(`Zread generate help failed with exit code ${generateHelp.exitCode}`);
  }
  const loginHelp = await options.run(options.executable, ['login', '--help']);
  if (loginHelp.exitCode !== 0) {
    throw new Error(`Zread login help failed with exit code ${loginHelp.exitCode}`);
  }
  const updateHelp = await options.run(options.executable, ['update', '--help']);
  if (updateHelp.exitCode !== 0) {
    throw new Error(`Zread update help failed with exit code ${updateHelp.exitCode}`);
  }

  return {
    status: 'available',
    executable: options.executable,
    version: parseVersionOutput(versionResult.stdout),
    capabilities: {
      login: loginHelp.stdout.includes('Login flow'),
      customApiKeyLogin: loginHelp.stdout.includes('--custom'),
      generate: generateHelp.stdout.includes('Generate wiki documentation'),
      machineReadable: generateHelp.stdout.includes('--stdio'),
      unattended: generateHelp.stdout.includes('--yes'),
      existingDraftActions: generateHelp.stdout.includes('--draft'),
      skipFailedPages: generateHelp.stdout.includes('--skip-failed'),
      cliSelfUpdate: updateHelp.stdout.includes('Update Zread to the latest version'),
      incrementalWikiUpdate: false,
    },
    diagnostics: collectDiagnostics(
      versionResult.stderr,
      generateHelp.stderr,
      loginHelp.stderr,
      updateHelp.stderr,
    ),
  };
}

export async function inspectZreadWiki(projectRoot: string): Promise<ZreadWikiInspection> {
  const wikiRoot = resolve(projectRoot, '.zread', 'wiki');
  const currentFile = resolve(wikiRoot, 'current');
  const currentPointer = (await readFile(currentFile, 'utf8')).replace(/^\uFEFF/, '').trim();
  if (currentPointer.length === 0 || isAbsolute(currentPointer)) {
    throw new Error('Zread current pointer must be a non-empty relative path');
  }

  const versionPath = resolve(wikiRoot, currentPointer);
  assertContained(wikiRoot, versionPath, 'Zread current pointer');

  const catalogPath = resolve(versionPath, 'wiki.json');
  const parsed: unknown = JSON.parse(
    (await readFile(catalogPath, 'utf8')).replace(/^\uFEFF/, ''),
  );
  if (!isRecord(parsed) || !Array.isArray(parsed.pages)) {
    throw new Error('Zread catalog must be an object with a pages array');
  }

  const pages = parsed.pages.map((value): ZreadNativePage => {
    if (!isRecord(value)) {
      throw new Error('Zread catalog page must be an object');
    }
    const relativePath = requireString(value, 'file');
    const absolutePath = resolve(versionPath, relativePath);
    assertContained(versionPath, absolutePath, 'Zread page path');
    return {
      slug: requireString(value, 'slug'),
      title: requireString(value, 'title'),
      relativePath,
      absolutePath,
      native: value,
    };
  });

  return {
    status: 'readable',
    currentPointer,
    versionId: typeof parsed.id === 'string' ? parsed.id : currentPointer.split(/[\\/]/).at(-1) ?? currentPointer,
    versionPath,
    catalogPath,
    catalog: parsed,
    pages,
  };
}

function hashContent(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function probeZreadNativeWrite(
  projectRoot: string,
  pageSlug: string,
): Promise<ZreadNativeWriteProbe> {
  const wiki = await inspectZreadWiki(projectRoot);
  const page = wiki.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) {
    throw new Error(`Zread page not found: ${pageSlug}`);
  }

  const [catalogBefore, contentBefore] = await Promise.all([
    readFile(wiki.catalogPath),
    readFile(page.absolutePath),
  ]);
  const handle = await open(page.absolutePath, 'r+');
  try {
    await handle.write(contentBefore, 0, contentBefore.length, 0);
    await handle.truncate(contentBefore.length);
    await handle.sync();
  } finally {
    await handle.close();
  }

  const [catalogAfter, contentAfter] = await Promise.all([
    readFile(wiki.catalogPath),
    readFile(page.absolutePath),
  ]);
  return {
    status: 'supported',
    pagePath: page.absolutePath,
    catalogPath: wiki.catalogPath,
    contentHash: hashContent(contentAfter),
    contentUnchanged: contentBefore.equals(contentAfter),
    catalogUnchanged: catalogBefore.equals(catalogAfter),
  };
}

export async function writeZreadPage(
  projectRoot: string,
  pageSlug: string,
  content: string,
): Promise<ZreadPageWriteResult> {
  const wiki = await inspectZreadWiki(projectRoot);
  const page = wiki.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) {
    throw new Error(`Zread page not found: ${pageSlug}`);
  }

  await writeFile(page.absolutePath, content, 'utf8');
  return {
    pagePath: page.absolutePath,
    contentHash: hashContent(Buffer.from(content, 'utf8')),
  };
}

async function readCurrentPointer(projectRoot: string): Promise<string | undefined> {
  try {
    return (await inspectZreadWiki(projectRoot)).currentPointer;
  } catch {
    return undefined;
  }
}

export async function probeZreadGeneration(
  options: ProbeZreadGenerationOptions,
): Promise<ZreadGenerationProbe> {
  const previousPointer = await readCurrentPointer(options.projectRoot);
  const result = await options.run(
    options.executable,
    ['generate', '--stdio', '--yes'],
    { cwd: options.projectRoot, signal: options.signal },
  );
  const currentPointer = await readCurrentPointer(options.projectRoot);
  const output = `${result.stdout}\n${result.stderr}`;
  let status: ZreadGenerationProbe['status'];
  if (result.cancelled) {
    status = 'cancelled';
  } else if (result.exitCode !== 0 && /auth|login|credential|unauthorized/i.test(output)) {
    status = 'authentication_failed';
  } else if (result.exitCode !== 0) {
    status = 'failed';
  } else if (!currentPointer) {
    status = 'incomplete_output';
  } else {
    status = 'succeeded';
  }

  return {
    status,
    exitCode: result.exitCode,
    previousPointer,
    currentPointer,
    outputValidated: status === 'succeeded',
    versionChanged: currentPointer !== undefined && currentPointer !== previousPointer,
    diagnostics: collectDiagnostics(result.stderr),
  };
}
