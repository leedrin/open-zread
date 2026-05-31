import { getProjectRoot, getWikiDir, ensureDir, readTextFile, writeTextFile } from '../file-io.js';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/** Top-level entries under the wiki dir that must never be copied into a snapshot. */
const SNAPSHOT_EXCLUDE = new Set(['versions']);

export function generateSnapshotName(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(':', '');

  let commitHash: string;
  try {
    const projectRoot = getProjectRoot();
    commitHash = execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    commitHash = 'unknown';
  }

  return `${dateStr}_${timeStr}_${commitHash}`;
}

/**
 * Freeze the current wiki into a dated snapshot under `<wiki>/versions/<name>/`.
 *
 * Copies the real wiki content directory (section subdirectories, wiki.json,
 * _sidebar.md, source-files-index.json, ...), excluding the `versions/` dir
 * itself to avoid recursive nesting. Returns the snapshot name, or '' when
 * there is no wiki content to snapshot.
 */
export async function createVersionSnapshot(): Promise<string> {
  const wikiDir = getWikiDir();
  if (!existsSync(wikiDir)) {
    return '';
  }

  // Nothing to snapshot if the wiki dir only contains the versions folder.
  const topEntries = readdirSync(wikiDir, { withFileTypes: true })
    .filter(e => !SNAPSHOT_EXCLUDE.has(e.name));
  if (topEntries.length === 0) {
    return '';
  }

  const snapshotName = generateSnapshotName();
  const versionsPath = join(wikiDir, 'versions');
  const snapshotPath = join(versionsPath, snapshotName);

  await ensureDir(versionsPath);
  await copyDirRecursive(wikiDir, snapshotPath, true);

  return snapshotName;
}

/**
 * Recursively copy `src` into `dest`. When `isRoot` is true, top-level entries
 * listed in SNAPSHOT_EXCLUDE are skipped.
 */
async function copyDirRecursive(src: string, dest: string, isRoot = false): Promise<void> {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (isRoot && SNAPSHOT_EXCLUDE.has(entry.name)) continue;

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
