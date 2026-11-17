import { describe, test, expect } from "bun:test";
import {
  aggregateByDate,
  filterByDays,
  filterByDateRange,
  aggregateByMonth,
} from "../aggregator.js";
import type { MessageJson, DailyStats } from "../types.js";

function createMessage(
  modelId: string,
  providerId: string,
  timestamp: number,
  input: number = 1000,
  output: number = 500
): MessageJson {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    sessionID: "session-1",
    role: "assistant",
    model: {
      modelID: modelId,
      providerID: providerId,
    },
    tokens: {
      input,
      output,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: {
      created: timestamp,
      completed: timestamp,
    },
  };
}

function createDailyStats(
  date: string,
  models: string[] = [],
  providers: string[] = [],
  input: number = 0,
  output: number = 0,
  cost: number = 0
): DailyStats {
  return {
    date,
    models: new Set(models),
    providers: new Set(providers),
    providerStats: new Map(),
    input,
    output,
    cacheWrite: 0,
    cacheRead: 0,
    reasoning: 0,
    cost,
  };
}

describe("aggregator", () => {
  describe("aggregateByDate", () => {
    test("aggregates single message by date", () => {
      const timestamp = new Date("2025-12-15").getTime();
      const messages = [
        createMessage("claude-opus-4-5", "anthropic", timestamp),
      ];

      const result = aggregateByDate(messages);

      expect(result.size).toBe(1);
      expect(result.has("2025-12-15")).toBe(true);

      const stats = result.get("2025-12-15")!;
      expect(stats.input).toBe(1000);
      expect(stats.output).toBe(500);
      expect(stats.models.has("claude-opus-4-5")).toBe(true);
      expect(stats.providers.has("anthropic")).toBe(true);
    });

    test("aggregates multiple messages on same day", () => {
      const timestamp = new Date("2025-12-15").getTime();
      const messages = [
        createMessage("claude-opus-4-5", "anthropic", timestamp, 1000, 500),
        createMessage("claude-sonnet-4-5", "anthropic", timestamp, 2000, 1000),
      ];

      const result = aggregateByDate(messages);

      const stats = result.get("2025-12-15")!;
      expect(stats.input).toBe(3000);
      expect(stats.output).toBe(1500);
      expect(stats.models.size).toBe(2);
      expect(stats.providers.size).toBe(1);
    });

    test("separates messages by date", () => {
      const timestamp1 = new Date("2025-12-15").getTime();
      const timestamp2 = new Date("2025-12-16").getTime();
      const messages = [
        createMessage("claude-opus-4-5", "anthropic", timestamp1, 1000, 500),
        createMessage("claude-opus-4-5", "anthropic", timestamp2, 2000, 1000),
      ];

      const result = aggregateByDate(messages);

      expect(result.size).toBe(2);
      expect(result.get("2025-12-15")!.input).toBe(1000);
      expect(result.get("2025-12-16")!.input).toBe(2000);
    });

    test("aggregates by provider within a day", () => {
      const timestamp = new Date("2025-12-15").getTime();
      const messages = [
        createMessage("claude-opus-4-5", "anthropic", timestamp, 1000, 500),
        createMessage("gpt-4o", "openai", timestamp, 2000, 1000),
      ];

      const result = aggregateByDate(messages);

      const stats = result.get("2025-12-15")!;
      expect(stats.providerStats.size).toBe(2);
      expect(stats.providerStats.get("anthropic")!.input).toBe(1000);
      expect(stats.providerStats.get("openai")!.input).toBe(2000);
    });

    test("handles messages without timestamp", () => {
      const messages: MessageJson[] = [
        {
          id: "msg-1",
          sessionID: "session-1",
          role: "assistant",
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      ];

      const result = aggregateByDate(messages);
      expect(result.size).toBe(0);
    });

    test("calculates cost correctly during aggregation", () => {
      const timestamp = new Date("2025-12-15").getTime();
      const messages = [
        createMessage("claude-opus-4-5", "anthropic", timestamp, 1_000_000, 0),
      ];

      const result = aggregateByDate(messages);
      const stats = result.get("2025-12-15")!;

      expect(stats.cost).toBeGreaterThan(0);
      expect(stats.cost).toBeLessThan(10);
    });
  });

  describe("filterByDays", () => {
    test("filters to last N days", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const todayStr = today.toISOString().split("T")[0];
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

      const dailyStats = new Map<string, DailyStats>([
        [todayStr, createDailyStats(todayStr)],
        [yesterdayStr, createDailyStats(yesterdayStr)],
        [twoDaysAgoStr, createDailyStats(twoDaysAgoStr)],
      ]);

      const result = filterByDays(dailyStats, 0);

      expect(result.size).toBe(1);
      expect(result.has(todayStr)).toBe(true);
    });

    test("includes boundary date for 1 day filter", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const todayStr = today.toISOString().split("T")[0];
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const dailyStats = new Map<string, DailyStats>([
        [todayStr, createDailyStats(todayStr)],
        [yesterdayStr, createDailyStats(yesterdayStr)],
      ]);

      const result = filterByDays(dailyStats, 1);

      expect(result.size).toBeGreaterThanOrEqual(1);
      expect(result.has(todayStr)).toBe(true);
    });

    test("last N days includes today and excludes older dates", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const todayStr = today.toISOString().split("T")[0];
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const threeDaysAgoStr = threeDaysAgo.toISOString().split("T")[0];

      const dailyStats = new Map<string, DailyStats>([
        [todayStr, createDailyStats(todayStr)],
        [yesterdayStr, createDailyStats(yesterdayStr)],
        [threeDaysAgoStr, createDailyStats(threeDaysAgoStr)],
      ]);

      const result = filterByDays(dailyStats, 2);

      expect(result.size).toBe(2);
      expect(result.has(todayStr)).toBe(true);
      expect(result.has(yesterdayStr)).toBe(true);
      expect(result.has(threeDaysAgoStr)).toBe(false);
    });
  });

  describe("filterByDateRange", () => {
    test("filters by since date", () => {
      const dailyStats = new Map<string, DailyStats>([
        ["2025-12-10", createDailyStats("2025-12-10")],
        ["2025-12-15", createDailyStats("2025-12-15")],
      ]);

      const result = filterByDateRange(dailyStats, "2025-12-12");

      expect(result.size).toBe(1);
      expect(result.has("2025-12-15")).toBe(true);
    });

    test("filters by until date", () => {
      const dailyStats = new Map<string, DailyStats>([
        ["2025-12-10", createDailyStats("2025-12-10")],
        ["2025-12-15", createDailyStats("2025-12-15")],
      ]);

      const result = filterByDateRange(dailyStats, undefined, "2025-12-12");

      expect(result.size).toBe(1);
      expect(result.has("2025-12-10")).toBe(true);
    });

    test("filters by both since and until", () => {
      const dailyStats = new Map<string, DailyStats>([
        ["2025-12-10", createDailyStats("2025-12-10")],
        ["2025-12-15", createDailyStats("2025-12-15")],
        ["2025-12-20", createDailyStats("2025-12-20")],
      ]);

      const result = filterByDateRange(dailyStats, "2025-12-12", "2025-12-18");

      expect(result.size).toBe(1);
      expect(result.has("2025-12-15")).toBe(true);
    });
  });

  describe("aggregateByMonth", () => {
    test("groups daily stats by month", () => {
      const stats1 = createDailyStats(
        "2025-12-10",
        ["claude-opus-4-5"],
        ["anthropic"],
        1000,
        500,
        5
      );
      stats1.providerStats.set("anthropic", {
        input: 1000,
        output: 500,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 5,
        models: new Set(["claude-opus-4-5"]),
      });

      const stats2 = createDailyStats(
        "2025-12-15",
        ["claude-opus-4-5"],
        ["anthropic"],
        2000,
        1000,
        10
      );
      stats2.providerStats.set("anthropic", {
        input: 2000,
        output: 1000,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 10,
        models: new Set(["claude-opus-4-5"]),
      });

      const dailyStats = new Map<string, DailyStats>([
        ["2025-12-10", stats1],
        ["2025-12-15", stats2],
      ]);

      const result = aggregateByMonth(dailyStats);

      expect(result.size).toBe(1);
      expect(result.has("2025-12")).toBe(true);

      const monthStats = result.get("2025-12")!;
      expect(monthStats.input).toBe(3000);
      expect(monthStats.output).toBe(1500);
      expect(monthStats.cost).toBe(15);
    });

    test("separates different months", () => {
      const stats1 = createDailyStats(
        "2025-11-30",
        ["claude-opus-4-5"],
        ["anthropic"],
        1000,
        500,
        5
      );
      stats1.providerStats.set("anthropic", {
        input: 1000,
        output: 500,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 5,
        models: new Set(["claude-opus-4-5"]),
      });

      const stats2 = createDailyStats(
        "2025-12-01",
        ["claude-opus-4-5"],
        ["anthropic"],
        2000,
        1000,
        10
      );
      stats2.providerStats.set("anthropic", {
        input: 2000,
        output: 1000,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 10,
        models: new Set(["claude-opus-4-5"]),
      });

      const dailyStats = new Map<string, DailyStats>([
        ["2025-11-30", stats1],
        ["2025-12-01", stats2],
      ]);

      const result = aggregateByMonth(dailyStats);

      expect(result.size).toBe(2);
      expect(result.has("2025-11")).toBe(true);
      expect(result.has("2025-12")).toBe(true);
    });

    test("merges provider stats across days", () => {
      const stats1 = createDailyStats(
        "2025-12-10",
        ["claude-opus-4-5"],
        ["anthropic"],
        1000,
        500,
        5
      );
      stats1.providerStats.set("anthropic", {
        input: 1000,
        output: 500,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 5,
        models: new Set(["claude-opus-4-5"]),
      });

      const stats2 = createDailyStats(
        "2025-12-15",
        ["gpt-4o"],
        ["openai"],
        2000,
        1000,
        10
      );
      stats2.providerStats.set("openai", {
        input: 2000,
        output: 1000,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: 0,
        cost: 10,
        models: new Set(["gpt-4o"]),
      });

      const dailyStats = new Map<string, DailyStats>([
        ["2025-12-10", stats1],
        ["2025-12-15", stats2],
      ]);

      const result = aggregateByMonth(dailyStats);

      const monthStats = result.get("2025-12")!;
      expect(monthStats.providerStats.size).toBe(2);
      expect(monthStats.providerStats.get("anthropic")!.input).toBe(1000);
      expect(monthStats.providerStats.get("openai")!.input).toBe(2000);
    });
  });
});
