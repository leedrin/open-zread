import { describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectZreadCli,
  inspectZreadWiki,
  probeZreadNativeWrite,
  probeZreadGeneration,
  writeZreadPage,
  type ZreadCommandRunner,
} from '../index.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/zread-project', import.meta.url));

describe('Zread native integration contract', () => {
  test('resolves the current pointer and exposes flat native pages', async () => {
    const result = await inspectZreadWiki(fixtureRoot);

    expect(result.status).toBe('readable');
    expect(result.currentPointer).toBe('versions/2026-05-10-124151');
    expect(result.versionId).toBe('2026-05-10-124151');
    expect(result.pages.map((page) => ({
      slug: page.slug,
      relativePath: page.relativePath,
    }))).toEqual([
      { slug: 'project-overview', relativePath: 'project-overview.md' },
      { slug: 'protocol-integration', relativePath: 'protocol-integration.md' },
    ]);
    expect(result.pages.every((page) => existsSync(page.absolutePath))).toBe(true);
  });

  test('reports version and only the generation capabilities exposed by the CLI', async () => {
    const run: ZreadCommandRunner = async (_executable, args) => {
      if (args[0] === 'version') {
        return {
          exitCode: 0,
          stdout: '{"vm":{"version":"0.2.13","channel":"npm","go_version":"go1.26.0","os":"windows","arch":"amd64"},"waiting_for":[],"done":true}\n',
          stderr: 'write error: cannot rotate log\n',
        };
      }
      if (args[0] === 'login') {
        return {
          exitCode: 0,
          stdout: ['Login flow for Zhipu/Z.AI Coding Plan.', '--custom', '--stdio'].join('\n'),
          stderr: '',
        };
      }
      if (args[0] === 'update') {
        return {
          exitCode: 0,
          stdout: ['Update Zread to the latest version', '--stdio'].join('\n'),
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        stdout: [
          'Generate wiki documentation for the current workspace',
          '--draft string',
          '--skip-failed',
          '--stdio',
          '--yes',
        ].join('\n'),
        stderr: '',
      };
    };

    const result = await inspectZreadCli({ executable: 'zread', run });

    expect(result.status).toBe('available');
    expect(result.version).toEqual({
      version: '0.2.13',
      channel: 'npm',
      goVersion: 'go1.26.0',
      os: 'windows',
      arch: 'amd64',
    });
    expect(result.capabilities).toEqual({
      login: true,
      customApiKeyLogin: true,
      generate: true,
      machineReadable: true,
      unattended: true,
      existingDraftActions: true,
      skipFailedPages: true,
      cliSelfUpdate: true,
      incrementalWikiUpdate: false,
    });
    expect(result.diagnostics).toEqual(['write error: cannot rotate log']);
  });

  test('proves direct write access without changing page bytes or native catalog fields', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'zread-contract-'));
    cpSync(fixtureRoot, temporaryRoot, { recursive: true });

    try {
      const result = await probeZreadNativeWrite(temporaryRoot, 'protocol-integration');
      const catalog = JSON.parse(readFileSync(result.catalogPath, 'utf8')) as {
        providerMeta: { opaque: string };
        pages: Array<{ slug: string; sourceRefs?: string[] }>;
      };

      expect(result.status).toBe('supported');
      expect(result.contentUnchanged).toBe(true);
      expect(result.catalogUnchanged).toBe(true);
      expect(catalog.providerMeta.opaque).toBe('keep-me');
      expect(catalog.pages.find((page) => page.slug === 'protocol-integration')?.sourceRefs)
        .toEqual(['src/protocol.ts']);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('writes edited content to the native page while preserving catalog and sibling pages', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'zread-write-contract-'));
    cpSync(fixtureRoot, temporaryRoot, { recursive: true });

    try {
      const before = await inspectZreadWiki(temporaryRoot);
      const target = before.pages.find((page) => page.slug === 'project-overview');
      const sibling = before.pages.find((page) => page.slug === 'protocol-integration');
      if (!target || !sibling) throw new Error('Fixture pages are missing');
      const catalogBefore = readFileSync(before.catalogPath);
      const siblingBefore = readFileSync(sibling.absolutePath);

      const result = await writeZreadPage(temporaryRoot, target.slug, '# 已编辑\n');

      expect(result.pagePath).toBe(target.absolutePath);
      expect(readFileSync(target.absolutePath, 'utf8')).toBe('# 已编辑\n');
      expect(readFileSync(before.catalogPath).equals(catalogBefore)).toBe(true);
      expect(readFileSync(sibling.absolutePath).equals(siblingBefore)).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('reports authentication failure without claiming generation succeeded', async () => {
    const run: ZreadCommandRunner = async () => ({
      exitCode: 1,
      stdout: '{"done":true}\n',
      stderr: 'authentication required: run zread login\n',
    });

    const result = await probeZreadGeneration({
      executable: 'zread',
      projectRoot: fixtureRoot,
      run,
    });

    expect(result.status).toBe('authentication_failed');
    expect(result.exitCode).toBe(1);
    expect(result.previousPointer).toBe('versions/2026-05-10-124151');
    expect(result.currentPointer).toBe('versions/2026-05-10-124151');
  });

  test('validates generated output after Zread switches the current version', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'zread-generate-contract-'));
    cpSync(fixtureRoot, temporaryRoot, { recursive: true });
    const wikiRoot = join(temporaryRoot, '.zread', 'wiki');
    const nextPointer = 'versions/2026-09-15-220000';
    const run: ZreadCommandRunner = async () => {
      cpSync(
        join(wikiRoot, 'versions', '2026-05-10-124151'),
        join(wikiRoot, nextPointer),
        { recursive: true },
      );
      writeFileSync(join(wikiRoot, 'current'), `${nextPointer}\n`);
      return { exitCode: 0, stdout: '{"done":true}\n', stderr: '' };
    };

    try {
      const result = await probeZreadGeneration({
        executable: 'zread',
        projectRoot: temporaryRoot,
        run,
      });

      expect(result.status).toBe('succeeded');
      expect(result.outputValidated).toBe(true);
      expect(result.versionChanged).toBe(true);
      expect(result.previousPointer).toBe('versions/2026-05-10-124151');
      expect(result.currentPointer).toBe(nextPointer);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('distinguishes cancellation, ordinary failure, and incomplete output', async () => {
    const cancelled = await probeZreadGeneration({
      executable: 'zread',
      projectRoot: fixtureRoot,
      run: async () => ({
        exitCode: 130,
        stdout: '',
        stderr: 'generation cancelled',
        cancelled: true,
      }),
    });
    const failed = await probeZreadGeneration({
      executable: 'zread',
      projectRoot: fixtureRoot,
      run: async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'generation failed: disk full',
      }),
    });

    const temporaryRoot = mkdtempSync(join(tmpdir(), 'zread-incomplete-contract-'));
    cpSync(fixtureRoot, temporaryRoot, { recursive: true });
    try {
      const incomplete = await probeZreadGeneration({
        executable: 'zread',
        projectRoot: temporaryRoot,
        run: async () => {
          rmSync(join(temporaryRoot, '.zread', 'wiki', 'current'));
          return { exitCode: 0, stdout: '{"done":true}\n', stderr: '' };
        },
      });

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.outputValidated).toBe(false);
      expect(failed.status).toBe('failed');
      expect(failed.outputValidated).toBe(false);
      expect(incomplete.status).toBe('incomplete_output');
      expect(incomplete.outputValidated).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
