# Implementation Plan: bun-compile-executable

## Source
- Proposal: openspec/changes/bun-compile-executable/proposal.md
- Design: openspec/changes/bun-compile-executable/design.md
- Specs: openspec/changes/bun-compile-executable/specs/
- Tasks: openspec/changes/bun-compile-executable/tasks.md

## Execution Order

### Task 1: Add compiled mode detection utility
- Goal: Create a shared `isCompiledExecutable()` function that detects whether the CLI is running as a standalone executable (via `bun --compile`) or as an npm package.
- Source tasks: 1.1
- Design anchors: Decision 2 — runtime detection via `process.isBun` + `Bun.embeddedFiles`
- Changed files: `packages/repo-analyzer/src/parser/wasm-loader.ts`
- Validation: `bun run typecheck` passes; function returns `false` in dev/npm mode
- Depends on: none
- Notes: Use `(globalThis as any).Bun?.embeddedFiles` to safely access the API without breaking non-Bun runtimes. Must not import from `bun` directly — the file runs under both Node.js and Bun.

### Task 2: Adapt `getTreeSitterDir()` for compiled mode
- Goal: When `isCompiledExecutable()` is true, locate `tree-sitter.wasm` from the compiled binary's embedded filesystem instead of searching `node_modules` upward.
- Source tasks: 1.2
- Design anchors: Decision 2, Decision 4 — reuse tsup output which copies `tree-sitter.wasm` alongside `index.js` in `dist/`
- Changed files: `packages/repo-analyzer/src/parser/wasm-loader.ts`
- Validation: `bun run typecheck` and `bun run lint` pass; existing npm-mode path resolution logic is untouched (the `node_modules` search branches remain identical)
- Depends on: Task 1
- Notes: In compiled mode, `import.meta.url` points to the extracted binary's directory. Since tsup already copies `tree-sitter.wasm` to `dist/` alongside `index.js`, the existing check `if (existsSync(join(currentDir, 'tree-sitter.wasm')))` at line 73 should already work IF `__dirname` resolves correctly. Verify this path works under `bun --compile` — if `import.meta.url` resolves to the binary's extraction directory, the existing logic may already suffice. Only add a new branch if it doesn't.

### Task 3: Adapt browse-server.ts frontend path for compiled mode
- Goal: When running as a compiled executable, locate the `browse/` frontend files from the embedded filesystem instead of `__dirname + "browse"`.
- Source tasks: 1.3
- Design anchors: Decision 2, Decision 4
- Changed files: `apps/cli/src/commands/browse-server.ts`
- Validation: `bun run typecheck` and `bun run lint` pass; `globalThis.IS_PACKAGED` production path at line 195 remains identical for npm mode
- Depends on: Task 1
- Notes: Similar to Task 2 — if `__dirname` resolves correctly under `bun --compile` to the directory containing embedded files, the existing `path.resolve(__dirname, "browse")` may already work. The key variable is whether Bun's compiled executable extracts `browse/` directory structure alongside the binary. Verify empirically before adding special-case logic. If Bun's virtual FS flattens things, may need to iterate `Bun.embeddedFiles` for browse assets.

### Task 4: Verify resource resolution — typecheck + lint
- Goal: Confirm all changes from Tasks 1–3 pass static analysis without regressions.
- Source tasks: 1.4
- Design anchors: N/A
- Changed files: none (verification only)
- Validation: `bun run typecheck` ✅ and `bun run lint` ✅ from repo root
- Depends on: Task 2, Task 3
- Notes: This is a gate — do not proceed to build script until this passes.

### Task 5: Create build-exe.ts script scaffold
- Goal: Create `scripts/build-exe.ts` that accepts `--target` and `--all` CLI arguments and resolves the target platform string.
- Source tasks: 2.1
- Design anchors: Decision 1, Decision 4 — input is tsup's `apps/cli/dist/index.js`
- Changed files: `scripts/build-exe.ts` (new file)
- Validation: `bun run scripts/build-exe.ts --help` prints usage; `bun run scripts/build-exe.ts --target=bun-windows-x64` resolves target correctly (dry run OK at this step)
- Depends on: none
- Notes: Parse args with Bun's built-in `Bun.argv` or a simple arg parser. Target values: `bun-windows-x64`, `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`. Output dir: `dist/exe/`.

