# Commander Web Layer — Issues / Gotchas

## Known Issues

- tsconfig `jsxImportSource: @opentui/solid` — must NOT bleed into commander-ui tsconfig which needs `react-jsx`
- shadcn scaffold creates its own package.json inside subdirectory — do NOT mix deps with parent
- `strict: true` in tsconfig — all new files must pass without ignoring errors
- Zero-dep rule applies to main `src/` — commander-ui (React app) has its own node_modules

## To Watch

- SSE streaming for job logs: must work with Bun's built-in HTTP server (use Response with ReadableStream)
- Plugin CLI paths may vary by install method (global bin vs local node_modules bin)
- OAuth flows in oc-anthropic-multi-account need browser — UI can only launch the flow, not embed it
