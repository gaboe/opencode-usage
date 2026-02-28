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

// ---------------------------------------------------------------------------
// Direct Codex ping — avoids bunx overhead and uses local token state
// ---------------------------------------------------------------------------

type CodexPingResult = { status: "ok" | "expired" | "error"; error?: string };

/** Direct-ping a Codex account: read token from store, call OpenAI API. */
async function directCodexPing(alias: string): Promise<CodexPingResult> {
  console.log(`[directCodexPing] pinging "${alias}"…`);
  const STORE_PATHS = [
    join(homedir(), ".config", "opencode", "codex-multi-account-accounts.json"),
    join(homedir(), ".config", "opencode", "codex-multi-accounts.json"),
    join(homedir(), ".config", "oc-codex-multi-account", "accounts.json"),
  ];

  let store: Record<string, unknown> | null = null;
  for (const p of STORE_PATHS) {
    try {
      store = JSON.parse(await Bun.file(p).text()) as Record<string, unknown>;
      break;
    } catch {
      continue;
    }
  }
  if (!store) return { status: "error", error: "No codex store found" };

  console.log(
    `[directCodexPing] found account "${alias}", calling ChatGPT Codex API…`
  );

  const accounts = (store.accounts ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const account = accounts[alias];
  if (!account)
    return { status: "error", error: `Account "${alias}" not found` };

  const token = account.accessToken;
  const accountId = account.accountId;
  if (typeof token !== "string" || !token) {
    return { status: "error", error: "Missing access token" };
  }
  if (typeof accountId !== "string" || !accountId) {
    return { status: "error", error: "Missing accountId" };
  }

  // POST to ChatGPT Codex backend — Codex OAuth tokens don't work with api.openai.com
  try {
    const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "chatgpt-account-id": accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "reply ok",
        input: [{ type: "message", role: "user", content: "hi" }],
        store: false,
        stream: true,
      }),
    });

    // 200 = ok, 429 = rate-limited but token works
    if (res.ok || res.status === 429) {
      console.log(`[directCodexPing] "${alias}" → ok (HTTP ${res.status})`);
      return { status: "ok" };
    }
    if (res.status === 401 || res.status === 403) {
      console.log(
        `[directCodexPing] "${alias}" → expired (HTTP ${res.status})`
      );
      return { status: "expired", error: `HTTP ${res.status}` };
    }
    console.log(`[directCodexPing] "${alias}" → error (HTTP ${res.status})`);
    return { status: "error", error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Proactive Codex token refresh — keeps tokens fresh (once per 24h per account)
// ---------------------------------------------------------------------------

const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function getExpiryFromJwt(
  claims: Record<string, unknown> | null
): number | null {
  if (!claims || typeof claims.exp !== "number") return null;
  return claims.exp * 1000;
}

function getAccountIdFromJwt(
  claims: Record<string, unknown> | null
): string | null {
  const auth = claims?.["https://api.openai.com/auth"] as
    | Record<string, unknown>
    | undefined;
  return (auth?.chatgpt_account_id as string) ?? null;
}

async function refreshSingleCodexToken(
  alias: string,
  account: Record<string, unknown>,
  storePath: string,
  store: Record<string, unknown>
): Promise<boolean> {
  const refreshToken = account.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    console.log(`[proactiveRefresh] ${alias}: no refresh token, skipping`);
    return false;
  }

  try {
    const t0 = Date.now();
    const res = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CODEX_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      console.log(
        `[proactiveRefresh] ${alias}: refresh failed HTTP ${res.status} in ${Date.now() - t0}ms`
      );
      return false;
    }

    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in: number;
    };
    const accessClaims = decodeJwtPayload(tokens.access_token);
    const idClaims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
    const expiresAt =
      getExpiryFromJwt(accessClaims) ??
      getExpiryFromJwt(idClaims) ??
      Date.now() + tokens.expires_in * 1000;

    // Update account in-place
    account.accessToken = tokens.access_token;
    if (tokens.refresh_token) account.refreshToken = tokens.refresh_token;
    if (tokens.id_token) account.idToken = tokens.id_token;
    account.expiresAt = expiresAt;
    account.lastRefresh = new Date().toISOString();
    account.accountId =
      getAccountIdFromJwt(idClaims) ??
      getAccountIdFromJwt(accessClaims) ??
      account.accountId;
    account.authInvalid = false;

    // Write back to disk
    await Bun.write(storePath, JSON.stringify(store, null, 2));

    const daysLeft = ((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)).toFixed(
      1
    );
    console.log(
      `[proactiveRefresh] ${alias}: refreshed in ${Date.now() - t0}ms, new expiry in ${daysLeft}d`
    );
    return true;
  } catch (err) {
    console.log(
      `[proactiveRefresh] ${alias}: error — ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/**
 * Proactively refresh Codex tokens that haven't been refreshed in 24+ hours.
 * Keeps tokens fresh so they never silently expire.
 * Safe to call frequently — skips accounts refreshed recently.
 */
export async function proactiveRefreshCodexTokens(): Promise<void> {
  const STORE_PATHS = [
    join(homedir(), ".config", "opencode", "codex-multi-account-accounts.json"),
    join(homedir(), ".config", "opencode", "codex-multi-accounts.json"),
    join(homedir(), ".config", "oc-codex-multi-account", "accounts.json"),
  ];

  let storePath: string | null = null;
  let store: Record<string, unknown> | null = null;
  for (const p of STORE_PATHS) {
    try {
      store = JSON.parse(await Bun.file(p).text()) as Record<string, unknown>;
      storePath = p;
      break;
    } catch {
      continue;
    }
  }
  if (!store || !storePath) return;

  const accounts = (store.accounts ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const now = Date.now();
  let refreshed = 0;

  for (const [alias, account] of Object.entries(accounts)) {
    const expiresAt =
      typeof account.expiresAt === "number" ? account.expiresAt : 0;
    const lastRefresh =
      typeof account.lastRefresh === "string"
        ? new Date(account.lastRefresh).getTime()
        : 0;
    const timeSinceRefresh = now - lastRefresh;
    const timeToExpiry = expiresAt - now;

    // Already expired — needs reauth, not refresh
    if (timeToExpiry <= 0) {
      console.log(`[proactiveRefresh] ${alias}: token expired, needs reauth`);
      continue;
    }

    // Refreshed within last 24h — skip
    if (timeSinceRefresh < REFRESH_COOLDOWN_MS) {
      const hoursAgo = (timeSinceRefresh / (60 * 60 * 1000)).toFixed(1);
      console.log(
        `[proactiveRefresh] ${alias}: refreshed ${hoursAgo}h ago, skipping`
      );
      continue;
    }

    // Token still valid but stale (>24h since refresh) — refresh it
    const hoursStale = (timeSinceRefresh / (60 * 60 * 1000)).toFixed(1);
    console.log(
      `[proactiveRefresh] ${alias}: ${hoursStale}h since refresh, refreshing…`
    );
    const ok = await refreshSingleCodexToken(alias, account, storePath, store);
    if (ok) refreshed++;
  }

  if (refreshed > 0) {
    console.log(`[proactiveRefresh] refreshed ${refreshed} codex token(s)`);
  }
}
/** Read a credential file from ~/.config/opencode/ — NOT exposed via API. */
async function readCredentialFile(filename: string): Promise<unknown> {
  const filePath = join(homedir(), ".config", "opencode", filename);
  const text = await Bun.file(filePath).text();
  return JSON.parse(text);
}

/**
 * Serial queue for bunx calls per command — prevents EEXIST link races
 * when multiple calls for the same package run in parallel.
 */
const bunxQueue = new Map<string, Promise<unknown>>();

/** Spawn a plugin CLI command and parse JSON output from stdout. */
async function spawnPluginCli(
  command: string,
  args: string[],
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  // Check local project node_modules first, then ~/.config/opencode/node_modules/
  const candidates = [
    `./node_modules/${command}/dist/cli.js`,
    join(
      homedir(),
      ".config",
      "opencode",
      "node_modules",
      command,
      "dist",
      "cli.js"
    ),
  ];
  let localBin: string | null = null;
  for (const c of candidates) {
    if (await Bun.file(c).exists()) {
      localBin = c;
      break;
    }
  }
  const useLocal = localBin !== null;

  if (!useLocal) {
    // Chain onto existing queue so bunx calls for same command run one-at-a-time
    const prev = bunxQueue.get(command) ?? Promise.resolve();
    const run = prev
      .catch(() => {}) // don't chain rejections
      .then(() => runPluginCli(command, args, timeoutMs, null));
    bunxQueue.set(
      command,
      run.then(
        () => {},
        () => {}
      )
    );
    return run;
  }

  return runPluginCli(command, args, timeoutMs, localBin);
}

async function runPluginCli(
  command: string,
  args: string[],
  timeoutMs: number,
  localBin: string | null
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const cmd = localBin
    ? ["bun", localBin, ...args]
    : ["bunx", `${command}@latest`, ...args];

  // Each bunx call gets its own temp dir to avoid parallel EEXIST link races
  const cwd = localBin
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
        // 1) Direct ping — fast, no bunx overhead
        ctx.log("info", `Direct-pinging codex account "${input.alias}"…`);
        const direct = await directCodexPing(input.alias);
        ctx.log("info", `Direct ping result: ${direct.status}`);

        if (direct.status === "ok") {
          await clearStaleMetrics(input.provider, input.alias);
          // Fire proactive refresh for all codex accounts (background, non-blocking)
          proactiveRefreshCodexTokens().catch(() => {});
          return { status: "ok", message: "pong" };
        }

        // 2) If token expired, try plugin CLI (handles OAuth refresh)
        if (direct.status === "expired") {
          ctx.log("info", "Token expired — trying plugin CLI for refresh…");
          try {
            const result = await spawnPluginCli("oc-codex-multi-account", [
              "ping",
              input.alias,
            ]);
            const cliStatus = String(result.status ?? "error");
            ctx.log("info", `Plugin CLI result: ${cliStatus}`);
            if (cliStatus === "ok") {
              await clearStaleMetrics(input.provider, input.alias);
              return { status: "ok", message: "pong (token refreshed)" };
            }
            return {
              status: cliStatus,
              message: String(result.error ?? "Token refresh failed"),
            };
          } catch (cliErr) {
            ctx.log(
              "info",
              `Plugin CLI failed: ${cliErr instanceof Error ? cliErr.message : String(cliErr)}`
            );
            return {
              status: "error",
              message:
                direct.error ?? "Token expired and plugin refresh failed",
            };
          }
        }

        // 3) Other error (network, account not found, etc.)
        return {
          status: "error",
          message: direct.error ?? "unknown error",
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
