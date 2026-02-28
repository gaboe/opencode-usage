/**
 * Plugin adapters — register all account & action commands at import time.
 *
 * Each command is registered via `registerCommand` so the command-runner can
 * execute them as background jobs.
 */

import { registerCommand } from "./command-runner.js";
import {
  readConfig,
  writeConfig,
  rollbackConfig,
  type ConfigSource,
} from "./config-service.js";
import type { CommandContext } from "./types.js";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const isBun = typeof globalThis.Bun !== "undefined";

// Suppress unused-variable lint — runtime detection guard kept for parity
void isBun;

// ---------------------------------------------------------------------------
// Provider → config source mapping
// ---------------------------------------------------------------------------

const PROVIDER_SOURCE: Record<string, ConfigSource> = {
  anthropic: "anthropic-multi-account-state",
  codex: "codex-multi-account-accounts",
  antigravity: "antigravity-accounts",
};

function resolveSource(provider: string): ConfigSource {
  const source = PROVIDER_SOURCE[provider];
  if (!source) {
    throw new Error(
      `Unknown provider "${provider}". Valid: ${Object.keys(PROVIDER_SOURCE).join(", ")}`
    );
  }
  return source;
}

// ---------------------------------------------------------------------------
// accounts.add
// ---------------------------------------------------------------------------

registerCommand<
  { provider: string; alias: string },
  { message: string; requiresTerminal: true }
>({
  id: "accounts.add",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error("accounts.add requires a non-empty 'provider' string");
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error("accounts.add requires a non-empty 'alias' string");
    }
    return { provider: p.provider, alias: p.alias };
  },
  async run(ctx: CommandContext, input) {
    ctx.log(
      "info",
      `Adding account "${input.alias}" for provider "${input.provider}"`
    );
    ctx.log(
      "info",
      "OAuth authentication requires terminal interaction — run this command from the CLI."
    );
    return {
      message: `Account "${input.alias}" for provider "${input.provider}" requires terminal-based OAuth. Please run: opencode-usage accounts add --provider ${input.provider} --alias ${input.alias}`,
      requiresTerminal: true as const,
    };
  },
});

// ---------------------------------------------------------------------------
// accounts.remove
// ---------------------------------------------------------------------------

