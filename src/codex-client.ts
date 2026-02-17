import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { QuotaSnapshot, CodexUsageResponse } from "./types.js";

const isBun = typeof globalThis.Bun !== "undefined";

const CODEX_API_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");
const CODEX_MULTI_AUTH_DEFAULT_STORE_PATH = join(
  homedir(),
  ".config",
  "oc-codex-multi-account",
  "accounts.json"
);
const CODEX_MULTI_AUTH_LEGACY_STORE_PATH = join(
  homedir(),
  ".config",
  "opencode-multi-auth",
  "accounts.json"
);
const CODEX_MULTI_AUTH_STORE_FILE_ENV = "OPENCODE_MULTI_AUTH_STORE_FILE";
const CODEX_MULTI_AUTH_STORE_DIR_ENV = "OPENCODE_MULTI_AUTH_STORE_DIR";

type CodexAuthFile = {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  last_refresh?: string;
};

type CodexMultiAuthRateLimitWindow = {
  limit?: number;
  remaining?: number;
  resetAt?: number;
};

type CodexMultiAuthAccount = {
  email?: string;
  rateLimits?: {
    fiveHour?: CodexMultiAuthRateLimitWindow;
    weekly?: CodexMultiAuthRateLimitWindow;
  };
};

type CodexMultiAuthStore = {
  activeAlias?: string | null;
  accounts?: Record<string, CodexMultiAuthAccount>;
};

function getCodexMultiAuthStorePaths(): string[] {
  const explicitFile = process.env[CODEX_MULTI_AUTH_STORE_FILE_ENV]?.trim();
  if (explicitFile) return [explicitFile];

  const explicitDir = process.env[CODEX_MULTI_AUTH_STORE_DIR_ENV]?.trim();
  if (explicitDir) return [join(explicitDir, "accounts.json")];

  return [
    CODEX_MULTI_AUTH_DEFAULT_STORE_PATH,
    CODEX_MULTI_AUTH_LEGACY_STORE_PATH,
  ];
}

function windowToUsed(
  window: CodexMultiAuthRateLimitWindow | undefined
): number | undefined {
  if (!window) return undefined;
  if (
    typeof window.limit !== "number" ||
    typeof window.remaining !== "number"
  ) {
    return undefined;
  }
  if (!Number.isFinite(window.limit) || !Number.isFinite(window.remaining)) {
    return undefined;
  }
  if (window.limit <= 0) return undefined;

  return Math.min(
    1,
    Math.max(0, (window.limit - window.remaining) / window.limit)
  );
}

async function loadCodexMultiAuthQuota(): Promise<QuotaSnapshot[] | null> {
  for (const storePath of getCodexMultiAuthStorePaths()) {
    try {
      const content = isBun
        ? await Bun.file(storePath).text()
        : await readFile(storePath, "utf-8");
      const store = JSON.parse(content) as CodexMultiAuthStore;

      if (!store.accounts || Object.keys(store.accounts).length === 0) {
        continue;
      }

      const results: QuotaSnapshot[] = [];

      for (const [alias, account] of Object.entries(store.accounts)) {
        const isActive = store.activeAlias === alias;
        const accountPrefix = isActive ? `${alias} [ACTIVE]` : alias;
        let hasAnyLimit = false;

        const usedFiveHour = windowToUsed(account.rateLimits?.fiveHour);
        if (usedFiveHour !== undefined) {
          hasAnyLimit = true;
          results.push({
            source: "codex",
            label: `${accountPrefix} - 5h Limit`,
            used: usedFiveHour,
            resetAt:
              typeof account.rateLimits?.fiveHour?.resetAt === "number"
                ? Math.floor(account.rateLimits.fiveHour.resetAt / 1000)
                : undefined,
          });
        }

        const usedWeekly = windowToUsed(account.rateLimits?.weekly);
        if (usedWeekly !== undefined) {
          hasAnyLimit = true;
          results.push({
            source: "codex",
            label: `${accountPrefix} - Weekly`,
            used: usedWeekly,
            resetAt:
              typeof account.rateLimits?.weekly?.resetAt === "number"
                ? Math.floor(account.rateLimits.weekly.resetAt / 1000)
                : undefined,
          });
        }

        if (!hasAnyLimit) {
          results.push({
            source: "codex",
            label: accountPrefix,
            used: 0,
            error: "No limit data yet",
          });
        }
      }

      if (results.length > 0) {
        return results;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Read access token from ~/.codex/auth.json (created by `codex login`)
 */
async function readCodexAuthToken(): Promise<string | undefined> {
  try {
    const content = isBun
      ? await Bun.file(CODEX_AUTH_PATH).text()
      : await readFile(CODEX_AUTH_PATH, "utf-8");
    const auth = JSON.parse(content) as CodexAuthFile;

    // Prefer OPENAI_API_KEY if set, otherwise use OAuth access_token
    if (auth.OPENAI_API_KEY) {
      return auth.OPENAI_API_KEY;
    }
    return auth.tokens?.access_token ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Codex token: explicit override > ~/.codex/auth.json auto-read
 */
export async function resolveCodexToken(
  explicitToken?: string
): Promise<string | undefined> {
  if (explicitToken) return explicitToken;
  return readCodexAuthToken();
}

/**
 * Fetch Codex usage quota from ChatGPT API.
 * Auto-reads token from ~/.codex/auth.json if not provided explicitly.
 */
export async function loadCodexQuota(token?: string): Promise<QuotaSnapshot[]> {
  if (!token) {
    const multiAuthQuotas = await loadCodexMultiAuthQuota();
    if (multiAuthQuotas) return multiAuthQuotas;
  }

  const resolvedToken = await resolveCodexToken(token);

  if (!resolvedToken) {
    return [
      {
        source: "codex",
        label: "Codex",
        used: 0,
        error: "Not logged in. Run: codex login",
      },
    ];
  }

  try {
    const response = await fetch(CODEX_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const hint =
        response.status === 401 ? " (token expired? Run: codex login)" : "";
      return [
        {
          source: "codex",
          label: "Codex",
          used: 0,
          error: `API error: ${response.status}${hint}`,
        },
      ];
    }

    const data = (await response.json()) as CodexUsageResponse;
    const results: QuotaSnapshot[] = [];

    // Primary window = 5h limit
    if (data.rate_limit?.primary_window) {
      results.push({
        source: "codex",
        label: "Codex - 5h Limit",
        used: data.rate_limit.primary_window.used_percent / 100,
        resetAt: data.rate_limit.primary_window.reset_at,
      });
    }

    // Secondary window = weekly limit
    if (data.rate_limit?.secondary_window) {
      results.push({
        source: "codex",
        label: "Codex - Weekly",
        used: data.rate_limit.secondary_window.used_percent / 100,
        resetAt: data.rate_limit.secondary_window.reset_at,
      });
    }

    // Code review limit
    if (data.code_review_rate_limit?.primary_window) {
      results.push({
        source: "codex",
        label: "Codex - Code Review",
        used: data.code_review_rate_limit.primary_window.used_percent / 100,
        resetAt: data.code_review_rate_limit.primary_window.reset_at,
      });
    }

    return results.length > 0
      ? results
      : [
          {
            source: "codex",
            label: "Codex",
            used: 0,
            error: "No rate limit data",
          },
        ];
  } catch (err) {
    return [
      {
        source: "codex",
        label: "Codex",
        used: 0,
        error: `Request failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
    ];
  }
}
