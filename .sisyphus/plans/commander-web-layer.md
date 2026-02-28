# Commander Web Layer (React + Local Server)

## TL;DR

Add a new `commander` mode to `opencode-usage` that starts a local browser app (React) and exposes everything currently visible in the CLI dashboard, plus full parity+ configuration and action flows from UI. Control is intentionally dual-layer: direct CLI remains first-class, and Web UI orchestrates the same CLI capabilities in background jobs. The web layer also includes guided initialization for gaboe-owned workspace apps/plugins from `/Users/gabrielecegi/oc`, so users can set up missing pieces directly from Commander.

## Locked Decisions

- Scope: **Full parity+** (all existing CLI/TUI visibility + advanced actions)
- Server exposure: **local-only** (`127.0.0.1` by default, auto-open browser)
- Quality process: **strict TDD** (RED -> GREEN -> REFACTOR)
- Control model: **CLI-first adapters**, Web UI calls command handlers in background (no business-logic fork)
- Config mutation policy: prefer command endpoints; direct file writes only as controlled fallback for sources without command support
- UI stack: **React + Tailwind CSS + shadcn/ui** (shared design tokens, accessible primitives)
- Editable configuration sources in V1:
  - `~/.config/opencode/opencode-usage-config.json`
  - `~/.codex/auth.json`
  - `~/.config/opencode/anthropic-multi-account-state.json` (with legacy read fallback)
  - `~/.config/opencode/antigravity-accounts.json`
- V1 action matrix includes all requested capabilities:
  - core actions (add/remove/switch account, save settings, manual refresh, health checks)
  - threshold tuning
  - import/export config
  - reset/rollback
  - app/plugin initialization for missing apps

## Current Codebase Reuse (No Duplicate Business Logic)

- CLI entry and flags: `src/cli.ts`, `src/index.ts`
- Usage data pipeline: `src/loader.ts` -> `src/aggregator.ts` -> `src/renderer.ts`
- Quota sources: `src/quota-loader.ts`, `src/codex-client.ts`
- Existing types: `src/types.ts`
- Existing dashboard source of truth: `src/dashboard-solid.tsx`

Commander will reuse loader/aggregator/quota modules and add an HTTP + React layer around them.

## Dual Control Model (CLI + Web UI)

- Layer 1: CLI commands stay canonical and scriptable.
- Layer 2: Web UI calls Commander API, which executes the same command handlers in background jobs.
- Every mutating UI action maps to a command contract:
  - command id
  - input payload
  - streamed logs
  - structured result
- UI never bypasses command layer for plugin actions.
- For plugin ecosystems that lack stable command surface, Commander uses temporary fallback adapters and a defined plugin-extension roadmap.

## App Initialization Scope (from `/Users/gabrielecegi/oc`)

Prioritized app catalog (gaboe-owned from `/Users/gabrielecegi/oc/AGENTS.md`):

1. `oc-codex-multi-account`
   - install plugin in OpenCode config space
   - bootstrap/add accounts
   - expose/status/config convenience actions
2. `oc-anthropic-multi-account`
   - install plugin entry and setup guidance
   - add initial accounts
   - threshold and interval setup
3. `opencode-gitbutler`
   - install plugin entry
   - detect/install `gitbutler` CLI dependency
4. `opencode-usage`
   - verify availability and install/run helpers (`bunx`/`npx`/global)

## Precise Init Scripts (One-Click vs Guided)

The initializer runs in two modes:

- `one-click` = safe, non-interactive, deterministic steps
- `guided` = interactive, system-level, or secret-sensitive steps requiring explicit user flow

### Global Preflight (one-click)

Run for every init flow before app-specific steps:

```bash
node -v
bun -v
opencode --version
test -d ~/.config/opencode || mkdir -p ~/.config/opencode
test -f ~/.config/opencode/opencode.json || printf '{"$schema":"https://opencode.ai/config.json","plugin":[]}\n' > ~/.config/opencode/opencode.json
```

