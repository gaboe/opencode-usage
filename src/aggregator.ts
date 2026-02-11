/**
 * Data aggregation functions
 */

import type { DailyStats, MessageJson } from "./types.js";
import { calculateCost } from "./pricing";

function timestampToDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

export function aggregateByDate(
  messages: MessageJson[]
): Map<string, DailyStats> {
  const dailyStats = new Map<string, DailyStats>();

  for (const msg of messages) {
    const timestamp = msg.time?.created ?? msg.time?.completed;
    if (!timestamp) continue;

    const date = timestampToDate(timestamp);
    const modelId = msg.model?.modelID ?? msg.modelID ?? "unknown";
    const providerId = msg.model?.providerID ?? msg.providerID ?? "unknown";
    const tokens = msg.tokens!;
    const msgCost = calculateCost(tokens, modelId);

    let stats = dailyStats.get(date);
    if (!stats) {
      stats = {
        date,
        models: new Set(),
        providers: new Set(),
        providerStats: new Map(),
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 0,
      };
      dailyStats.set(date, stats);
    }

    // Update daily totals
    stats.models.add(modelId);
    stats.providers.add(providerId);
    stats.input += tokens.input ?? 0;
    stats.output += tokens.output ?? 0;
    stats.cacheWrite += tokens.cache?.write ?? 0;
    stats.cacheRead += tokens.cache?.read ?? 0;
    stats.reasoning += tokens.reasoning ?? 0;
    stats.cost += msgCost;

    // Update provider-specific stats
    let providerStat = stats.providerStats.get(providerId);
    if (!providerStat) {
      providerStat = {
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 0,
        models: new Set(),
      };
      stats.providerStats.set(providerId, providerStat);
    }
    providerStat.models.add(modelId);
    providerStat.input += tokens.input ?? 0;
    providerStat.output += tokens.output ?? 0;
    providerStat.cacheWrite += tokens.cache?.write ?? 0;
    providerStat.cacheRead += tokens.cache?.read ?? 0;
    providerStat.reasoning += tokens.reasoning ?? 0;
    providerStat.cost += msgCost;
  }

  return dailyStats;
}

export function filterByDays(
  dailyStats: Map<string, DailyStats>,
  days: number
): Map<string, DailyStats> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days + 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const filtered = new Map<string, DailyStats>();
  for (const [date, stats] of dailyStats) {
    if (date >= cutoffStr) {
      filtered.set(date, stats);
    }
  }
  return filtered;
}

export function filterByDateRange(
  dailyStats: Map<string, DailyStats>,
  since?: string,
  until?: string
): Map<string, DailyStats> {
  const filtered = new Map<string, DailyStats>();
  for (const [date, stats] of dailyStats) {
    if (since && date < since) continue;
    if (until && date > until) continue;
    filtered.set(date, stats);
  }
  return filtered;
}

function dateToMonth(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

export function aggregateByMonth(
  dailyStats: Map<string, DailyStats>
): Map<string, DailyStats> {
  const monthlyStats = new Map<string, DailyStats>();

  for (const [date, stats] of dailyStats) {
    const month = dateToMonth(date);

    let monthStats = monthlyStats.get(month);
    if (!monthStats) {
      monthStats = {
        date: month,
        models: new Set(),
        providers: new Set(),
        providerStats: new Map(),
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 0,
      };
      monthlyStats.set(month, monthStats);
    }

    // Merge models and providers
    for (const model of stats.models) monthStats.models.add(model);
    for (const provider of stats.providers) monthStats.providers.add(provider);

    // Sum totals
    monthStats.input += stats.input;
    monthStats.output += stats.output;
    monthStats.cacheWrite += stats.cacheWrite;
    monthStats.cacheRead += stats.cacheRead;
    monthStats.reasoning += stats.reasoning;
    monthStats.cost += stats.cost;

    // Merge provider stats
    for (const [providerId, providerStat] of stats.providerStats) {
      let monthProviderStat = monthStats.providerStats.get(providerId);
      if (!monthProviderStat) {
        monthProviderStat = {
          input: 0,
          output: 0,
          cacheWrite: 0,
          cacheRead: 0,
          reasoning: 0,
          cost: 0,
          models: new Set(),
        };
        monthStats.providerStats.set(providerId, monthProviderStat);
      }
      for (const model of providerStat.models)
        monthProviderStat.models.add(model);
      monthProviderStat.input += providerStat.input;
      monthProviderStat.output += providerStat.output;
      monthProviderStat.cacheWrite += providerStat.cacheWrite;
      monthProviderStat.cacheRead += providerStat.cacheRead;
      monthProviderStat.reasoning += providerStat.reasoning;
      monthProviderStat.cost += providerStat.cost;
    }
  }

  return monthlyStats;
}