registerCommand<{ provider: string; alias: string }, { ok: true }>({
  id: "accounts.remove",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error("accounts.remove requires a non-empty 'provider' string");
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error("accounts.remove requires a non-empty 'alias' string");
    }
    return { provider: p.provider, alias: p.alias };
  },
  async run(ctx: CommandContext, input) {
    const source = resolveSource(input.provider);
    ctx.log("info", `Removing account "${input.alias}" from ${source}`);

    const data = (await readConfig(source)) as Record<string, unknown>;
    const accounts = (data.accounts ?? {}) as Record<string, unknown>;
    delete accounts[input.alias];
    data.accounts = accounts;

    await writeConfig(source, data);
    ctx.log("info", `Account "${input.alias}" removed successfully`);
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// accounts.switch
// ---------------------------------------------------------------------------

registerCommand<{ provider: string; alias: string }, { ok: true }>({
  id: "accounts.switch",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error("accounts.switch requires a non-empty 'provider' string");
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error("accounts.switch requires a non-empty 'alias' string");
    }
    return { provider: p.provider, alias: p.alias };
  },
  async run(ctx: CommandContext, input) {
    const source = resolveSource(input.provider);
    ctx.log(
      "info",
      `Switching active account to "${input.alias}" in ${source}`
    );

    const data = (await readConfig(source)) as Record<string, unknown>;

    // Each provider stores the active account differently
    switch (input.provider) {
      case "anthropic":
        data.currentAccount = input.alias;
        break;
      case "codex":
        data.activeAlias = input.alias;
        break;
      case "antigravity": {
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        const idx = accounts.findIndex(
          (a: Record<string, unknown>) =>
            typeof a.email === "string" && a.email === input.alias
        );
        if (idx === -1) {
          throw new Error(`Account "${input.alias}" not found in antigravity`);
        }
        data.activeIndex = idx;
        break;
      }
      default:
        throw new Error(`Unknown provider: ${input.provider}`);
    }

    await writeConfig(source, data);
    ctx.log("info", `Active account set to "${input.alias}"`);
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// accounts.ping
// ---------------------------------------------------------------------------

/** Read a credential file from ~/.config/opencode/ — NOT exposed via API. */
async function readCredentialFile(filename: string): Promise<unknown> {
  const filePath = join(homedir(), ".config", "opencode", filename);
  const text = await Bun.file(filePath).text();
  return JSON.parse(text);
}

/**
 * Barrier for bunx calls: the first call per command warms the cache,
 * subsequent calls wait for it then run in parallel.
 */
const bunxBarrier = new Map<string, Promise<void>>();

/** Spawn a plugin CLI command and parse JSON output from stdout. */
async function spawnPluginCli(
  command: string,
  args: string[],
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  const localBin = `./node_modules/${command}/dist/cli.js`;
  const useLocal = await Bun.file(localBin).exists();

  if (!useLocal) {
    const existing = bunxBarrier.get(command);
    if (existing) {
      // Wait for the first call to finish warming the cache, then run freely
      await existing.catch(() => {});
      return runPluginCli(command, args, timeoutMs, false);
    }
    // First call — set barrier so others wait, then run when cache is warm
    const warmup = runPluginCli(command, args, timeoutMs, false);
    const barrier = warmup.then(
      () => {},
      () => {}
    );
    bunxBarrier.set(command, barrier);
    barrier.finally(() => bunxBarrier.delete(command));
    return warmup;
  }

  return runPluginCli(command, args, timeoutMs, true);
}

async function runPluginCli(
  command: string,
  args: string[],
  timeoutMs: number,
  useLocal: boolean
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const localBin = `./node_modules/${command}/dist/cli.js`;
  const cmd = useLocal
    ? ["bun", localBin, ...args]
    : ["bunx", `${command}@latest`, ...args];

  // Each bunx call gets its own temp dir to avoid parallel EEXIST link races
  const cwd = useLocal
    ? undefined
    : join(tmpdir(), `bunx-${crypto.randomUUID()}`);
  if (cwd) await Bun.$`mkdir -p ${cwd}`.quiet();

  console.log(`[spawnPluginCli] starting: ${cmd.join(" ")}`);

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
    cwd,
  });

  // Kill process if it exceeds timeout (Effect CLI can hang)
  const timer = setTimeout(() => {
    console.log(`[spawnPluginCli] killing after ${timeoutMs}ms`);
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    const elapsed = Date.now() - t0;
    console.log(
      `[spawnPluginCli] exited ${exitCode} in ${elapsed}ms, stdout=${stdout.length}b`
    );

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.log(`[spawnPluginCli] stderr: ${stderr.slice(0, 300)}`);
      throw new Error(
        `${command} exited with code ${exitCode}: ${(stderr || stdout).slice(0, 300)}`
      );
    }

    // Parse JSON from the last non-empty line (CLI may print status messages first)
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as {
          status: string;
          alias: string;
          error?: string;
        };
        console.log(`[spawnPluginCli] parsed:`, parsed);
        return parsed;
      } catch {
        continue;
      }
    }

    throw new Error(`No JSON output from ${command}: ${stdout.slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
    // Clean up temp dir (fire-and-forget)
    if (cwd) Bun.$`rm -rf ${cwd}`.quiet().catch(() => {});
  }
}

/** After successful ping, zero-out stale metrics so UI no longer shows STALE. */
async function clearStaleMetrics(
  provider: string,
  alias: string
): Promise<void> {
  console.log(`[clearStaleMetrics] checking ${provider}/${alias}`);
  try {
    const source = resolveSource(provider);
    const data = (await readConfig(source)) as Record<string, unknown>;
    const now = Date.now();
    let changed = false;

    switch (provider) {
      case "anthropic": {
        const usage = (data.usage ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const acct = usage[alias];
        if (acct) {
          for (const key of ["session5h", "weekly7d", "weekly7dSonnet"]) {
            const m = acct[key] as Record<string, unknown> | undefined;
            if (m && typeof m.reset === "number" && m.reset < now / 1000) {
              m.utilization = 0;
              m.status = "active";
              delete m.reset;
              changed = true;
            }
          }
        }
        break;
      }
      case "codex": {
        const accounts = (data.accounts ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const acct = accounts[alias];
        if (acct?.rateLimits) {
          const rl = acct.rateLimits as Record<string, Record<string, unknown>>;
          for (const key of ["fiveHour", "weekly"]) {
            const w = rl[key] as Record<string, unknown> | undefined;
            if (w?.resetAt && typeof w.resetAt === "string") {
              if (new Date(w.resetAt).getTime() < now) {
                w.remaining = w.limit;
                delete w.resetAt;
                changed = true;
              }
            }
          }
        }
        break;
      }
      case "antigravity": {
        const accounts = Array.isArray(data.accounts)
          ? (data.accounts as Array<Record<string, unknown>>)
          : [];
        const acct = accounts.find((a) => a.email === alias);
        if (acct?.cachedQuota) {
          const quota = acct.cachedQuota as Record<
            string,
            Record<string, unknown>
          >;
          for (const group of Object.keys(quota)) {
            const q = quota[group];
            if (q.resetTime && typeof q.resetTime === "string") {
              if (new Date(q.resetTime).getTime() < now) {
                q.remainingFraction = 1;
                delete q.resetTime;
                changed = true;
              }
            }
          }
        }
        break;
      }
    }

    if (changed) {
      console.log(
        `[clearStaleMetrics] cleared stale data for ${provider}/${alias}`
      );
      await writeConfig(source, data);
    } else {
      console.log(
        `[clearStaleMetrics] no stale data found for ${provider}/${alias}`
      );
    }
  } catch (err) {
    console.log(`[clearStaleMetrics] error for ${provider}/${alias}:`, err);
  }
}

registerCommand<
  { provider: string; alias: string },
  { status: string; message: string }
>({
  id: "accounts.ping",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error("accounts.ping requires a non-empty 'provider' string");
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error("accounts.ping requires a non-empty 'alias' string");
    }
    return { provider: p.provider, alias: p.alias };
  },
  async run(ctx: CommandContext, input) {
    ctx.log("info", `Pinging ${input.provider} account "${input.alias}"…`);

    switch (input.provider) {
      case "anthropic": {
        ctx.log("info", "Calling oc-anthropic-multi-account ping…");
        const result = await spawnPluginCli("oc-anthropic-multi-account", [
          "ping",
          input.alias,
        ]);
        const status = String(result.status ?? "error");
        ctx.log("info", `Result: ${status}`);
        if (status === "ok") {
          await clearStaleMetrics(input.provider, input.alias);
        }
        return {
          status,
          message:
            status === "ok" ? "pong" : String(result.error ?? "unknown error"),
        };
      }

      case "codex": {
        ctx.log("info", "Calling oc-codex-multi-account ping…");
        const result = await spawnPluginCli("oc-codex-multi-account", [
          "ping",
          input.alias,
        ]);
        const status = String(result.status ?? "error");
        ctx.log("info", `Result: ${status}`);
        if (status === "ok") {
          await clearStaleMetrics(input.provider, input.alias);
        }
        return {
          status,
          message:
            status === "ok" ? "pong" : String(result.error ?? "unknown error"),
        };
      }

      case "antigravity": {
        // No CLI available — verify credentials exist
        const creds = (await readCredentialFile(
          "antigravity-accounts.json"
        )) as Record<string, unknown>;
        const accounts = Array.isArray(creds.accounts)
          ? (creds.accounts as Array<Record<string, unknown>>)
          : [];
        const account = accounts.find((a) => a.email === input.alias);
        if (!account) {
          throw new Error(`Account "${input.alias}" not found`);
        }
        if (!account.refreshToken) {
          throw new Error(`No refresh token for "${input.alias}"`);
        }

        // Full token refresh requires Google OAuth flow — verify credentials exist
        ctx.log("info", "Refresh token present");
        await clearStaleMetrics(input.provider, input.alias);
        return {
          status: "ok",
          message: "pong (credentials present)",
        };
      }

      default:
        throw new Error(`Unknown provider: ${input.provider}`);
    }
  },
});

// ---------------------------------------------------------------------------
// reauth helpers
// ---------------------------------------------------------------------------

const REAUTH_PROVIDERS: Record<string, string> = {
  anthropic: "oc-anthropic-multi-account",
  codex: "oc-codex-multi-account",
};

function reauthCliCommand(provider: string): string {
  const cmd = REAUTH_PROVIDERS[provider];
  if (!cmd) throw new Error(`Re-auth not supported for provider: ${provider}`);
  return cmd;
}

// ---------------------------------------------------------------------------
// accounts.reauth-start
// ---------------------------------------------------------------------------

registerCommand<
  { provider: string; alias: string },
  { url: string; verifier: string }
>({
  id: "accounts.reauth-start",
  timeoutMs: 15_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error(
        "accounts.reauth-start requires a non-empty 'provider' string"
      );
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error(
        "accounts.reauth-start requires a non-empty 'alias' string"
      );
    }
    return { provider: p.provider, alias: p.alias };
  },
  async run(ctx: CommandContext, input) {
    const cliCmd = reauthCliCommand(input.provider);
    ctx.log("info", `Generating auth URL for ${input.alias}…`);
    const result = await spawnPluginCli(cliCmd, ["reauth", input.alias]);
    const url = String(result.url ?? "");
    const verifier = String(result.verifier ?? "");
    if (!url || !verifier) {
      throw new Error("CLI did not return url/verifier");
    }
    ctx.log("info", "Auth URL generated");
    return { url, verifier };
  },
});

// ---------------------------------------------------------------------------
// accounts.reauth-complete
// ---------------------------------------------------------------------------

registerCommand<
  { provider: string; alias: string; callbackUrl: string; verifier: string },
  { status: string; message: string }
>({
  id: "accounts.reauth-complete",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error("accounts.reauth-complete requires 'provider'");
    }
    if (typeof p.alias !== "string" || !p.alias) {
      throw new Error("accounts.reauth-complete requires 'alias'");
    }
    if (typeof p.callbackUrl !== "string" || !p.callbackUrl) {
      throw new Error("accounts.reauth-complete requires 'callbackUrl'");
    }
    if (typeof p.verifier !== "string" || !p.verifier) {
      throw new Error("accounts.reauth-complete requires 'verifier'");
    }
    return {
      provider: p.provider,
      alias: p.alias,
      callbackUrl: p.callbackUrl,
      verifier: p.verifier,
    };
  },
  async run(ctx: CommandContext, input) {
    const cliCmd = reauthCliCommand(input.provider);
    ctx.log("info", `Completing re-auth for ${input.alias}…`);
    const result = await spawnPluginCli(cliCmd, [
      "reauth",
      "--callback",
      input.callbackUrl,
      "--verifier",
      input.verifier,
      input.alias,
    ]);
    const status = String(result.status ?? "error");
    ctx.log("info", `Result: ${status}`);
    return {
      status,
      message:
        status === "ok"
          ? "Re-authenticated successfully"
          : String(result.error ?? "unknown error"),
    };
  },
});

// ---------------------------------------------------------------------------
// actions.thresholds
// ---------------------------------------------------------------------------

registerCommand<
  { provider: string; warning: number; critical: number },
  { ok: true }
>({
  id: "actions.thresholds",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.provider !== "string" || !p.provider) {
      throw new Error(
        "actions.thresholds requires a non-empty 'provider' string"
      );
    }
    if (typeof p.warning !== "number") {
      throw new Error("actions.thresholds requires a numeric 'warning' value");
    }
    if (typeof p.critical !== "number") {
      throw new Error("actions.thresholds requires a numeric 'critical' value");
    }
    return {
      provider: p.provider,
      warning: p.warning,
      critical: p.critical,
    };
  },
  async run(ctx: CommandContext, input) {
    const source = resolveSource(input.provider);
    ctx.log(
      "info",
      `Updating thresholds for "${input.provider}" — warning: ${input.warning}, critical: ${input.critical}`
    );

    const data = (await readConfig(source)) as Record<string, unknown>;
    data.thresholds = {
      warning: input.warning,
      critical: input.critical,
    };

    await writeConfig(source, data);
    ctx.log("info", "Thresholds updated successfully");
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// actions.import
// ---------------------------------------------------------------------------

registerCommand<
  { source: string; data: unknown },
  { ok: true; backupPath: string }
>({
  id: "actions.import",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.source !== "string" || !p.source) {
      throw new Error("actions.import requires a non-empty 'source' string");
    }
    if (p.data === undefined) {
      throw new Error("actions.import requires a 'data' field");
    }
    return { source: p.source, data: p.data };
  },
  async run(ctx: CommandContext, input) {
    ctx.log("info", `Importing config into "${input.source}"`);
    const { backupPath } = await writeConfig(
      input.source as ConfigSource,
      input.data
    );
    ctx.log("info", `Config imported, backup at ${backupPath}`);
    return { ok: true as const, backupPath };
  },
});

// ---------------------------------------------------------------------------
// actions.export
// ---------------------------------------------------------------------------

registerCommand<{ source: string }, { source: string; data: unknown }>({
  id: "actions.export",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.source !== "string" || !p.source) {
      throw new Error("actions.export requires a non-empty 'source' string");
    }
    return { source: p.source };
  },
  async run(ctx: CommandContext, input) {
    ctx.log("info", `Exporting config from "${input.source}"`);
    const data = await readConfig(input.source as ConfigSource);
    ctx.log("info", "Config exported successfully");
    return { source: input.source, data };
  },
});

// ---------------------------------------------------------------------------
// actions.reset
// ---------------------------------------------------------------------------

registerCommand<{ source: string }, { ok: true; backupPath: string }>({
  id: "actions.reset",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.source !== "string" || !p.source) {
      throw new Error("actions.reset requires a non-empty 'source' string");
    }
    return { source: p.source };
  },
  async run(ctx: CommandContext, input) {
    ctx.log("info", `Resetting config "${input.source}" to empty object`);
    const { backupPath } = await writeConfig(input.source as ConfigSource, {});
    ctx.log("info", `Config reset, backup at ${backupPath}`);
    return { ok: true as const, backupPath };
  },
});

// ---------------------------------------------------------------------------
// actions.rollback
// ---------------------------------------------------------------------------

registerCommand<{ source: string }, { ok: true; restoredFrom: string }>({
  id: "actions.rollback",
  timeoutMs: 30_000,
  allowInUi: true,
  validateInput(payload: unknown) {
    const p = payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p.source !== "string" || !p.source) {
      throw new Error("actions.rollback requires a non-empty 'source' string");
    }
    return { source: p.source };
  },
  async run(ctx: CommandContext, input) {
    ctx.log("info", `Rolling back config "${input.source}" to latest backup`);
    const { restoredFrom } = await rollbackConfig(input.source as ConfigSource);
    ctx.log("info", `Config restored from ${restoredFrom}`);
    return { ok: true as const, restoredFrom };
  },
});
