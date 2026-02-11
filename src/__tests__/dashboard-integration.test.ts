import { describe, expect, test } from "bun:test";
import { renderUsageTable } from "../dashboard/usage-table.js";
import { renderQuotaPanel } from "../dashboard/quota-panel.js";
import { renderStatusBar } from "../dashboard/status-bar.js";
import { aggregateByDate } from "../aggregator.js";
import type { MessageJson, QuotaSnapshot } from "../types.js";

describe("dashboard-integration", () => {
  test("full dashboard render with real-like data", () => {
    const mockMessages: MessageJson[] = [
      {
        id: "msg1",
        sessionID: "sess1",
        role: "assistant",
        model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
        tokens: {
          input: 100000,
          output: 50000,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Math.floor(Date.now() / 1000) - 86400 },
      },
      {
        id: "msg2",
        sessionID: "sess1",
        role: "assistant",
        model: { providerID: "openai", modelID: "gpt-4o" },
        tokens: {
          input: 50000,
          output: 25000,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Math.floor(Date.now() / 1000) },
      },
    ];

    const dailyStats = aggregateByDate(mockMessages);
    const usageTable = renderUsageTable(dailyStats, 80);

    expect(usageTable).toContain("Date");
    expect(usageTable).toContain("Cost");
    expect(usageTable).toContain("Total");
    expect(dailyStats.size).toBeGreaterThan(0);
  });

  test("quota panel with mixed success and error states", () => {
    const quotas: QuotaSnapshot[] = [
      {
        source: "anthropic",
        label: "5h session",
        used: 0.45,
        resetAt: Date.now() + 2 * 3600 * 1000,
      },
      {
        source: "anthropic",
        label: "7d weekly",
        used: 0.78,
        resetAt: Date.now() + 48 * 3600 * 1000,
      },
      {
        source: "codex",
        label: "Weekly limit",
        used: 0,
        error: "Token invalid",
      },
      {
        source: "antigravity",
        label: "Claude",
        used: 0.12,
      },
    ];

    const panel = renderQuotaPanel(quotas, 80);

    expect(panel).toContain("ANTHROPIC");
    expect(panel).toContain("CODEX");
    expect(panel).toContain("ANTIGRAVITY");
    expect(panel).toContain("5h session");
    expect(panel).toContain("45%");
    expect(panel).toContain("78%");
    expect(panel).toContain("Token invalid");
    expect(panel).toContain("12%");
    expect(panel).toContain("resets in");
  });

  test("side-by-side layout simulation", () => {
    const mockMessages: MessageJson[] = [
      {
        id: "msg1",
        sessionID: "sess1",
        role: "assistant",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        tokens: {
          input: 10000,
          output: 5000,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Math.floor(Date.now() / 1000) },
      },
    ];

    const dailyStats = aggregateByDate(mockMessages);
    const quotas: QuotaSnapshot[] = [
      { source: "anthropic", label: "Test", used: 0.5 },
    ];

    const usageTable = renderUsageTable(dailyStats, 80);
    const quotaPanel = renderQuotaPanel(quotas, 80);
    const statusBar = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 300 },
      168
    );

    const usageLines = usageTable.split("\n");
    const quotaLines = quotaPanel.split("\n");

    expect(usageLines.length).toBeGreaterThan(0);
    expect(quotaLines.length).toBeGreaterThan(0);
    expect(statusBar.length).toBeGreaterThan(0);

    expect(statusBar).toContain("Last update:");
    expect(statusBar).toContain("Refresh: 300s");
    expect(statusBar).toContain("Ctrl+C: exit");
  });

  test("stacked layout simulation (narrow terminal)", () => {
    const mockMessages: MessageJson[] = [
      {
        id: "msg1",
        sessionID: "sess1",
        role: "assistant",
        model: { providerID: "openai", modelID: "gpt-5" },
        tokens: {
          input: 5000,
          output: 2500,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Math.floor(Date.now() / 1000) },
      },
    ];

    const dailyStats = aggregateByDate(mockMessages);
    const quotas: QuotaSnapshot[] = [
      { source: "codex", label: "5h", used: 0.25 },
    ];

    const usageTable = renderUsageTable(dailyStats, 100);
    const quotaPanel = renderQuotaPanel(quotas, 100);
    const statusBar = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 60 },
      100
    );

    expect(usageTable).toBeTruthy();
    expect(quotaPanel).toBeTruthy();
    expect(statusBar).toBeTruthy();

    expect(usageTable).not.toContain("Models");
    expect(quotaPanel).toContain("25%");
  });

  test("responsive width tiers work correctly", () => {
    const mockMessages: MessageJson[] = [
      {
        id: "msg1",
        sessionID: "sess1",
        role: "assistant",
        model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: { created: Math.floor(Date.now() / 1000) },
      },
    ];

    const dailyStats = aggregateByDate(mockMessages);

    const narrow = renderUsageTable(dailyStats, 90);
    const medium = renderUsageTable(dailyStats, 120);
    const wide = renderUsageTable(dailyStats, 180);

    expect(narrow).not.toContain("Models");
    expect(narrow).not.toContain("Tokens");
    expect(narrow).toContain("Cost");

    expect(medium).not.toContain("Models");
    expect(medium).toContain("Tokens");
    expect(medium).toContain("Cost");

    expect(wide).toContain("Models");
    expect(wide).toContain("Tokens");
    expect(wide).toContain("Cost");
  });
});
