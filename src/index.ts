#!/usr/bin/env node
/**
 * OpenCode Usage - CLI tool for tracking OpenCode AI usage and costs
 *
 * Usage:
 *   bunx opencode-usage                    (dashboard, default)
 *   bunx opencode-usage --stats            (table mode)
 *   bunx opencode-usage --stats -d 30
 *   bunx opencode-usage --stats --monthly --json
 */

import { parseArgs } from "./cli.js";
import {
  getOpenCodeStoragePath,
  loadMessages,
  loadMessagesIncremental,
  createCursor,
} from "./loader.js";
import {
  aggregateByDate,
  aggregateByMonth,
  filterByDays,
  filterByDateRange,
} from "./aggregator.js";
import { renderTable, renderJson } from "./renderer.js";
import { runSolidDashboard } from "./dashboard-solid.js";
import type { CursorState, MessageJson } from "./types.js";
import { showConfig } from "./config-commands.js";

const WATCH_INTERVAL_MS = 5 * 60 * 1000;

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function homeThenClearBelow(): void {
  process.stdout.write("\x1b[H\x1b[J");
}

async function renderUsage(
  options: {
    storagePath: string;
    provider?: string;
    days?: number;
    since?: string;
    until?: string;
    json?: boolean;
    monthly?: boolean;
    watch?: boolean;
  },
  allMessages: MessageJson[]
): Promise<void> {
  const { provider, days, since, until, json, monthly, watch } = options;

  if (!json && !watch) {
    console.log(`\nLoading OpenCode usage data from: ${options.storagePath}`);
    if (provider) {
      console.log(`Filtering: ${provider} provider only`);
    }
    console.log(
      `Found ${allMessages.length} assistant messages with token data`
    );
  }

  let stats = aggregateByDate(allMessages);

  if (days) {
    stats = filterByDays(stats, days);
    if (!json && !watch) console.log(`Showing last ${days} days`);
  }

  if (since || until) {
    stats = filterByDateRange(stats, since, until);
    if (!json && !watch) {
      if (since && until) console.log(`Date range: ${since} to ${until}`);
      else if (since) console.log(`From: ${since}`);
      else if (until) console.log(`Until: ${until}`);
    }
  }

  if (monthly) {
    stats = aggregateByMonth(stats);
    if (!json && !watch) console.log(`Aggregated by month`);
  }

  if (json) {
    renderJson(stats);
  } else {
    renderTable(stats);
    if (watch) {
      const now = new Date().toLocaleTimeString();
      console.log(
        `[Watch mode] Last update: ${now} | Refreshing every ${WATCH_INTERVAL_MS / 60000}min | Ctrl+C to exit`
      );
    }
  }
}

async function main(): Promise<void> {
  const { provider, days, since, until, json, monthly, watch, stats, config } =
    parseArgs();

  if (config === "show") {
    await showConfig();
    return;
  }

  if (!stats) {
    await runSolidDashboard({
      refreshInterval: 300,
      providerFilter: provider,
      initialDays: days,
    });
    return;
  }

  const storagePath = getOpenCodeStoragePath();

  const options = {
    storagePath,
    provider,
    days,
    since,
    until,
    json,
    monthly,
    watch,
  };

  if (watch) {
    let cursor: CursorState = createCursor();
    let allMessages: MessageJson[] = [];

    const doRefresh = async () => {
      const result = await loadMessagesIncremental(
        storagePath,
        cursor,
        provider
      );
      cursor = result.cursor;
      allMessages = [...allMessages, ...result.messages];

      homeThenClearBelow();
      await renderUsage(options, allMessages);
    };

    clearScreen();
    await doRefresh();

    setInterval(doRefresh, WATCH_INTERVAL_MS);
  } else {
    const messages = await loadMessages(storagePath, provider);
    await renderUsage(options, messages);
  }
}

main().catch(console.error);
