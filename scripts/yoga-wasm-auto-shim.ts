import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import initYoga from 'yoga-wasm-web';

async function loadYoga() {
  let wasmBinary: Uint8Array | undefined;

  const exeDir = dirname(process.execPath);
  const wasmPath = resolve(exeDir, 'yoga.wasm');
  if (existsSync(wasmPath)) {
    wasmBinary = new Uint8Array(readFileSync(wasmPath));
  }

  if (!wasmBinary) {
    const g = globalThis as Record<string, unknown>;
    const bun = g.Bun as Record<string, unknown> | undefined;
    if (typeof bun !== 'undefined' && typeof (bun as Record<string, unknown>).embeddedFiles === 'object') {
      const files = (bun as Record<string, unknown>).embeddedFiles as Array<{ name: string; bytes(): Promise<Uint8Array> }>;
      if (Array.isArray(files)) {
        for (const file of files) {
          if (file.name.endsWith('yoga.wasm')) {
            wasmBinary = new Uint8Array(await file.bytes());
            break;
          }
        }
      }
    }
  }

  if (!wasmBinary) {
    throw new Error('yoga.wasm not found. Place it next to the executable.');
  }

  return initYoga(wasmBinary);
}

export default await loadYoga();
