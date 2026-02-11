/**
 * Type definitions for OpenCode usage stats
 */

export type TokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
};

export type MessageJson = {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  model?: {
    providerID: string;
    modelID: string;
  };
  modelID?: string;
  providerID?: string;
  tokens?: TokenUsage;
  cost?: number;
  time?: {
    created?: number;
    completed?: number;
  };
};

export type ProviderStats = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
  models: Set<string>;
};

export type DailyStats = {
  date: string;
  models: Set<string>;
  providers: Set<string>;
  providerStats: Map<string, ProviderStats>;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
};

export type ModelPricing = {
  input: number; // per million tokens
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

// ============================================================================
// Quota Types (for dashboard multi-source view)
// ============================================================================

/** Unified quota snapshot for display */
export type QuotaSnapshot = {
  source: "anthropic" | "antigravity" | "codex";
  label: string;
  used: number; // 0-1 (percentage used)
  resetAt?: number; // Unix timestamp
  error?: string; // Error message if unavailable
};

/** Cursor state for incremental message loading */
export type CursorState = {
  knownSessions: Set<string>;
  fileCountPerSession: Map<string, number>;
  lastTimestamp: number;
};

/** Anthropic multi-account state file structure */
export type MultiAccountState = {
  currentAccount?: string;
  requestCount?: number;
  usage?: Record<
    string,
    {
      session5h?: { utilization: number; reset: number; status?: string };
      weekly7d?: { utilization: number; reset: number; status?: string };
      weekly7dSonnet?: { utilization: number; reset: number; status?: string };
      timestamp?: string;
    }
  >;
};

/** Antigravity quota group */
export type AntigravityQuotaGroup = {
  remainingFraction: number; // 0-1 (remaining, needs inversion for "used")
  resetTime?: string; // ISO date string
};

/** Antigravity accounts file structure */
export type AntigravityAccount = {
  email?: string;
  disabled?: boolean;
  cachedQuota?: {
    claude?: AntigravityQuotaGroup;
    "gemini-pro"?: AntigravityQuotaGroup;
    "gemini-flash"?: AntigravityQuotaGroup;
  };
  cachedQuotaUpdatedAt?: number;
};

export type AntigravityAccountsFile = {
  accounts: AntigravityAccount[];
};

/** Codex API response structure */
export type CodexUsageResponse = {
  user_id?: string;
  account_id?: string;
  plan_type?: string;
  rate_limit?: {
    primary_window?: {
      used_percent: number;
      reset_at: number;
    };
    secondary_window?: {
      used_percent: number;
      reset_at: number;
    };
  };
  code_review_rate_limit?: {
    primary_window?: {
      used_percent: number;
      reset_at: number;
    };
  };
};
