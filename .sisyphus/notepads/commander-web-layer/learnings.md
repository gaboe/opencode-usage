# Commander Web Layer — Learnings

## Codebase Conventions

- Runtime detection: `const isBun = typeof globalThis.Bun !== "undefined"` (do this in every new file)
- File reads: Bun.file(path).text() vs readFile(path, "utf-8") — dual runtime pattern
- Imports: `.js` extension required on all local imports (ESM)
- Types: use `export type X = { ... }` never `interface`
- No external npm dependencies — zero-dep principle (EXCEPT the new commander-ui React app which scaffolds its own)
- tsconfig: `moduleResolution: bundler`, `jsx: preserve`, `jsxImportSource: @opentui/solid` (for existing code; commander-ui will have its own tsconfig)

## Entry Points

- `src/index.ts` — main entry, reads CLI args via `parseArgs()`, dispatches modes
- `src/cli.ts` — parseArgs with node:util, `CliArgs` type, `getArgs()` function
- Existing modes: default (Solid TUI dashboard), `--stats` (table), `--config show`
- New mode: `--commander` — should detect BEFORE existing modes, call `runCommanderServer()` and return

## Data Pipeline

- Usage: `loader.ts` → `aggregator.ts` → `renderer.ts`
- Quota: `quota-loader.ts` (anthropic multi-account, antigravity) + `codex-client.ts` (codex)
- Config path: `~/.config/opencode/opencode-usage-config.json` (via `src/config.ts`)
- Storage path: `~/.local/share/opencode/opencode.db` (SQLite)

## Key File Paths (from types + loaders)

- Anthropic multi-account: `~/.config/opencode/anthropic-multi-account-state.json` (+ legacy `~/.local/share/opencode/multi-account-state.json`)
- Antigravity: `~/.config/opencode/antigravity-accounts.json`
- Codex multi-auth: `~/.config/opencode/codex-multi-account-accounts.json` (+ several legacy paths)
- Codex auth: `~/.codex/auth.json`
- OpenCode config: `~/.config/opencode/opencode.json`

## Architecture Decisions (LOCKED)

- Dual control model: CLI (canonical) + Web UI (orchestrates same commands via background jobs)
- Server: local-only 127.0.0.1, auto-open browser
- UI stack: React + Tailwind + shadcn/ui (Vite template from locked bootstrap command)
- shadcn bootstrap: `bunx --bun shadcn@latest create --preset "https://ui.shadcn.com/init?base=base&style=lyra&baseColor=zinc&theme=green&iconLibrary=lucide&font=jetbrains-mono&menuAccent=bold&menuColor=default&radius=none&template=vite&rtl=false" --template vite`
- Config writes: command-first (via adapters), fallback = direct atomic file write with backup

## Test Infrastructure

- Framework: `bun:test` native
- Tests in: `src/__tests__/`
- Verification: `bun run check:ci`, `bun run build`
- NO external test runner, no jest, no vitest (in main package — commander-ui may use vitest from shadcn scaffold)

## Phase 2: Command Runner Patterns

- `server.ts` already had usage-service and quota-service imports when Phase 2 started
- Route matching: simple `url.pathname.startsWith("/api/jobs/")` + `.slice()` for param extraction
- Async fire-and-forget: `void executeJob(...)` pattern — no await, no unhandled rejection
- Timeout pattern: `setTimeout` + `timedOut` flag; if `spec.run` resolves after timeout, result is silently discarded
- Biome auto-fix: `bunx biome check --write` fixes formatting before CI gate
- **CORRECTION**: Formatter is `oxfmt` (via `bunx oxfmt`), NOT Biome. `check:ci` uses `bunx oxfmt --check`. Biome won't fix formatting for this project.

## Phase 4: Config Service Patterns

- Config service follows same service pattern: types + async functions, no classes
- `ConfigError` with `.status` field propagates HTTP status codes cleanly to route handlers
- Atomic write: write to `<path>.tmp` then `fs.rename()` — prevents partial writes
- Backup before every write to `~/.config/opencode/commander-backups/<ISO-timestamp>/`
- Route param extraction: `url.pathname.slice("/api/config/".length)` + `isValidSource()` guard
- Rollback walks backup dirs in reverse chronological order (lexicographic sort of ISO timestamps)

## Phase 5 — Plugin Adapters & Action Routes

