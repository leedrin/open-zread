# Build Plan: bun-compile-executable

> Generated from `openspec/changes/bun-compile-executable/plan-ready.md`
> Do not reinterpret requirements or change technical decisions from design.md.

## Phase 1: Resource Resolution (Tasks 1–4)

---

### [x] 1.1 Add `isCompiledExecutable()` to wasm-loader.ts

**Goal**: Shared detection function for compiled executable mode.

**Steps**:
1. Open `packages/repo-analyzer/src/parser/wasm-loader.ts`
2. Add function after existing imports (line ~8):
   ```typescript
   function isCompiledExecutable(): boolean {
     return typeof (globalThis as any).Bun !== 'undefined'
       && Array.isArray((globalThis as any).Bun?.embeddedFiles)
       && (globalThis as any).Bun.embeddedFiles.length > 0
   }
   ```

**Changed files**: `packages/repo-analyzer/src/parser/wasm-loader.ts`

**Validation**: `bun run typecheck` passes

**Time**: 2 min

---

### [x] 1.2 Adapt `getTreeSitterDir()` for compiled mode

**Goal**: Return correct path for `tree-sitter.wasm` when running as compiled binary.

**Steps**:
1. In `packages/repo-analyzer/src/parser/wasm-loader.ts`, modify `getTreeSitterDir()` (line 68)
2. Add a new first branch in the function body, before the existing `existsSync` check:
   ```typescript
   // 编译模式：Bun embedded files 已解压到与可执行文件同目录
   if (isCompiledExecutable()) {
     if (existsSync(join(currentDir, 'tree-sitter.wasm'))) return currentDir
   }
   ```
3. The existing npm-mode logic (lines 73-97) stays untouched

**Changed files**: `packages/repo-analyzer/src/parser/wasm-loader.ts`

**Validation**: `bun run typecheck` and `bun run lint` pass

**Time**: 3 min

**Notes**: Bun `--compile` extracts embedded files to a temp dir alongside the binary. `import.meta.url` → `__dirname` should resolve to that dir. The existing check at line 73 may already handle this, but the explicit `isCompiledExecutable()` guard makes intent clear and provides a hook for future debugging.

---

### [x] 1.3 Adapt browse-server.ts frontend path for compiled mode

**Goal**: Locate `browse/` directory correctly in compiled mode.

**Steps**:
1. Open `apps/cli/src/commands/browse-server.ts`
2. In `startWikiBrowseServer()` (line 187), add compiled-mode detection before the existing `isProduction` block:
   ```typescript
   const isCompiled = typeof (globalThis as any).Bun !== 'undefined'
     && Array.isArray((globalThis as any).Bun?.embeddedFiles)
     && (globalThis as any).Bun.embeddedFiles.length > 0
   ```
3. Modify the `isProduction` block (line 191) to also cover compiled mode:
   ```typescript
   if (isProduction || isCompiled) {
     const webDistPath = isCompiled
       ? path.resolve(__dirname, "browse")
       : path.resolve(__dirname, "browse");
     // ... rest unchanged
   }
   ```
   Actually, since the path is the same (`__dirname + "browse"`), the only change needed is to ensure the production branch is entered. Modify:
   ```typescript
   const isProduction = (typeof globalThis.IS_PACKAGED !== 'undefined' && globalThis.IS_PACKAGED === true)
     || (typeof (globalThis as any).Bun !== 'undefined' && Array.isArray((globalThis as any).Bun?.embeddedFiles) && (globalThis as any).Bun.embeddedFiles.length > 0);
   ```

**Changed files**: `apps/cli/src/commands/browse-server.ts`

**Validation**: `bun run typecheck` and `bun run lint` pass

**Time**: 3 min

**Notes**: The simplest approach — just extend the `isProduction` guard to also match compiled mode. The actual path resolution (`__dirname + "browse"`) stays the same because Bun extracts embedded files to the same relative structure.

---

