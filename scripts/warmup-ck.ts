/**
 * CK Semantic Search Index Warmup Script
 *
 * Runs CK indexing for the current project.
 * Uses delta indexing - only changed files are re-indexed.
 *
 * Usage: bun run scripts/warmup-ck.ts
 */

async function runIndex(): Promise<number> {
  const proc = Bun.spawn(
    [
      "npx",
      "-y",
      "@beaconbay/ck-search",
      "--index",
      ".",
      "--model",
      "jina-code",
    ],
    { stdout: "inherit", stderr: "pipe" }
  );

  const stderrText = await new Response(proc.stderr).text();
  if (stderrText) {
    console.error(stderrText);
  }

  const exitCode = await proc.exited;
  return exitCode;
}

async function cleanIndex(): Promise<void> {
  console.log("Cleaning old index due to model mismatch...");
  const proc = Bun.spawn(
    ["npx", "-y", "@beaconbay/ck-search", "--clean", "."],
    { stdout: "inherit", stderr: "inherit" }
  );
  await proc.exited;
}

let exitCode = await runIndex();

// If model mismatch, clean and retry
if (exitCode !== 0) {
  await cleanIndex();
  exitCode = await runIndex();
}

if (exitCode !== 0) {
  console.error("CK warmup failed with exit code:", exitCode);
  throw new Error(`CK warmup failed with exit code: ${exitCode}`);
}

console.log("CK semantic search index ready");

export {};