### 1) `oc-codex-multi-account`

One-click:

```bash
bun add oc-codex-multi-account --cwd ~/.config/opencode
~/.config/opencode/node_modules/.bin/oc-codex-multi-account status
~/.config/opencode/node_modules/.bin/oc-codex-multi-account config
```

Guided:

```bash
~/.config/opencode/node_modules/.bin/oc-codex-multi-account add <alias>
~/.config/opencode/node_modules/.bin/oc-codex-multi-account add <alias-2>
~/.config/opencode/node_modules/.bin/oc-codex-multi-account config --thresholds 0.75,0.85
```

Notes:

- Commander auto-patches `~/.config/opencode/opencode.json` plugin list to include `oc-codex-multi-account@latest`.
- `add <alias>` stays guided because it triggers OAuth/browser auth.

### 2) `oc-anthropic-multi-account`

One-click:

```bash
test -d /Users/gabrielecegi/oc/oc-anthropic-multi-account
```

Guided:

```bash
cd /Users/gabrielecegi/oc/oc-anthropic-multi-account && bun install
cd /Users/gabrielecegi/oc/oc-anthropic-multi-account && bun src/cli.ts add primary
cd /Users/gabrielecegi/oc/oc-anthropic-multi-account && bun src/cli.ts add fallback1
cd /Users/gabrielecegi/oc/oc-anthropic-multi-account && bun src/cli.ts config --thresholds 95,80,90
```

Notes:

- Commander auto-patches `~/.config/opencode/opencode.json` plugin list to include `oc-anthropic-multi-account@latest`.
- Exporting `OPENCODE_DISABLE_DEFAULT_PLUGINS=true` is guided (shell-profile mutation).
- Account add remains guided due OAuth token flow.

### 3) `opencode-gitbutler`

One-click:

```bash
but --version
```

Guided:

```bash
brew install gitbutler
but --version
```

Notes:

- Commander auto-patches `~/.config/opencode/opencode.json` plugin list to include `opencode-gitbutler@latest`.
- `brew install` is guided because it is a system-level dependency install.

### 4) `opencode-usage`

One-click:

```bash
bunx opencode-usage --stats -d 1
```

Guided (optional global install path):

```bash
bun add -g opencode-usage
npm install -g opencode-usage
```

Notes:

- Commander should prefer zero-install run (`bunx`) before proposing global install.

### Plugin List Patch Strategy (command-first)

Preferred path:

- call command adapters that manage plugin registration as explicit operations
- keep operation audit trail (who, when, old/new state)

Fallback path (only if command support is unavailable):

- apply idempotent patch to `~/.config/opencode/opencode.json`
- create file if missing
- ensure `plugin` is an array
- append missing plugin entries only (no duplicates)
- preserve existing non-related config keys unchanged

## Target UX

- `opencode-usage --commander` opens `http://127.0.0.1:<port>`.
- Left navigation:
  - Dashboard
  - Accounts
  - Config Files
  - Actions
  - App Initializer
  - Health
- App Initializer shows per-app state:
  - `installed` / `partially configured` / `missing dependencies` / `ready`
  - one-click actions: `Initialize`, `Repair`, `Re-check`
  - live logs for executed steps

## Architecture

### CLI and Process Layer

- Extend `src/cli.ts`:
  - add `--commander` boolean flag
  - add optional `--commander-port <n>`
- Extend `src/index.ts`:
  - if `commander` flag is set, call `runCommanderServer(...)` and return
  - keep existing `--stats`/dashboard behavior unchanged

### New Backend Modules

- `src/commander/server.ts`
  - start local HTTP server on `127.0.0.1`
  - serve API + static React assets
  - auto-open browser URL
- `src/commander/api.ts`
  - route registration and request validation
- `src/commander/services/usage-service.ts`
  - wraps existing loader+aggregator