### Task 6: Implement build pipeline in build-exe.ts
- Goal: Wire `Bun.build()` with `compile: true`, using tsup's `apps/cli/dist/index.js` as entry, embedding WASM files and `browse/` directory.
- Source tasks: 2.2, 2.3, 2.4
- Design anchors: Decision 4 — reuse tsup output; Decision 3 — language WASMs NOT embedded
- Changed files: `scripts/build-exe.ts`
- Validation: `bun run scripts/build-exe.ts --target=bun-windows-x64 --skip-build` produces `dist/exe/open-zread-windows-x64.exe` (may need to run `bun run build` first if `--skip-build` not set)
- Depends on: Task 4, Task 5
- Notes: Key Bun.build config: `entrypoints: ['apps/cli/dist/index.js']`, `compile: true`, `target`, `outdir: 'dist/exe'`, `naming: 'open-zread-{target}'`. For embedding: use `Bun.build`'s `loader` or pass WASM/browse files as additional entrypoints with `{ type: "file" }` import attributes. The `--define` should inject `globalThis.CLI_VERSION` from `apps/cli/package.json` version field. Add `--skip-build` flag to skip turbo build for dev iteration.

### Task 7: Add build:exe script to root package.json
- Goal: Register the build script in the monorepo root so it's accessible via `bun run build:exe`.
- Source tasks: 2.5
- Design anchors: N/A
- Changed files: `package.json` (root)
- Validation: `bun run build:exe --help` works from repo root
- Depends on: Task 5
- Notes: Add `"build:exe": "bun run scripts/build-exe.ts"` to root `scripts`.

### Task 8: Local smoke test on Windows
- Goal: Build and run the Windows executable, verifying core CLI functions.
- Source tasks: 3.1, 3.2, 3.3, 3.4, 3.5
- Design anchors: Risk — Bun compatibility; Risk — WASM path compatibility
- Changed files: none (verification only)
- Validation:
  - `bun run build` then `bun run build:exe --target=bun-windows-x64` succeeds
  - `./dist/exe/open-zread-windows-x64.exe --version` prints correct version
  - `./dist/exe/open-zread-windows-x64.exe --help` prints help text
  - `./dist/exe/open-zread-windows-x64.exe browse` starts web server (manual browser check)
  - `bun run dev` still works (npm mode not broken)
- Depends on: Task 6, Task 7
- Notes: This is a manual gate. If WASM loading fails, debug the path resolution by adding temporary logging to `getTreeSitterDir()` and running the exe. Document any issues found for CI task adjustments.

### Task 9: Create GitHub Actions workflow for executable release
- Goal: CI workflow that builds executables on all platforms and attaches them to GitHub Releases.
- Source tasks: 4.1, 4.2, 4.3, 4.4
- Design anchors: Risk — cross-platform build limitation; Decision 1
- Changed files: `.github/workflows/release-exe.yml` (new file)
- Validation: Workflow YAML is valid (`actionlint` or manual review); workflow triggers on release events
- Depends on: Task 8
- Notes: Trigger: workflow_run on `release.yml` completion, or use `release` event with `types: [published]`. Matrix: `{ os: [windows-latest, macos-latest, ubuntu-latest] }` with target mapping. Use `oven-sh/setup-bun@v2`. Upload with `actions/upload-release-asset` or softprops/action-gh-release. Build command: `bun run build && bun run build:exe --target=$TARGET`.

### Task 10: Update README with download instructions
- Goal: Add a "Direct Download" section to README with links to the executables on GitHub Releases.
- Source tasks: 4.5
- Design anchors: N/A
- Changed files: `README.md`, `docs/README.zh-CN.md`
- Validation: Markdown renders correctly; download links follow the pattern `https://github.com/bb-boy680/open-zread/releases/latest/download/open-zread-{platform}-{arch}[.exe]`
- Depends on: Task 9
- Notes: Add alongside existing npm install instructions. Include all four platform targets.
