# Commander Web Layer — Decisions

## Phase 1: CLI + Server

- `--commander` flag added as boolean in `src/cli.ts`
- Optional `--commander-port <n>` (default 3000)
- Handled FIRST in `src/index.ts` before all other modes
- Server module: `src/commander/server.ts`

## Phase 2: Command Registry + Job Runner

- `src/commander/services/command-runner.ts` — in-memory job store, background exec, log streaming
- `src/commander/services/plugin-adapters.ts` — one adapter per plugin app
- Job states: queued → running → success | failed | cancelled
- CommandSpec<Input, Output> pattern with validateInput + run + timeoutMs + allowInUi

## Phase 7: Frontend Scaffold

- Run shadcn scaffold FROM within opencode-usage root
- Output dir: `src/commander-ui/` (if tool allows; otherwise `apps/commander-ui/` and adjust build)
- shadcn style: lyra, zinc base, green theme, JetBrains Mono font, Lucide icons, no radius
- Separate tsconfig for commander-ui (jsx: react-jsx, NOT @opentui/solid)

## Plugin Extensions Required

1. oc-codex-multi-account: add --json to all commands
2. oc-anthropic-multi-account: package CLI in npm dist, add JSON output
3. opencode-gitbutler: add minimal ops CLI (doctor/setup/status)
4. opencode-usage: keep as-is for stats; add any missing JSON fields for UI