- `src/commander/services/quota-service.ts`
  - wraps quota-loader + codex-client
- `src/commander/services/config-service.ts`
  - file reads/writes, schema guards, atomic writes, backup/rollback
- `src/commander/services/action-service.ts`
  - account actions, refresh, import/export, reset
- `src/commander/services/app-init-service.ts`
  - app detection + initialization workflows for `/Users/gabrielecegi/oc`
- `src/commander/services/command-runner.ts`
  - background job execution, log streaming, status persistence
- `src/commander/services/plugin-adapters.ts`
  - command mappers for each plugin/app (single contract for CLI + UI)

### React Frontend

- `src/commander-ui/` React app (Bun build pipeline)
- Styling: Tailwind CSS utility layer + CSS variables for theme tokens
- Components: shadcn/ui for core primitives (table, dialog, sheet, tabs, form, toast, command)
- Rule: no business logic in components; UI only calls command/job API
- Feature folders:
  - `pages/dashboard`
  - `pages/accounts`
  - `pages/config-files`
  - `pages/actions`
  - `pages/app-initializer`
  - `pages/health`

## API Contract (V1)

- `GET /api/usage`
  - query: `provider`, `days`, `since`, `until`, `monthly`
  - returns same aggregated semantics as existing CLI
- `GET /api/quota`
  - returns anthropic + antigravity + codex snapshots
- `GET /api/config/files`
  - returns file presence, parse status, and safe metadata
- `GET /api/config/:source`
  - returns parsed content for editable source
- `PUT /api/config/:source`
  - validates and writes file atomically, creates backup
- `POST /api/accounts/:provider/add`
- `POST /api/accounts/:provider/remove`
- `POST /api/accounts/:provider/switch`
- `POST /api/actions/thresholds`
- `POST /api/actions/import`
- `POST /api/actions/export`
- `POST /api/actions/reset`
- `POST /api/actions/rollback`
- `GET /api/apps`
  - app catalog + state for `/Users/gabrielecegi/oc`
- `POST /api/apps/:appId/init`
  - executes initialization workflow with step-by-step logs
- `POST /api/apps/:appId/repair`
- `POST /api/commands/run`
  - run command id + payload as background job
- `GET /api/jobs/:jobId`
  - fetch job status + structured logs + result
- `GET /api/jobs/:jobId/stream`
  - stream command logs/events to UI

## Technical Contract (CLI <-> Web)

### Command Registry Shape

Each executable operation is registered as:

```ts
type CommandSpec<Input, Output> = {
  id: string;
  validateInput: (payload: unknown) => Input;
  run: (ctx: CommandContext, input: Input) => Promise<Output>;
  timeoutMs: number;
  allowInUi: boolean;
};
```

### Background Job Model

```ts
type JobStatus = "queued" | "running" | "success" | "failed" | "cancelled";

type CommandJob = {
  id: string;
  commandId: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  logs: Array<{
    ts: string;
    level: "info" | "warn" | "error";
    message: string;
  }>;
  result?: unknown;
  error?: { code: string; message: string };
};
```

### UI Action Flow

1. UI submits command payload to `POST /api/commands/run`.
2. API validates payload against `CommandSpec.validateInput`.
3. Job is queued and starts in command runner.
4. UI subscribes to `GET /api/jobs/:jobId/stream` for logs.
5. UI refreshes final state via `GET /api/jobs/:jobId`.

### Error Handling Rules

- Validation errors return `400` with structured field errors.
- Command runtime failures return job `failed` status (not transport failure).
- Unexpected server faults return `500` with request id; UI still gets terminal job state.

## Security and Safety Rules

- Bind local only (`127.0.0.1`) by default.
- CSRF token and same-origin checks for mutation endpoints.
- Atomic writes for all config edits (`tmp` + rename).
- Automatic backups before each write:
  - `~/.config/opencode/commander-backups/<timestamp>/...`
