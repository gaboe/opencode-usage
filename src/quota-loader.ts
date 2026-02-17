import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  QuotaSnapshot,
  MultiAccountState,
  MultiAccountThresholds,
  AntigravityAccountsFile,
} from "./types.js";

const isBun = typeof globalThis.Bun !== "undefined";

/**
 * Helper to read JSON file (dual runtime support)
 */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = isBun
      ? await Bun.file(filePath).text()
      : await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Load quota from anthropic-multi-account state file
 * Path: ~/.local/share/opencode/multi-account-state.json
 */
export async function loadMultiAccountQuota(): Promise<QuotaSnapshot[]> {
  const path = join(
    homedir(),
    ".local/share/opencode/multi-account-state.json"
  );
  const state = await readJsonFile<MultiAccountState>(path);

  if (!state?.usage) {
    return [
      {
        source: "anthropic",
        label: "Multi-Account",
        used: 0,
        error: "No data",
      },
    ];
  }

  const results: QuotaSnapshot[] = [];
  for (const [accountName, usage] of Object.entries(state.usage)) {
    const isActive = state.currentAccount === accountName;
    const prefix = isActive ? `${accountName} [ACTIVE]` : accountName;

    if (usage.session5h) {
      results.push({
        source: "anthropic",
        label: `${prefix} - Session 5h`,
        used: usage.session5h.utilization,
        resetAt: usage.session5h.reset,
      });
    }
    if (usage.weekly7d) {
      results.push({
        source: "anthropic",
        label: `${prefix} - Weekly`,
        used: usage.weekly7d.utilization,
        resetAt: usage.weekly7d.reset,
      });
    }
    if (usage.weekly7dSonnet) {
      results.push({
        source: "anthropic",
        label: `${prefix} - Sonnet`,
        used: usage.weekly7dSonnet.utilization,
        resetAt: usage.weekly7dSonnet.reset,
      });
    }
  }

  return results.length > 0
    ? results
    : [
        {
          source: "anthropic",
          label: "Multi-Account",
          used: 0,
          error: "No usage data",
        },
      ];
}

function normalizeThresholds(
  value:
    | number
    | { session5h?: number; weekly7d?: number; weekly7dSonnet?: number }
    | undefined
): MultiAccountThresholds {
  if (typeof value === "number") {
    return {
      session5h: value,
      weekly7d: value,
      weekly7dSonnet: value,
    };
  }

  if (typeof value === "object" && value !== null) {
    return {
      session5h: value.session5h ?? 0.7,
      weekly7d: value.weekly7d ?? 0.7,
      weekly7dSonnet: value.weekly7dSonnet ?? 0.7,
    };
  }

  return {
    session5h: 0.7,
    weekly7d: 0.7,
    weekly7dSonnet: 0.7,
  };
}

export async function loadMultiAccountThresholds(): Promise<MultiAccountThresholds | null> {
  const path = join(
    homedir(),
    ".local/share/opencode/multi-account-state.json"
  );
  const state = await readJsonFile<MultiAccountState>(path);
  if (!state) return null;

  return normalizeThresholds(state.config?.threshold);
}

/**
 * Load quota from antigravity accounts file
 * Path: ~/.config/opencode/antigravity-accounts.json
 * Note: remainingFraction is inverted (0 = exhausted, 1 = full)
 */
export async function loadAntigravityQuota(): Promise<QuotaSnapshot[]> {
  const path = join(homedir(), ".config/opencode/antigravity-accounts.json");
  const data = await readJsonFile<AntigravityAccountsFile>(path);

  if (!data?.accounts?.length) {
    return [
      {
        source: "antigravity",
        label: "Antigravity",
        used: 0,
        error: "No accounts",
      },
    ];
  }

  const results: QuotaSnapshot[] = [];

  for (const account of data.accounts) {
    if (account.disabled) continue;
    const quota = account.cachedQuota;
    if (!quota) continue;

    const label = account.email ?? "Account";

    if (quota.claude) {
      results.push({
        source: "antigravity",
        label: `${label} - Claude`,
        used: 1 - quota.claude.remainingFraction, // Invert: remaining -> used
        resetAt: quota.claude.resetTime
          ? Math.floor(Date.parse(quota.claude.resetTime) / 1000)
          : undefined,
      });
    }
    if (quota["gemini-pro"]) {
      results.push({
        source: "antigravity",
        label: `${label} - Gemini Pro`,
        used: 1 - quota["gemini-pro"].remainingFraction,
        resetAt: quota["gemini-pro"].resetTime
          ? Math.floor(Date.parse(quota["gemini-pro"].resetTime) / 1000)
          : undefined,
      });
    }
    if (quota["gemini-flash"]) {
      results.push({
        source: "antigravity",
        label: `${label} - Gemini Flash`,
        used: 1 - quota["gemini-flash"].remainingFraction,
        resetAt: quota["gemini-flash"].resetTime
          ? Math.floor(Date.parse(quota["gemini-flash"].resetTime) / 1000)
          : undefined,
      });
    }
  }

  return results.length > 0
    ? results
    : [
        {
          source: "antigravity",
          label: "Antigravity",
          used: 0,
          error: "No quota data",
        },
      ];
}
