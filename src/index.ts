#!/usr/bin/env node
/**
 * OpenCode Usage - CLI tool for tracking OpenCode AI usage and costs
 *
 * Usage:
 *   bunx opencode-usage
 *   bunx opencode-usage --provider anthropic
 *   bunx opencode-usage --days 30
 */

import { parseArgs } from "./cli.js";
import { getOpenCodeStoragePath, loadMessages } from "./loader.js";
import { aggregateByDate, filterByDays } from "./aggregator.js";
import { renderTable } from "./renderer.js";

async function main(): Promise<void> {
  const { provider, days } = parseArgs();
  const storagePath = getOpenCodeStoragePath();

  console.log(`\nLoading OpenCode usage data from: ${storagePath}`);
  if (provider) {
    console.log(`Filtering: ${provider} provider only`);
  }

  const messages = await loadMessages(storagePath, provider);
  console.log(`Found ${messages.length} assistant messages with token data`);

  let dailyStats = aggregateByDate(messages);

  if (days) {
    dailyStats = filterByDays(dailyStats, days);
    console.log(`Showing last ${days} days`);
  }

  renderTable(dailyStats);
}

main().catch(console.error);
