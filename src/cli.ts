/**
 * CLI argument parser using Node.js parseArgs (works with both Bun and Node.js)
 */

import { parseArgs as nodeParseArgs } from "node:util";

export type CliArgs = {
  provider?: string;
  days?: number;
};

// Get CLI args - works with both Bun and Node.js
function getArgs(): string[] {
  if (typeof globalThis.Bun !== "undefined") {
    return Bun.argv.slice(2);
  }
  return process.argv.slice(2);
}

export function parseArgs(): CliArgs {
  try {
    const { values } = nodeParseArgs({
      args: getArgs(),
      options: {
        provider: { type: "string", short: "p" },
        days: { type: "string", short: "d" },
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
  -h, --help              Show this help message

Examples:
  bunx opencode-usage
  bunx opencode-usage --provider anthropic
  bunx opencode-usage -p openai -d 30
`);
}
