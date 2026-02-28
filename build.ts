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

// Build commander-ui (Vite) then copy into dist/ for npm packaging
const uiDir = "./src/commander-ui";
const uiSrc = "./src/commander-ui/dist";
const uiDest = "./dist/commander-ui";

const installResult = Bun.spawnSync(["bun", "install"], {
  cwd: uiDir,
  stdio: ["ignore", "inherit", "inherit"],
});
if (installResult.exitCode !== 0) {
  console.warn("Warning: commander-ui install failed, skipping UI build");
} else {
  const viteBuild = Bun.spawnSync(["bun", "run", "build"], {
    cwd: uiDir,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (viteBuild.exitCode !== 0) {
    console.error("commander-ui build failed");
    process.exit(1);
  }
  console.log("Built commander-ui");
}

const cpResult = Bun.spawnSync(["cp", "-r", uiSrc, uiDest]);
if (cpResult.exitCode !== 0) {
  console.warn("Warning: commander-ui dist not found, skipping copy");
} else {
  console.log("Copied commander-ui dist");
}
