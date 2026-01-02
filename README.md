# opencode-usage

CLI tool for tracking [OpenCode](https://github.com/sst/opencode) AI coding assistant usage and costs.

## Features

- Daily or monthly usage breakdown with token counts and estimated costs
- Provider breakdown (Anthropic, OpenAI, Google, etc.)
- Filter by provider, date range, or relative time
- JSON output for scripting and automation
- Model pricing for accurate cost estimation
- Terminal table output

## Installation

```bash
# Run directly with bunx (recommended, faster)
bunx opencode-usage

# Or with npx
npx opencode-usage

# Or install globally
bun add -g opencode-usage
npm install -g opencode-usage
```

## Usage

```bash
# Show all usage data (daily breakdown)
opencode-usage

# Filter by provider
opencode-usage --provider anthropic
opencode-usage -p openai

# Show last N days
opencode-usage --days 30
opencode-usage -d 7

# Date range filtering
opencode-usage --since 20251201 --until 20251231
opencode-usage --since 2025-12-01
opencode-usage --since 7d      # last 7 days
opencode-usage --since 1w      # last week
opencode-usage --since 1m      # last month

# Monthly aggregation
opencode-usage --monthly
opencode-usage -m --since 2025-01-01

# JSON output (for scripting)
opencode-usage --json
opencode-usage --monthly --json > usage.json

# Combine filters
opencode-usage --provider anthropic --since 7d --json
```

## Output

```
┌────────────┬───────────────────────────────────┬────────────────┬──────────────┬────────────────┬────────────┐
│ Date       │ Models                            │          Input │       Output │   Total Tokens │       Cost │
├────────────┼───────────────────────────────────┼────────────────┼──────────────┼────────────────┼────────────┤
│ 2025-12-30 │ - claude-opus-4-5                 │    173,440,372 │      691,955 │    174,132,327 │    $167.42 │
│            │ - claude-sonnet-4-5               │                │              │                │            │
│            │   [anthropic]                     │    161,029,288 │      618,355 │    161,647,643 │    $162.06 │
│            │   [openai]                        │      7,109,638 │       56,201 │      7,165,839 │      $5.36 │
├────────────┼───────────────────────────────────┼────────────────┼──────────────┼────────────────┼────────────┤
│ Total      │                                   │    395,521,798 │    1,617,158 │    397,138,956 │    $417.81 │
└────────────┴───────────────────────────────────┴────────────────┴──────────────┴────────────────┴────────────┘
```

## Supported Providers

- **Anthropic**: Claude Opus, Sonnet, Haiku (all versions)
- **OpenAI**: GPT-4o, GPT-5, O1, O3
- **Google**: Gemini 2.0, 2.5, 3.0
- **OpenCode hosted**: Free models (qwen3-coder, glm-4.7-free, etc.)

## How It Works

This tool reads OpenCode session data from:

- Linux: `~/.local/share/opencode/storage/`
- macOS: `~/.local/share/opencode/storage/`
- Windows: `%LOCALAPPDATA%/opencode/storage/`

It aggregates token usage by day and calculates estimated costs based on current API pricing.

## Note on Costs

If you're using OpenCode with a Claude Max/Pro subscription or OpenCode Zen credits, the actual cost to you is your subscription fee, not the API-equivalent cost shown here. The cost column shows what the equivalent API usage would cost for reference.

## License

MIT
