import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WikiPage } from '@open-zread/types';

const CHECKPOINT_DIRECTORY = '.open-zread/.hub-generation-checkpoint';
const CHECKPOINT_VERSION = 1;

export interface GenerationCheckpoint {
  version: 1;
  operation: 'generate' | 'sync';
  planFingerprint: string;
  completedSlugs: string[];
  savedAt: string;
}

function pathInside(root: string, ...parts: string[]): string {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const relativePath = relative(base, target);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Generation checkpoint path is outside its project directory.');
  }
  return target;
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function collectPathFingerprint(projectRoot: string, relativePath: string): Promise<Array<[string, string]>> {
  const absolutePath = pathInside(projectRoot, relativePath);
  const records: Array<[string, string]> = [];
  const visit = async (path: string, relativeEntry: string): Promise<void> => {
    let info;
    try {
      info = await lstat(path);
    } catch {
      records.push([relativeEntry, 'missing']);
      return;
    }
    if (info.isSymbolicLink()) {
      records.push([relativeEntry, `symlink:${await readlink(path)}`]);
    } else if (info.isFile()) {
      records.push([relativeEntry, digest(await readFile(path))]);
    } else if (info.isDirectory()) {
      records.push([relativeEntry, 'directory']);
      const entries = await readdir(path, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isDirectory() && ['.git', '.open-zread', '.zread', 'node_modules'].includes(entry.name)) continue;
        await visit(join(path, entry.name), `${relativeEntry.replace(/\/$/, '')}/${entry.name}`);
      }
    } else {
      records.push([relativeEntry, 'special-file']);
    }
  };
  await visit(absolutePath, relativePath.replace(/\\/g, '/'));
  return records;
}

export async function fingerprintGenerationPlan(
  projectRoot: string,
  operation: 'generate' | 'sync',
  pages: WikiPage[],
  modelIdentity: string,
): Promise<string> {
  const sourcePaths = [...new Set(pages.flatMap((page) => page.associatedFiles ?? []))].sort();
  const sources: Array<[string, string][]> = [];
  for (const sourcePath of sourcePaths) {
    sources.push(await collectPathFingerprint(projectRoot, sourcePath));
  }
  const plan = pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    section: page.section,
    file: page.file,
    level: page.level,
    group: page.group ?? null,
    associatedFiles: [...(page.associatedFiles ?? [])].sort(),
    status: page.status ?? null,
  }));
  return digest(JSON.stringify({ operation, modelIdentity, plan, sources }));
}

function parseCheckpoint(value: unknown): GenerationCheckpoint {
  if (!value || typeof value !== 'object') throw new Error('The saved generation checkpoint is invalid.');
  const checkpoint = value as Partial<GenerationCheckpoint>;
  if (checkpoint.version !== CHECKPOINT_VERSION
    || (checkpoint.operation !== 'generate' && checkpoint.operation !== 'sync')
    || typeof checkpoint.planFingerprint !== 'string'
    || !Array.isArray(checkpoint.completedSlugs)
    || checkpoint.completedSlugs.some((slug) => typeof slug !== 'string')
    || typeof checkpoint.savedAt !== 'string') {
    throw new Error('The saved generation checkpoint is invalid.');
  }
  return checkpoint as GenerationCheckpoint;
}

async function readCheckpoint(projectRoot: string): Promise<GenerationCheckpoint | null> {
  const checkpointPath = pathInside(projectRoot, CHECKPOINT_DIRECTORY, 'manifest.json');
  try {
    return parseCheckpoint(JSON.parse(await readFile(checkpointPath, 'utf8')) as unknown);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function hydrateGenerationCheckpoint(
  projectRoot: string,
  wikiRoot: string,
  pages: WikiPage[],
  operation: 'generate' | 'sync',
  planFingerprint: string,
): Promise<GenerationCheckpoint | null> {
  const checkpoint = await readCheckpoint(projectRoot);
  if (!checkpoint) return null;
  if (checkpoint.operation !== operation || checkpoint.planFingerprint !== planFingerprint) {
    throw new Error('The saved generation checkpoint does not match the current project and generation plan. Start over to create a fresh Wiki.');
  }
  const pageBySlug = new Map(pages.map((page) => [page.slug, page]));
  for (const slug of checkpoint.completedSlugs) {
    const page = pageBySlug.get(slug);
    if (!page) throw new Error(`The saved generation checkpoint refers to a page that is no longer planned: ${slug}.`);
    const artifact = pathInside(projectRoot, CHECKPOINT_DIRECTORY, 'pages', `${digest(slug)}.md`);
    const destination = pathInside(wikiRoot, page.section, page.file);
    const artifactInfo = await lstat(artifact).catch(() => null);
    if (!artifactInfo?.isFile() || artifactInfo.isSymbolicLink()) {
      throw new Error(`The saved generation checkpoint is missing the completed page: ${slug}.`);
    }
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(artifact, destination);
  }
  return checkpoint;
}

export async function saveGenerationCheckpoint(
  projectRoot: string,
  wikiRoot: string,
  pages: WikiPage[],
  checkpoint: GenerationCheckpoint,
): Promise<void> {
  const orderedSlugs = [...new Set(checkpoint.completedSlugs)];
  if (orderedSlugs.length === 0) {
    await removeGenerationCheckpoint(projectRoot);
    return;
  }
  const pageBySlug = new Map(pages.map((page) => [page.slug, page]));
  const checkpointRoot = pathInside(projectRoot, CHECKPOINT_DIRECTORY);
  const stagingRoot = pathInside(projectRoot, '.open-zread', `.hub-generation-checkpoint-${randomUUID()}`);
  try {
    await mkdir(pathInside(stagingRoot, 'pages'), { recursive: true });
    for (const slug of orderedSlugs) {
      const page = pageBySlug.get(slug);
      if (!page) throw new Error(`Cannot checkpoint a page that is no longer planned: ${slug}.`);
      const source = pathInside(wikiRoot, page.section, page.file);
      const sourceInfo = await lstat(source).catch(() => null);
      if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
        throw new Error(`Cannot checkpoint the generated page because its output is missing: ${slug}.`);
      }
      const destination = pathInside(stagingRoot, 'pages', `${digest(slug)}.md`);
      await copyFile(source, destination);
    }
    const manifest: GenerationCheckpoint = {
      ...checkpoint,
      version: CHECKPOINT_VERSION,
      completedSlugs: orderedSlugs,
      savedAt: new Date().toISOString(),
    };
    await writeFile(pathInside(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rm(checkpointRoot, { recursive: true, force: true });
    await rename(stagingRoot, checkpointRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function removeGenerationCheckpoint(projectRoot: string): Promise<void> {
  await rm(pathInside(projectRoot, CHECKPOINT_DIRECTORY), { recursive: true, force: true });
}
