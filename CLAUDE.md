# Development Guidelines for opencode-usage

## Project Overview

CLI tool for tracking [OpenCode](https://github.com/sst/opencode) AI coding assistant usage and costs.

### Tech Stack

- **Runtime**: Bun (primary) + Node.js (fallback for npx)
- **Language**: TypeScript
- **Build**: Bun bundler + tsc for .d.ts
- **Package Manager**: Bun

## Project Structure

```
src/
├── index.ts      # Entry point
├── cli.ts        # CLI argument parsing (node:util parseArgs)
├── loader.ts     # Data loading (Bun.file with Node.js fallback)
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

### Dual Runtime Support

This project must work with both **Bun** and **Node.js**. Always use runtime detection:

```typescript
// ✅ Good - Works with both runtimes
const isBun = typeof globalThis.Bun !== "undefined";

if (isBun) {
  return Bun.file(filePath).json();
}
return JSON.parse(readFileSync(filePath, "utf-8"));

// ❌ Bad - Bun-only (breaks npx)
return Bun.file(filePath).json();
```

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
bun run dev --days 3           # Test with Bun
bun run build && node dist/index.js --days 3  # Test with Node.js
npm link && npx opencode-usage --days 3       # Test npx
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

1. **Test both runtimes** after changes (Bun and Node.js)
2. **Keep it simple** - this is a small CLI tool
3. **Run build** before committing to verify it works
4. **All markdown in English**
