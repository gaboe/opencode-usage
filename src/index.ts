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

async function main(): Promise<void> {
  const { provider, days, since, until, json, monthly } = parseArgs();
  const storagePath = getOpenCodeStoragePath();

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
  }
}

main().catch(console.error);