- Redact secret values in UI by default.
- For `~/.codex/auth.json`, require explicit "reveal/edit secrets" confirmation step.
- Command execution for app init is allowlisted per app (no arbitrary shell execution).
- Command runner enforces timeout, cancellation, and per-command schema validation.

## App Initializer Workflows (V1)

### `oc-codex-multi-account`

- Detect:
  - plugin entry in OpenCode config
  - CLI availability in `~/.config/opencode/node_modules/.bin/`
  - account store file present/valid
- Initialize:
  - ensure package installed in OpenCode config dir
  - ensure plugin reference configured
  - launch add-account flow
  - run status check

### `oc-anthropic-multi-account`

- Detect:
  - plugin configured
  - account/state files present
- Initialize:
  - plugin install/config helper
  - guided account add flow
  - threshold defaults and recovery interval setup

### `opencode-gitbutler`

- Detect:
  - plugin configured
  - `gitbutler` CLI availability
- Initialize:
  - plugin setup
  - dependency install (if missing)
  - workspace config scaffold (optional)

### `opencode-usage`

- Detect:
  - local binary/command availability
- Initialize:
  - install path helper (`bunx`/`npx`/global)
  - smoke-run with safe default command

## TDD Execution Plan

### Wave 1 - CLI + server skeleton

1. Add `--commander` and port args in `src/cli.ts`
2. Wire branch in `src/index.ts`
3. Add server bootstrap + health endpoint

Tests first:

- parse args tests for commander flags
- server starts/stops on local bind

### Wave 2 - Usage and quota APIs

4. Implement `GET /api/usage` via existing loader/aggregator
5. Implement `GET /api/quota`

Tests first:

- API response shape tests
- parity tests against existing aggregation outputs

### Wave 3 - Config editing and rollback

6. Implement config read/write endpoints
7. Add backup + rollback service

Tests first:

- schema validation tests per file source
- atomic write + rollback tests

### Wave 4 - Account actions and thresholds

8. Implement account actions (add/remove/switch)
9. Implement threshold tuning + reset + import/export

Tests first:

- action contract tests
- import/export roundtrip tests

### Wave 5 - App initializer

10. Implement app catalog detection for `/Users/gabrielecegi/oc`
11. Implement per-app allowlisted init/repair workflows + logs

Tests first:

- detector tests (installed/missing/partial states)
- init workflow tests with mocked command runner

### Wave 5.5 - Command-first control plane

12. Add command registry and background job runner
13. Wire Web UI actions to command endpoints (`/api/commands/run`)

Tests first:

- command schema validation tests
- job lifecycle tests (queued/running/success/failed/cancelled)
- log streaming tests for long-running init commands

### Wave 6 - React UI and integration

14. Bootstrap frontend styling stack (Tailwind + shadcn/ui) using provided preset command
15. Build React screens and wire all API actions
16. Add end-to-end smoke tests for key flows

Tests first:

- component tests for core pages
- smoke E2E: open app -> edit config -> init app -> rollback

## Definition of Done

- `opencode-usage --commander` launches local browser app successfully.
- Web dashboard shows equivalent usage/quota data as current CLI/TUI pipeline.
- All selected config files are editable from UI with validation and backups.
- Full action matrix (core + thresholds + import/export + reset/rollback) works.
- App initializer supports the four `/Users/gabrielecegi/oc` target apps with status detection and init flows.
- Dual-layer control works: same operations are available via CLI and via Web UI-triggered background command jobs.
- Strict TDD evidence exists for new backend/frontend modules.
- `bun run check:ci` and `bun run build` pass.

## Risks and Mitigations

- Secret handling risk (`~/.codex/auth.json`): redact by default + explicit unlock gate.
- Command-execution risk: allowlisted workflows only, no free-form commands.
- Drift between CLI and web logic: reuse existing loader/aggregator/quota modules directly.
- Drift between CLI and web actions: command-first adapters, shared command contracts, and parity tests for CLI vs UI-triggered operations.
- Partial setup states across apps: model explicit states (`missing`, `partial`, `ready`) and provide repair paths.

