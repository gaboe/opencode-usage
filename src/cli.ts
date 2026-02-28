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
  watch?: boolean;
  stats?: boolean;
  config?: "show";
  commander?: boolean;
  commanderPort?: number;
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
        watch: { type: "boolean", short: "w" },
        stats: { type: "boolean", short: "S" },
        config: { type: "string" },
        commander: { type: "boolean" },
        "commander-port": { type: "string" },
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
      watch: values.watch,
      stats: values.stats,
      config: values.config as "show" | undefined,
      commander: values.commander,
      commanderPort: values["commander-port"]
        ? parseInt(values["commander-port"], 10)
        : undefined,
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

Modes:
  (default)               Interactive dashboard (Bun only)
  -S, --stats             Stats table mode (works with Node.js too)
  --commander             Start Commander web server (Bun only)

Options:
  -p, --provider <name>   Filter by provider (anthropic, openai, google, opencode)
  -d, --days <n>          Show only last N days
  -s, --since <date>      Start date (YYYYMMDD, YYYY-MM-DD, or 7d/1w/1m)
  -u, --until <date>      End date (YYYYMMDD, YYYY-MM-DD, or 7d/1w/1m)
  -j, --json              Output as JSON (stats mode only)
  -m, --monthly           Aggregate by month (stats mode only)
  -w, --watch             Watch mode - refresh every 5 minutes (stats mode only)
      --config show       Show current configuration
  -h, --help              Show this help message
      --commander-port <n>  Commander server port (default: 3000)

Codex Quota:
  Dashboard auto-reads Codex auth from ~/.codex/auth.json.
  Run 'codex login' to authenticate.

Examples:
  bunx opencode-usage
  bunx opencode-usage --stats
  bunx opencode-usage --stats --provider anthropic
  bunx opencode-usage --stats -p openai -d 30
  bunx opencode-usage --stats --since 7d --monthly --json
  bunx opencode-usage --stats -w -d 1
  bunx opencode-usage --config show
`);
}
