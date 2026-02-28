import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  target: "bun",
  outdir: "./dist",
  format: "esm",
  sourcemap: "external",
  plugins: [solidPlugin],
});

if (!result.success) {
  console.error("Build failed");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Build successful");

const indexPath = "./dist/index.js";
const indexContent = await Bun.file(indexPath).text();
const updatedContent = indexContent.replace(
  "#!/usr/bin/env node",
  "#!/usr/bin/env bun"
);
await Bun.write(indexPath, updatedContent);

console.log("Updated shebang");

const tscResult = Bun.spawnSync([
  "tsc",
  "--emitDeclarationOnly",
  "--declaration",
  "--outDir",
  "dist",
]);
if (tscResult.exitCode !== 0) {
  console.error("Type generation failed");
  process.exit(1);
}

console.log("Generated type definitions");

// Copy commander-ui dist into dist/ for npm packaging
const uiSrc = "./src/commander-ui/dist";
const uiDest = "./dist/commander-ui";
const cpResult = Bun.spawnSync(["cp", "-r", uiSrc, uiDest]);
if (cpResult.exitCode !== 0) {
  console.warn("Warning: commander-ui dist not found, skipping copy");
} else {
  console.log("Copied commander-ui dist");
}
