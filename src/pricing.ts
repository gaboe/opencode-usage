/**
 * Model pricing configuration (per million tokens)
 */

import type { ModelPricing, TokenUsage } from "./types";

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic - Current Models
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-sonnet-4": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-3": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-haiku-3": {
    input: 0.25,
    output: 1.25,
    cacheWrite: 0.3,
    cacheRead: 0.03,
  },

  // OpenAI Models
  "gpt-4o": {
    input: 2.5,
    output: 10,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gpt-4-turbo": {
    input: 10,
    output: 30,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gpt-5": {
    input: 5,
    output: 15,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gpt-5.2": {
    input: 5,
    output: 15,
    cacheWrite: 0,
    cacheRead: 0,
  },
  o1: {
    input: 15,
    output: 60,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "o1-mini": {
    input: 3,
    output: 12,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "o1-pro": {
    input: 150,
    output: 600,
    cacheWrite: 0,
    cacheRead: 0,
  },
  o3: {
    input: 10,
    output: 40,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "o3-mini": {
    input: 1.1,
    output: 4.4,
    cacheWrite: 0,
    cacheRead: 0,
  },

  // Google Models
  "gemini-2.0-flash": {
    input: 0.1,
    output: 0.4,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gemini-2.5-flash": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "gemini-3-flash-preview": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0,
    cacheRead: 0,
  },

  // Free/OpenCode hosted models
  "qwen3-coder": {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "glm-4.7-free": {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  },
  "minimax-m2.1-free": {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
};

export function getModelPricing(modelId: string): ModelPricing {
  const normalized = modelId.toLowerCase().replace(/_/g, "-");

  if (MODEL_PRICING[normalized]) {
    return MODEL_PRICING[normalized];
  }

  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return pricing;
    }
  }

  return DEFAULT_PRICING;
}

export function calculateCost(tokens: TokenUsage, modelId: string): number {
  const pricing = getModelPricing(modelId);

  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  const cacheWriteCost = (tokens.cache.write / 1_000_000) * pricing.cacheWrite;
  const cacheReadCost = (tokens.cache.read / 1_000_000) * pricing.cacheRead;
  const reasoningCost = (tokens.reasoning / 1_000_000) * pricing.output;

  return (
    inputCost + outputCost + cacheWriteCost + cacheReadCost + reasoningCost
  );
}
