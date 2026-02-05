#!/usr/bin/env node
/**
 * OpenCode Usage - CLI tool for tracking OpenCode AI usage and costs
 *
 * Usage:
 *   bunx opencode-usage
 *   bunx opencode-usage --provider anthropic
 *   bunx opencode-usage --days 30
 *   bunx opencode-usage --since 20251201 --until 20251231
 *   bunx opencode-usage --monthly --json
 *   bunx opencode-usage --watch
 */

import { parseArgs } from "./cli.js";
import { getOpenCodeStoragePath, loadMessages } from "./loader.js";
import {
  aggregateByDate,
  aggregateByMonth,
  filterByDays,
  filterByDateRange,
} from "./aggregator.js";
import { renderTable, renderJson } from "./renderer.js";

const WATCH_INTERVAL_MS = 5 * 60 * 1000;

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function homeThenClearBelow(): void {
  process.stdout.write("\x1b[H\x1b[J");
}

async function renderUsage(options: {
  storagePath: string;
  provider?: string;
  days?: number;
  since?: string;
  until?: string;
  json?: boolean;
  monthly?: boolean;
  watch?: boolean;
}): Promise<void> {
  const { storagePath, provider, days, since, until, json, monthly, watch } =
    options;

  if (!json) {
    console.log(`\nLoading OpenCode usage data from: ${storagePath}`);
    if (provider) {
      console.log(`Filtering: ${provider} provider only`);
    }
  }

  const messages = await loadMessages(storagePath, provider);

  if (!json) {
    console.log(`Found ${messages.length} assistant messages with token data`);
  }

  let stats = aggregateByDate(messages);

  // Apply date filters
  if (days) {
    stats = filterByDays(stats, days);
    if (!json) console.log(`Showing last ${days} days`);
  }

  if (since || until) {
    stats = filterByDateRange(stats, since, until);
    if (!json) {
      if (since && until) console.log(`Date range: ${since} to ${until}`);
      else if (since) console.log(`From: ${since}`);
      else if (until) console.log(`Until: ${until}`);
    }
  }

  // Aggregate by month if requested
  if (monthly) {
    stats = aggregateByMonth(stats);
    if (!json) console.log(`Aggregated by month`);
  }

  // Render output
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
  const { provider, days, since, until, json, monthly, watch } = parseArgs();
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
    clearScreen();
    await renderUsage(options);

    setInterval(async () => {
      homeThenClearBelow();
      await renderUsage(options);
    }, WATCH_INTERVAL_MS);
  } else {
    await renderUsage(options);
  }
}

main().catch(console.error);
