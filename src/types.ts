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