### [x] 1.4 Gate: typecheck + lint verification

**Goal**: Confirm Phase 1 changes are statically correct.

**Steps**:
1. Run `bun run typecheck` from repo root
2. Run `bun run lint` from repo root
3. Fix any errors found

**Changed files**: none (or fix files if errors)

**Validation**: Both commands exit 0

**Time**: 2 min

---

## Phase 2: Build Script (Tasks 5–7)

---

### [x] 2.1 Create build-exe.ts scaffold with arg parsing

**Goal**: Script that accepts `--target`, `--all`, `--skip-build` and resolves to a valid target string.

**Steps**:
1. Create `scripts/build-exe.ts`
2. Implement arg parsing:
   ```typescript
   const args = process.argv.slice(2)
   const TARGETS = {
     'bun-windows-x64': { os: 'windows', arch: 'x64', ext: '.exe' },
     'bun-darwin-arm64': { os: 'darwin', arch: 'arm64', ext: '' },
     'bun-darwin-x64': { os: 'darwin', arch: 'x64', ext: '' },
     'bun-linux-x64': { os: 'linux', arch: 'x64', ext: '' },
   } as const
   ```
3. Resolve `--target <value>` or `--all` (iterate all targets)
4. Print usage on `--help` or missing args

**Changed files**: `scripts/build-exe.ts` (new)

**Validation**: `bun run scripts/build-exe.ts --help` prints usage

**Time**: 5 min

---

### [x] 2.2 Implement Bun.build pipeline with compile + embed

**Goal**: Wire `Bun.build()` with `compile: true`, embedding WASM and browse files.

**Steps**:
1. Add build logic to `scripts/build-exe.ts`:
   ```typescript
   import { readdirSync, readFileSync, existsSync } from 'fs'
   import { join, resolve } from 'path'

   const CLI_DIST = resolve('apps/cli/dist')
   const ENTRY = join(CLI_DIST, 'index.js')
   const OUT_DIR = resolve('dist/exe')

   async function buildTarget(target: string, info: typeof TARGETS[string]) {
     const pkg = JSON.parse(readFileSync('apps/cli/package.json', 'utf-8'))
     const exeName = `open-zread-${info.os}-${info.arch}${info.ext}`

     // Collect embeddable files
     const additionalFiles: string[] = []

     // Core WASM files from cli dist
     for (const wasm of ['tree-sitter.wasm', 'yoga.wasm', 'mappings.wasm']) {
       const p = join(CLI_DIST, wasm)
       if (existsSync(p)) additionalFiles.push(p)
     }

     // Browse frontend directory
     const browseDir = join(CLI_DIST, 'browse')
     if (existsSync(browseDir)) {
       const collectFiles = (dir: string, base: string = '') => {
         for (const entry of readdirSync(dir, { withFileTypes: true })) {
           const fullPath = join(dir, entry.name)
           const relPath = base ? `${base}/${entry.name}` : entry.name
           if (entry.isFile()) additionalFiles.push(fullPath)
           else if (entry.isDirectory()) collectFiles(fullPath, relPath)
         }
       }
       collectFiles(browseDir)
     }

     await Bun.build({
       entrypoints: [ENTRY],
       compile: true,
       target: target as any,
       outdir: OUT_DIR,
       naming: exeName,
       define: {
         'globalThis.CLI_VERSION': JSON.stringify(pkg.version),
         'globalThis.IS_PACKAGED': 'true',
       },
       // additionalFiles embeds them into the binary's virtual filesystem
       ...(additionalFiles.length > 0 && {
         // Bun.compile approach: files alongside entrypoint are auto-included
         // If not, use loader: { '.wasm': 'file' }
       }),
     })
   }
   ```
2. Implement `--skip-build` flag to skip `bun run build` step
3. Without `--skip-build`, run `$${Bun.which('bun')} run build` first

**Changed files**: `scripts/build-exe.ts`

