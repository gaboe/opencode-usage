# Development Guidelines for opencode-usage

## Project Overview

CLI tool for tracking [OpenCode](https://github.com/sst/opencode) AI coding assistant usage and costs.

### Tech Stack

- **Runtime**: Bun (uses `bun:sqlite` for data loading)
- **Language**: TypeScript
- **Build**: Bun bundler + tsc for .d.ts
- **Package Manager**: Bun

## Project Structure

```
src/
├── index.ts      # Entry point
├── cli.ts        # CLI argument parsing (node:util parseArgs)
├── loader.ts     # Data loading (bun:sqlite from opencode.db)
├── aggregator.ts # Date/provider aggregation
├── renderer.ts   # Terminal table output
├── pricing.ts    # Model pricing config
└── types.ts      # Type definitions
```

## Development Commands

```bash
bun run dev              # Run from source
bun run dev --days 7     # Run with arguments
bun run check            # Format + lint + typecheck
bun run build            # Build for npm (JS + .d.ts)
bun run compile          # Create standalone binary
bun run ck:warmup        # Index codebase for semantic search
```

## Code Guidelines

### TypeScript Best Practices

- Use `type` instead of `interface`
- Use `??` (nullish coalescing) instead of `||` for defaults
- Use `.js` extensions in imports (ESM requirement)
- Keep code simple - this is a small CLI tool

### File Naming

All filenames must use **kebab-case**: `pricing-config.ts`, `date-utils.ts`

### Code Style

- Functions over classes
- Explicit parameters
- No unnecessary abstractions

## Build & Publish

### Local Testing

```bash
bun run dev --days 3           # Test from source
bun run build && bun dist/index.js --days 3  # Test built output
```

### Publishing

Uses GitHub Actions with OIDC Trusted Publishing (no NPM_TOKEN needed):

```bash
git tag v0.1.0
git push --tags
```

## MCP Tools Available

| Tool         | Description                      |
| ------------ | -------------------------------- |
| **CK**       | Semantic code search             |
| **Context7** | Library documentation            |
| **Exa**      | Web search for APIs and examples |

## Quick Reference

| Command           | Description       |
| ----------------- | ----------------- |
| `bun run dev`     | Run from source   |
| `bun run build`   | Build JS + types  |
| `bun run compile` | Standalone binary |

## Important Reminders

1. **Keep it simple** - this is a small CLI tool
2. **Run build** before committing to verify it works
3. **All markdown in English**
