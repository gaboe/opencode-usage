import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { QuotaSnapshot, CodexUsageResponse } from "./types.js";

const isBun = typeof globalThis.Bun !== "undefined";

const CODEX_API_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");

type CodexAuthFile = {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  last_refresh?: string;
};

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