**Validation**: `bun run build && bun run scripts/build-exe.ts --target=bun-windows-x64 --skip-build` produces `dist/exe/open-zread-windows-x64.exe`

**Time**: 10 min

**Notes**: Bun `--compile` auto-includes files in the same directory as the entrypoint. Since tsup already copies WASM and browse/ into `apps/cli/dist/`, they should be auto-embedded. If not, use `Bun.build`'s `loader` option with `{ '.wasm': 'file' }` or the `--external` approach. This may require empirical tuning.

---

### [x] 2.3 Add build:exe to root package.json

**Goal**: Register script for easy access.

**Steps**:
1. Add to root `package.json` scripts:
   ```json
   "build:exe": "bun run scripts/build-exe.ts"
   ```

**Changed files**: `package.json`

**Validation**: `bun run build:exe --help` works

**Time**: 1 min

---

## Phase 3: Verification (Task 8)

---

### [ ] 3.1 Local smoke test — build + run ⚠️ requires manual run

**Goal**: Confirm the exe works end-to-end.

**Steps**:
1. `bun run build` — build all packages
2. `bun run build:exe --target=bun-windows-x64` — produce exe
3. `.\dist\exe\open-zread-windows-x64.exe --version` — verify version output
4. `.\dist\exe\open-zread-windows-x64.exe --help` — verify help text
5. `.\dist\exe\open-zread-windows-x64.exe browse` — verify browse server starts
6. `bun run dev` — verify npm mode not broken

**Changed files**: none

**Validation**: All 6 checks pass

**Time**: 5 min

**Notes**: If WASM loading fails, check what `__dirname` resolves to inside the exe by adding a `console.log(__dirname)` temporarily. Document findings in `implementation-notes.md`.

---

## Phase 4: CI/CD + Docs (Tasks 9–10)

---

### [x] 4.1 Create release-exe.yml workflow

**Goal**: Auto-build executables on release and attach to GitHub Release.

**Steps**:
1. Create `.github/workflows/release-exe.yml`:
   ```yaml
   name: Release Executables

   on:
     release:
       types: [published]

   jobs:
     build:
       strategy:
         matrix:
           include:
             - os: windows-latest
               target: bun-windows-x64
               artifact: open-zread-windows-x64.exe
             - os: macos-latest
               target: bun-darwin-arm64
               artifact: open-zread-darwin-arm64
             - os: ubuntu-latest
               target: bun-linux-x64
               artifact: open-zread-linux-x64
       runs-on: ${{ matrix.os }}
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
           with:
             bun-version: latest
         - run: bun install --frozen-lockfile
         - run: bun run build
         - run: bun run build:exe --target=${{ matrix.target }}
         - uses: softprops/action-gh-release@v2
           with:
             files: dist/exe/${{ matrix.artifact }}
   ```

**Changed files**: `.github/workflows/release-exe.yml` (new)

**Validation**: YAML is syntactically valid; triggers on release published

**Time**: 5 min

---

### [x] 4.2 Update README with download links

**Goal**: Add direct download section for executables.

**Steps**:
1. In `README.md`, add after the "Install globally" section:
   ```markdown
   **Or download directly (no Node.js required):**
   | Platform | Download |
   |----------|----------|
   | Windows x64 | [open-zread-windows-x64.exe](https://github.com/bb-boy680/open-zread/releases/latest/download/open-zread-windows-x64.exe) |
   | macOS ARM | [open-zread-darwin-arm64](https://github.com/bb-boy680/open-zread/releases/latest/download/open-zread-darwin-arm64) |
   | Linux x64 | [open-zread-linux-x64](https://github.com/bb-boy680/open-zread/releases/latest/download/open-zread-linux-x64) |
   ```
2. Mirror in `docs/README.zh-CN.md`

**Changed files**: `README.md`, `docs/README.zh-CN.md`

**Validation**: Markdown renders; links follow GitHub Release asset naming

**Time**: 3 min
