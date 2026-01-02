/**
 * CLI argument parser using Node.js parseArgs (works with both Bun and Node.js)
 */

import { parseArgs as nodeParseArgs } from "node:util";

export type CliArgs = {
  provider?: string;
  days?: number;
  since?: string;
  until?: string;
  json?: boolean;
  monthly?: boolean;
};

// Get CLI args - works with both Bun and Node.js
function getArgs(): string[] {
  if (typeof globalThis.Bun !== "undefined") {
    return Bun.argv.slice(2);
  }
  return process.argv.slice(2);
}

/**
 * Parse date string in formats: YYYYMMDD, YYYY-MM-DD, or relative like "7d", "1w", "1m"
 */
function parseDate(value: string): string | undefined {
  if (!value) return undefined;

  // Relative date: 7d, 1w, 1m
  const relativeMatch = value.match(/^(\d+)([dwm])$/);
  if (relativeMatch) {
    const num = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const date = new Date();
    if (unit === "d") date.setDate(date.getDate() - num);
    else if (unit === "w") date.setDate(date.getDate() - num * 7);
    else if (unit === "m") date.setMonth(date.getMonth() - num);
    return date.toISOString().split("T")[0];
  }

  // YYYYMMDD format
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  console.error(
    `Invalid date format: ${value}. Use YYYYMMDD, YYYY-MM-DD, or relative (7d, 1w, 1m)`
  );
  process.exit(1);
}

export function parseArgs(): CliArgs {
  try {
    const { values } = nodeParseArgs({
      args: getArgs(),
      options: {
        provider: { type: "string", short: "p" },
        days: { type: "string", short: "d" },
        since: { type: "string", short: "s" },
        until: { type: "string", short: "u" },
        json: { type: "boolean", short: "j" },
        monthly: { type: "boolean", short: "m" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    });

    if (values.help) {
      printHelp();
      process.exit(0);
    }

    return {
      provider: values.provider?.toLowerCase(),
      days: values.days ? parseInt(values.days, 10) : undefined,
      since: parseDate(values.since ?? ""),
      until: parseDate(values.until ?? ""),
      json: values.json,
      monthly: values.monthly,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unknown option")) {
      console.error(`Error: ${error.message}`);
      printHelp();
      process.exit(1);
    }
    throw error;
  }
}

function printHelp(): void {
  console.log(`
opencode-usage - Track OpenCode AI coding assistant usage and costs

Usage:
  bunx opencode-usage [options]

Options:
  -p, --provider <name>   Filter by provider (anthropic, openai, google, opencode)
  -d, --days <n>          Show only last N days
  -s, --since <date>      Start date (YYYYMMDD, YYYY-MM-DD, or 7d/1w/1m)
  -u, --until <date>      End date (YYYYMMDD, YYYY-MM-DD, or 7d/1w/1m)
  -j, --json              Output as JSON
  -m, --monthly           Aggregate by month instead of day
  -h, --help              Show this help message

Examples:
  bunx opencode-usage
  bunx opencode-usage --provider anthropic
  bunx opencode-usage -p openai -d 30
  bunx opencode-usage --since 20251201 --until 20251231
  bunx opencode-usage --since 7d
  bunx opencode-usage --monthly --json
`);
}
