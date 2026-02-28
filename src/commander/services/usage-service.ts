/**
 * Usage data service — thin wrapper over loader + aggregator for the Commander API.
 */

import { loadMessages, getOpenCodeStoragePath } from "../../loader.js";
import {
  aggregateByDate,
  aggregateByMonth,
  filterByDays,
  filterByDateRange,
} from "../../aggregator.js";
import type { DailyStats, ProviderStats } from "../../types.js";

export type UsageQueryOpts = {
  provider?: string;
  days?: number;
  since?: string;
  until?: string;
  monthly?: boolean;
};

export type SerializedProviderStats = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
  models: string[];
};

export type SerializedDailyStats = {
  date: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
  models: string[];
  providers: string[];
  providerStats: Record<string, SerializedProviderStats>;
};

function serializeProviderStats(ps: ProviderStats): SerializedProviderStats {
  return {
    input: ps.input,
    output: ps.output,
    cacheWrite: ps.cacheWrite,
    cacheRead: ps.cacheRead,
    reasoning: ps.reasoning,
    cost: ps.cost,
    models: [...ps.models],
  };
}

function serializeDailyStats(stats: DailyStats): SerializedDailyStats {
  const providerStats: Record<string, SerializedProviderStats> = {};
  for (const [id, ps] of stats.providerStats) {
    providerStats[id] = serializeProviderStats(ps);
  }

  return {
    date: stats.date,
    input: stats.input,
    output: stats.output,
    cacheWrite: stats.cacheWrite,
    cacheRead: stats.cacheRead,
    reasoning: stats.reasoning,
    cost: stats.cost,
    models: [...stats.models],
    providers: [...stats.providers],
    providerStats,
  };
}

export async function getUsageData(
  opts: UsageQueryOpts = {}
): Promise<SerializedDailyStats[]> {
  const storagePath = getOpenCodeStoragePath();
  const messages = await loadMessages(storagePath, opts.provider);
  let stats = aggregateByDate(messages);

  if (opts.days !== undefined) {
    stats = filterByDays(stats, opts.days);
  }

  if (opts.since !== undefined || opts.until !== undefined) {
    stats = filterByDateRange(stats, opts.since, opts.until);
  }

  if (opts.monthly) {
    stats = aggregateByMonth(stats);
  }

  const result: SerializedDailyStats[] = [];
  for (const [, entry] of stats) {
    result.push(serializeDailyStats(entry));
  }

  return result;
}