- Formatter is `oxfmt` (not biome) — run `bunx oxfmt` before CI gate
- `registerCommand` is called at module load time via side-effect import
- `ensureActionsRegistered()` uses dynamic `import()` to trigger side-effects
- Provider→source mapping: anthropic→anthropic-multi-account-state, codex→opencode-usage-config, antigravity→antigravity-accounts
- All action routes return `{ jobId }` with status 202 (fire-and-forget pattern)
- Account routes use path segments: `/api/accounts/:provider/:action`
- Generic action routes use prefix match: `/api/actions/:action`

## Phase 6 - App Initializer Service

- App catalog: 4 apps with detection via `Bun.spawnSync` and `Bun.file().exists()`
- Detection returns `AppStatus` with state: ready | partial | missing-deps | not-installed
- Init/repair commands registered via same `registerCommand` pattern as plugin-adapters
- `ensureAppCommandsRegistered()` follows same idempotent guard pattern as `ensureActionsRegistered()`
- Plugin list patching: read opencode.json, ensure `plugins` array, append if missing, write back
- Repair workflow: detect -> if not ready -> run init -> re-detect -> report final state
- Routes: GET /api/apps (catalog), POST /api/apps/:appId/init, POST /api/apps/:appId/repair
- Path param extraction: `.slice()` + `.replace()` pattern for nested routes
- Formatter: `oxfmt` (run `bunx oxfmt` before CI) - biome check/write is insufficient

## CRITICAL: Formatter is oxfmt, NOT Biome

- `bun run check:ci` uses `bunx oxfmt --check` for format verification
- `bunx biome check --write` does NOT fix oxfmt issues
- To auto-fix formatting: run `bunx oxfmt` (no flags) before check:ci
- Pattern: `bunx oxfmt && bun run check:ci`

## Phase F1+F2: Commander UI Bootstrap

- `shadcn create --preset` fails on existing repos (framework detection error) — use `bun create vite` first, then `shadcn init <preset-url>`
- `shadcn init` requires Tailwind CSS + path aliases BEFORE running: install `tailwindcss @tailwindcss/vite`, configure `@/` in tsconfig
- Parent tsconfig `jsxImportSource: @opentui/solid` conflicts with React — MUST add `"src/commander-ui"` to parent exclude list
- commander-ui has independent tsconfig with `"jsx": "react-jsx"` — no parent reference
- shadcn lyra style auto-installs: clsx, tailwind-merge, tw-animate-css, shadcn, @fontsource-variable/jetbrains-mono
- Static file serving: `Bun.file()` + `.exists()` check, SPA fallback to index.html for non-API routes
- Removed `segments` variable from server.ts (was only kept alive via `void segments`)

## Phase F3: Core Screen Implementation

- shadcn v3+ `base-lyra` style uses `@base-ui/react` primitives, NOT `@radix-ui`
- Select `onValueChange` is `(value: string | null, eventDetails) => void` — must guard for null: `(v) => v && setState(v)`
- AlertDialogTrigger/DialogTrigger use `render={<Button ... />}` pattern, not wrapping children
- sonner Toaster from shadcn scaffold imports `next-themes` by default — must strip for Vite apps (replace with `theme="system"`)
- Shared hooks: `useAsync<T>` in `lib/use-async.ts` for fetch+loading+error+refetch pattern
- Shared components: `JobLogPanel` in `components/job-log-panel.tsx` polls via `pollJob` async generator
- All destructive actions go through AlertDialog confirm pattern
- Toast via `import { toast } from "sonner"` directly, Toaster component added to `main.tsx` root
- 13 shadcn components installed: button, card, table, badge, progress, skeleton, tabs, dialog, alert-dialog, input, textarea, select, sonner

## Reliability & Accessibility Pass

- Pages use `useAsync` hook with `status` field (`loading`/`error`/`success`) and `refetch` method
- All 5 data-fetching pages (Dashboard, Accounts, ConfigFiles, AppInitializer, Health) had inline `<Skeleton>` loading patterns — replaced with `<PageSkeleton>` for consistency
- ActionsPage has no async loading (static forms with tabs) — no loading/error state needed
- DashboardPage has TWO async calls (usage + quota) — kept quota skeletons custom (grid layout), usage uses PageSkeleton
- HealthPage uses `useAutoRefreshHealth` (custom hook with polling) — no `refetch` method, retry uses `window.location.reload()`
- Sidebar nav already used `<button>` elements (natively keyboard accessible), added explicit `role`/`tabIndex`/`onKeyDown` for belt-and-suspenders
- ErrorBoundary uses `key={activePage}` to reset state when switching pages
- Removed unused `Skeleton` imports from AccountsPage, AppInitializerPage, HealthPage after switching to PageSkeleton
