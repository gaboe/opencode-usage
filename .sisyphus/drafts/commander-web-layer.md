# Draft: Commander Web Layer

## Requirements (confirmed)

- "novy command - commander"
- "otvoril novy seerver appku v borwesery - react"
- "bolo by tam vidiet vsetko co je vidiet teraz v cli dashboarde"
- "zaroven by to bolo vsetko konfigorvatelne cez ui"
- "hlavne tie rozne settings subory"
- "dali by sa cez to robit akcie - naiklad pridanie uctu"
- "akoby vrstva nad tym cli"
- V1 scope: `Full parity+`
- V1 must include app initialization flows for user's apps from workspace `/Users/gabrielecegi/oc`.
- Control model: two layers (`CLI` + `Web UI`) with command-first orchestration.
- UI stack requirement: `React + Tailwind CSS + shadcn/ui`.
- Bootstrap setup command locked to provided preset:
  - `bunx --bun shadcn@latest create --preset "https://ui.shadcn.com/init?base=base&style=lyra&baseColor=zinc&theme=green&iconLibrary=lucide&font=jetbrains-mono&menuAccent=bold&menuColor=default&radius=none&template=vite&rtl=false" --template vite`

## Technical Decisions

- Planning mode only: produce decision-complete implementation plan before any code work.
- V1 scope target: `Full parity+` (all existing CLI/TUI-visible capabilities surfaced in web layer, plus requested management actions).
- Server exposure default: local only (`127.0.0.1`) with browser auto-open.
- Test strategy: strict TDD (RED-GREEN-REFACTOR for core slices).
- Commander must include guided initialization UX for gaboe-owned apps/plugins, including "not installed" detection and one-click setup actions.
- Web UI should trigger background CLI command handlers where possible (not direct plugin-state mutation).
- Web UI architecture should use component primitives from shadcn/ui and utility styling from Tailwind.

## Research Findings

- `src/index.ts` orchestrates command flow; current dashboard entry is `runSolidDashboard(...)`.
- `src/cli.ts` uses `parseArgs`; adding a new command follows type + options + return mapping + help-text pattern.
- Current dashboard pipeline is `loader.ts` -> `aggregator.ts` -> `renderer.ts` (+ `dashboard-solid.tsx` for TUI mode).
- Settings/account-related files already read from disk: `~/.codex/auth.json`, multi-account and antigravity files via `quota-loader.ts` and `codex-client.ts`.
- Test infra exists with Bun native tests in `src/__tests__/*.test.ts`; verification commands exist via `bun run check:ci` and `bun run build`.
- Workspace-level app inventory from `/Users/gabrielecegi/oc/AGENTS.md` identifies gaboe-owned packages to prioritize for initialization support:
  - `oc-anthropic-multi-account/`
  - `oc-codex-multi-account/`
  - `opencode-usage/`
  - `opencode-gitbutler/`
- Initialization command evidence found in package docs:
  - `oc-codex-multi-account`: add plugin/config + account onboarding (`add`, `config`, `web`) from `/Users/gabrielecegi/oc/oc-codex-multi-account/README.md` and `/Users/gabrielecegi/oc/oc-codex-multi-account/OPENCODE_SETUP_1TO1.md`.
  - `oc-anthropic-multi-account`: plugin setup + account add flow (`bun src/cli.ts add ...`) from `/Users/gabrielecegi/oc/oc-anthropic-multi-account/README.md`.
  - `opencode-gitbutler`: plugin setup + GitButler dependency install (`brew install gitbutler`) from `/Users/gabrielecegi/oc/opencode-gitbutler/README.md`.
  - `opencode-usage`: package install/run (`bunx`, `npx`, global install) from `/Users/gabrielecegi/oc/opencode-usage/README.md`.

## Open Questions

- No blocking open questions; decisions are captured in plan file `.sisyphus/plans/commander-web-layer.md`.

## Scope Boundaries

- INCLUDE: React browser app as orchestration/configuration layer over CLI capabilities with full parity+ target.
- INCLUDE: dual-layer control where CLI remains canonical and Web UI orchestrates same actions.
- EXCLUDE: External/public exposure by default (local-only bind).
- INCLUDE: app initializer layer for `/Users/gabrielecegi/oc` apps/plugins with prerequisite checks and setup status.
