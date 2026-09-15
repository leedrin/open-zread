# Open Zread Hub

This is the Windows-first Tauri + React desktop shell for Open Zread Hub.
React talks to the Rust host only through the typed `HubApplicationService`
client in `src/lib/application-service.ts`. File access, provider processes,
and long-running task coordination belong behind that boundary.

## Local development

Install the Rust toolchain and the Windows WebView2 runtime, then run:

```powershell
bun run --cwd apps/hub tauri:dev
```

The frontend-only shell can be checked with:

```powershell
bun run --cwd apps/hub build
bun test apps/hub/src/__tests__/hub-tracer.test.tsx
```

The native installer is produced with `bun run --cwd apps/hub tauri:build`.
