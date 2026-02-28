# Commander Web Layer — Problems Encountered

(none yet — will be appended as implementation progresses)

## Pre-existing tsc errors in server.ts

- `Bun.openInBrowser` — TS2339: property does not exist on `typeof Bun`
  - Likely a newer Bun API not yet in `@types/bun`; existed before Phase 2 work
- `args.commanderPort` — TS2339: not on `CliArgs`
  - Phase 1 added the flag to `cli.ts` but the type wasn't published to HEAD yet
- Neither error is caused by the command-runner/services additions

## Bun.openInBrowser does NOT exist (Phase 3)

- `Bun.openInBrowser` does not exist at runtime in Bun 1.3.9
- Only `Bun.openInEditor` exists on the Bun global
- Solution: use `Bun.spawn` with platform-appropriate command (`open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows)

## Formatter is oxfmt, not biome (Phase 3)

- `check:ci` uses `bunx oxfmt --check` for formatting
- Running `bunx --bun biome format --write` does NOT satisfy the check
- Must run `bunx oxfmt` to auto-format before CI passes
