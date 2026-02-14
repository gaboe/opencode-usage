/**
 * Dashboard orchestrator - unified multi-source usage view
 */

import { aggregateByDate, filterByDays } from "./aggregator.js";
import type {
  CursorState,
  MessageJson,
  QuotaSnapshot,
  DailyStats,
} from "./types.js";
import {
  loadMessagesIncremental,
  createCursor,
  getOpenCodeStoragePath,
  loadMessages,
} from "./loader.js";
import { loadMultiAccountQuota, loadAntigravityQuota } from "./quota-loader.js";
import { loadCodexQuota } from "./codex-client.js";
import { renderUsageTable } from "./dashboard/usage-table.js";
import { renderQuotaPanel } from "./dashboard/quota-panel.js";
import { renderStatusBar } from "./dashboard/status-bar.js";
import { stdin } from "node:process";

export type DashboardOptions = {
  refreshInterval?: number;
  providerFilter?: string;
  daysFilter?: number;
};

async function fetchAllQuotas(): Promise<QuotaSnapshot[]> {
  const [multiAccount, antigravity, codex] = await Promise.allSettled([
    loadMultiAccountQuota(),
    loadAntigravityQuota(),
    loadCodexQuota(),
  ]);

  const quotas: QuotaSnapshot[] = [];

  quotas.push(
    ...(multiAccount.status === "fulfilled"
      ? multiAccount.value
      : [
          {
            source: "anthropic" as const,
            label: "Multi-Account",
            used: 0,
            error: `Load error: ${multiAccount.reason}`,
          },
        ])
  );

  quotas.push(
    ...(antigravity.status === "fulfilled"
      ? antigravity.value
      : [
          {
            source: "antigravity" as const,
            label: "Antigravity",
            used: 0,
            error: `Load error: ${antigravity.reason}`,
          },
        ])
  );

  quotas.push(
    ...(codex.status === "fulfilled"
      ? codex.value
      : [
          {
            source: "codex" as const,
            label: "Codex",
            used: 0,
            error: `Load error: ${codex.reason}`,
          },
        ])
  );

  return quotas;
}

function getTerminalSize(): { width: number; height: number } {
  if (typeof process !== "undefined" && process.stdout) {
    return {
      width: process.stdout.columns ?? 80,
      height: process.stdout.rows ?? 24,
    };
  }
  return { width: 80, height: 24 };
}

function clearScreen(): void {
  if (typeof process !== "undefined" && process.stdout) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
}

function filterMessages(
  messages: MessageJson[],
  providerFilter?: string
): MessageJson[] {
  let filtered = messages;

  if (providerFilter) {
    filtered = filtered.filter(
      (msg) =>
        msg.model?.providerID === providerFilter ||
        msg.providerID === providerFilter
    );
  }

  return filtered;
}

export async function runDashboard(options: DashboardOptions): Promise<void> {
  const refreshInterval = options.refreshInterval ?? 300;
  let cursor: CursorState = createCursor();
  let allMessages: MessageJson[] = [];
  let cachedAggregatedStats: Map<string, DailyStats> = new Map();
  let isFirstRender = true;
  let currentDaysFilter = options.daysFilter ?? 30;
  let needsReaggregate = true;

  const render = async () => {
    const { width } = getTerminalSize();
    const storagePath = getOpenCodeStoragePath();

    if (isFirstRender) {
      allMessages = await loadMessages(storagePath, options.providerFilter);
      needsReaggregate = true;
      isFirstRender = false;
    } else {
      const result = await loadMessagesIncremental(
        storagePath,
        cursor,
        options.providerFilter
      );
      cursor = result.cursor;
      if (result.messages.length > 0) {
        allMessages = [...allMessages, ...result.messages];
        needsReaggregate = true;
      }
    }

    if (needsReaggregate) {
      const filtered = filterMessages(allMessages, options.providerFilter);
      cachedAggregatedStats = aggregateByDate(filtered);
      needsReaggregate = false;
    }

    let dailyStats = cachedAggregatedStats;
    if (currentDaysFilter > 0) {
      dailyStats = filterByDays(cachedAggregatedStats, currentDaysFilter);
    }

    const quotas = await fetchAllQuotas();

    const responsiveBreakpoint = 168;
    const sideBySide = width >= responsiveBreakpoint;

    const usageTable = renderUsageTable(
      dailyStats,
      sideBySide ? Math.floor(width / 2) - 2 : width - 4
    );
    const quotaPanel = renderQuotaPanel(
      quotas,
      sideBySide ? Math.floor(width / 2) - 2 : width - 4
    );
    const statusBar = renderStatusBar(
      {
        lastUpdate: Date.now(),
        refreshInterval,
        daysFilter: currentDaysFilter,
      },
      width
    );

    clearScreen();

    if (sideBySide) {
      const usageLines = usageTable.split("\n");
      const quotaLines = quotaPanel.split("\n");
      const maxLines = Math.max(usageLines.length, quotaLines.length);

      for (let i = 0; i < maxLines; i++) {
        const left = usageLines[i] ?? "";
        const right = quotaLines[i] ?? "";
        const leftWidth = Math.floor(width / 2) - 2;
        const paddedLeft = left.padEnd(leftWidth);
        console.log(`${paddedLeft}  ${right}`);
      }
    } else {
      console.log(usageTable);
      console.log("");
      console.log(quotaPanel);
    }

    console.log("");
    console.log(statusBar);
  };

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    stdin.on("data", async (key: string) => {
      if (key === "\u0003") {
        clearInterval(intervalId);
        clearScreen();
        process.exit(0);
      }

      if (key === "t") {
        currentDaysFilter = 1;
        await render();
      }

      if (key === "w") {
        currentDaysFilter = 7;
        await render();
      }

      if (key === "m") {
        currentDaysFilter = 30;
        await render();
      }

      if (key === "a") {
        currentDaysFilter = 0;
        await render();
      }
    });
  }

  await render();

  const intervalId = setInterval(async () => {
    await render();
  }, refreshInterval * 1000);

  process.on("SIGINT", () => {
    clearInterval(intervalId);
    clearScreen();
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    process.exit(0);
  });
}
