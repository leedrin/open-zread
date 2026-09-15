import { getProjectRoot, joinPath, ensureDir, readTextFile, writeTextFile } from '../file-io.js';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const WIKI_DIR = '.open-zread/wiki';
const CURRENT_DIR = joinPath(WIKI_DIR, 'current');
const VERSIONS_DIR = joinPath(WIKI_DIR, 'versions');

export function generateSnapshotName(projectRoot?: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(':', '');

  let commitHash: string;
  try {
    const root = getProjectRoot(projectRoot);
    commitHash = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf-8',
    }).trim();
  } catch {
    commitHash = 'unknown';
  }

  return `${dateStr}_${timeStr}_${commitHash}`;
}

export async function createVersionSnapshot(projectRoot?: string): Promise<string> {
  const root = getProjectRoot(projectRoot);
  const currentPath = join(root, CURRENT_DIR);
  if (!existsSync(currentPath)) {
    return '';
  }

  const snapshotName = generateSnapshotName(root);
  const versionsPath = join(root, VERSIONS_DIR);
  const snapshotPath = join(versionsPath, snapshotName);

  await ensureDir(versionsPath);

  await copyDirRecursive(currentPath, snapshotPath);

  return snapshotName;
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      const content = await readTextFile(srcPath);
      await writeTextFile(destPath, content);
    }
  }
}