## Plugin Extension Roadmap (Required for clean command-first UX)

To keep "CLI + Web UI" truly symmetric, plugin command surfaces should be normalized:

1. `oc-codex-multi-account`
   - already has strong CLI; add machine-readable output mode for all relevant commands (for example `--json`).
2. `oc-anthropic-multi-account`
   - expose packaged executable CLI in npm distribution (avoid repo-local `bun src/cli.ts ...` dependency).
   - add stable command set for `status`, `add`, `remove`, `switch`, `config set/reset`, with JSON output.
3. `opencode-gitbutler`
   - add minimal ops CLI (`doctor`, `setup`, `status`) for Commander orchestration.
4. `opencode-usage`
   - keep existing CLI as source-of-truth for stats layer; add any missing machine-readable fields needed by UI.

## Immediate Implementation Order

1. CLI flag + server bootstrap
2. Command registry + background job runner
3. API parity for usage/quota
4. Config and backup engine (command-first, fallback write path)
5. Action matrix endpoints via command adapters
6. App initializer service
7. React UI wiring

## Tailwind + shadcn UI Baseline

### Bootstrap Command (locked)

Run in repository root (`/Users/gabrielecegi/oc/opencode-usage`) for Commander UI scaffolding:

```bash
bunx --bun shadcn@latest create --preset "https://ui.shadcn.com/init?base=base&style=lyra&baseColor=zinc&theme=green&iconLibrary=lucide&font=jetbrains-mono&menuAccent=bold&menuColor=default&radius=none&template=vite&rtl=false" --template vite
```

Post-bootstrap constraints:

- Keep generated UI in `src/commander-ui/` (or `apps/commander-ui/` if tool scaffolds a top-level app).
- Do not mix a second styling system; Tailwind + shadcn remain the only UI layer.
- Standardize command palette, forms, and dialogs on shadcn primitives (no ad-hoc custom variants first).

### Frontend Phases (technical)

1. `F1 Scaffold`
   - Run locked bootstrap command.
   - Normalize generated paths and aliases.
   - Add CI check for frontend typecheck/build.
2. `F2 Foundation`
   - Wire API client + SSE/WebSocket job-stream client.
   - Build app shell (`sidebar`, top status strip, command palette).
   - Define token map and baseline layout constraints.
3. `F3 Core Screens`
   - Dashboard, Accounts, Config Files, Actions, App Initializer, Health.
   - Each mutation uses command jobs (`/api/commands/run`) and streamed logs.
4. `F4 Reliability`
   - Error boundaries, loading skeletons, retry affordances, confirm dialogs.
   - Accessibility pass for keyboard navigation and focus order.
5. `F5 Verification`
   - Component tests for shell + forms.
   - E2E smoke for full flow: init app -> edit config -> rollback.

### Design Tokens

- Define semantic tokens via CSS variables (`--background`, `--foreground`, `--card`, `--muted`, `--accent`, `--destructive`, `--border`).
- Map tokens to Tailwind utilities to keep theming centralized and predictable.
- Keep light-first default theme; optional dark theme toggle can be added later.

### Required shadcn Components (V1)

- `sidebar` or equivalent navigation shell
- `table` for usage/quota views
- `tabs` for source switching
- `dialog` + `alert-dialog` for destructive actions
- `form`, `input`, `select`, `switch`, `checkbox` for settings
- `badge`, `progress`, `toast`, `skeleton` for status feedback
- `command` for quick action launcher

### UX Rules

- Long-running actions always show job state (`queued`, `running`, `success`, `failed`) and streamed logs.
- Destructive operations require explicit confirm dialog with resource name.
- All forms show schema validation errors inline and keep server error payload visible.
