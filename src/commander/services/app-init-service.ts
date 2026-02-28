/**
 * App initializer service — detection + init/repair workflows for gaboe-owned apps.
 *
 * Manages a catalog of 4 apps with detection logic, one-click init,
 * and repair workflows exposed via registered commands.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { registerCommand } from "./command-runner.js";
import type { CommandContext } from "./types.js";

const isBun = typeof globalThis.Bun !== "undefined";

// Suppress unused-variable lint — runtime detection guard kept for parity
void isBun;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppId =
  | "oc-codex-multi-account"
  | "oc-anthropic-multi-account"
  | "opencode-gitbutler"
  | "opencode-usage";

export type AppState = "ready" | "partial" | "missing-deps" | "not-installed";

export type AppStatus = {
  id: AppId;
  name: string;
  description: string;
  state: AppState;
  details: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode");
const OPENCODE_JSON_PATH = join(OPENCODE_CONFIG_DIR, "opencode.json");

async function fileExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}

async function readOpencodeJson(): Promise<Record<string, unknown>> {
  try {
    const file = Bun.file(OPENCODE_JSON_PATH);
    if (!(await file.exists())) return {};
    const text = await file.text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function pluginListContains(
  config: Record<string, unknown>,
  pluginName: string
): boolean {
  const plugins = config.plugins;
  if (!Array.isArray(plugins)) return false;
  return plugins.some(
    (p: unknown) => typeof p === "string" && p.includes(pluginName)
  );
}

async function patchPluginList(pluginEntry: string): Promise<void> {
  const config = await readOpencodeJson();

  if (!Array.isArray(config.plugins)) {
    config.plugins = [];
  }

  const plugins = config.plugins as string[];
  if (plugins.includes(pluginEntry)) return;

  plugins.push(pluginEntry);

  await Bun.write(OPENCODE_JSON_PATH, JSON.stringify(config, null, 2));
}

function spawnSyncCheck(cmd: string[]): boolean {
  try {
    const result = Bun.spawnSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function spawnAndLog(
  ctx: CommandContext,
  cmd: string[],
  options?: { cwd?: string }
): Promise<boolean> {
  ctx.log("info", `Running: ${cmd.join(" ")}`);
  try {
    const proc = Bun.spawn(cmd, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (stdout.trim()) ctx.log("info", stdout.trim());
    if (stderr.trim()) ctx.log("warn", stderr.trim());

    return proc.exitCode === 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spawn failed";
    ctx.log("error", message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Detection logic per app
// ---------------------------------------------------------------------------

async function detectOcCodexMultiAccount(): Promise<AppStatus> {
  const binaryPath = join(
    OPENCODE_CONFIG_DIR,
    "node_modules",
    ".bin",
    "oc-codex-multi-account"
  );
  const binaryExists = await fileExists(binaryPath);
  const config = await readOpencodeJson();
  const pluginConfigured = pluginListContains(config, "oc-codex-multi-account");

  let state: AppState;
  const details: string[] = [];

  if (binaryExists && pluginConfigured) {
    state = "ready";
    details.push("Binary installed", "Plugin configured");
  } else if (binaryExists || pluginConfigured) {
    state = "partial";
    if (!binaryExists) details.push("Binary missing");
    if (!pluginConfigured) details.push("Plugin not configured");
  } else {
    state = "not-installed";
    details.push("Binary not found", "Plugin not configured");
  }

  return {
    id: "oc-codex-multi-account",
    name: "OC Codex Multi-Account",
    description: "Multi-account support for OpenAI Codex via OpenCode plugin",
    state,
    details,
  };
}

async function detectOcAnthropicMultiAccount(): Promise<AppStatus> {
  const dirPath = "/Users/gabrielecegi/oc/oc-anthropic-multi-account";
  const statePath = join(
    OPENCODE_CONFIG_DIR,
    "anthropic-multi-account-state.json"
  );
  const dirExists = await fileExists(dirPath);
  const stateExists = await fileExists(statePath);

  let state: AppState;
  const details: string[] = [];

  if (dirExists && stateExists) {
    state = "ready";
    details.push("Project directory found", "State file present");
  } else if (dirExists) {
    state = "partial";
    details.push("Project directory found", "State file missing");
  } else {
    state = "not-installed";
    details.push("Project directory not found");
    if (!stateExists) details.push("State file missing");
  }

  return {
    id: "oc-anthropic-multi-account",
    name: "OC Anthropic Multi-Account",
    description: "Multi-account support for Anthropic via OpenCode plugin",
    state,
    details,
  };
}

async function detectOpencodeGitbutler(): Promise<AppStatus> {
  const butAvailable = spawnSyncCheck(["but", "--version"]);
  const config = await readOpencodeJson();
  const pluginConfigured = pluginListContains(config, "opencode-gitbutler");

  let state: AppState;
  const details: string[] = [];

  if (butAvailable && pluginConfigured) {
    state = "ready";
    details.push("GitButler CLI available", "Plugin configured");
  } else if (!butAvailable) {
    state = "missing-deps";
    details.push("GitButler CLI (but) not found");
    if (!pluginConfigured) details.push("Plugin not configured");
  } else {
    state = "partial";
    details.push("GitButler CLI available", "Plugin not configured");
  }

  return {
    id: "opencode-gitbutler",
    name: "OpenCode GitButler",
    description: "GitButler integration for OpenCode",
    state,
    details,
  };
}

async function detectOpencodeUsage(): Promise<AppStatus> {
  const available = spawnSyncCheck(["bunx", "opencode-usage", "--help"]);

  let state: AppState;
  const details: string[] = [];

  if (available) {
    state = "ready";
    details.push("opencode-usage available via bunx");
  } else {
    state = "not-installed";
    details.push("opencode-usage not available");
  }

  return {
    id: "opencode-usage",
    name: "OpenCode Usage",
    description: "CLI tool for tracking OpenCode AI usage and costs",
    state,
    details,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getAppCatalog(): Promise<AppStatus[]> {
  const results = await Promise.all([
    detectOcCodexMultiAccount(),
    detectOcAnthropicMultiAccount(),
    detectOpencodeGitbutler(),
    detectOpencodeUsage(),
  ]);
  return results;
}

// ---------------------------------------------------------------------------
// Init workflows
// ---------------------------------------------------------------------------

const VALID_APP_IDS: ReadonlySet<string> = new Set<AppId>([
  "oc-codex-multi-account",
  "oc-anthropic-multi-account",
  "opencode-gitbutler",
  "opencode-usage",
]);

function validateAppInput(payload: unknown): { appId: AppId } {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("appId" in payload)
  ) {
    throw new Error('Missing "appId" in payload');
  }
  const { appId } = payload as { appId: unknown };
  if (typeof appId !== "string" || !VALID_APP_IDS.has(appId)) {
    throw new Error(`Invalid appId: "${String(appId)}"`);
  }
  return { appId: appId as AppId };
}

async function initOcCodexMultiAccount(ctx: CommandContext): Promise<void> {
  await spawnAndLog(ctx, [
    "bun",
    "add",
    "oc-codex-multi-account",
    "--cwd",
    OPENCODE_CONFIG_DIR,
  ]);
  await patchPluginList("oc-codex-multi-account@latest");
  ctx.log("info", "Plugin configured in opencode.json");
  ctx.log(
    "info",
    `To add accounts, run: ${join(OPENCODE_CONFIG_DIR, "node_modules", ".bin", "oc-codex-multi-account")} add <alias>`
  );
}

async function initOcAnthropicMultiAccount(ctx: CommandContext): Promise<void> {
  const dirPath = "/Users/gabrielecegi/oc/oc-anthropic-multi-account";
  const dirExists = await fileExists(dirPath);
  if (!dirExists) {
    ctx.log(
      "error",
      `Project directory not found: ${dirPath}. Clone the repo first.`
    );
    return;
  }
  await spawnAndLog(ctx, ["bun", "install"], { cwd: dirPath });
  await patchPluginList("oc-anthropic-multi-account@latest");
  ctx.log("info", "Plugin configured in opencode.json");
  ctx.log(
    "info",
    `To add accounts, run: cd ${dirPath} && bun src/cli.ts add primary`
  );
}

async function initOpencodeGitbutler(ctx: CommandContext): Promise<void> {
  await patchPluginList("opencode-gitbutler@latest");
  ctx.log("info", "Plugin configured in opencode.json");
  ctx.log("info", "To install GitButler CLI, run: brew install gitbutler");
}

async function initOpencodeUsage(ctx: CommandContext): Promise<void> {
  const ok = await spawnAndLog(ctx, ["bunx", "opencode-usage", "--help"]);
  if (ok) {
    ctx.log("info", "opencode-usage is working correctly");
  }
  ctx.log(
    "info",
    "opencode-usage is available via bunx. For global install: bun add -g opencode-usage"
  );
}

async function runInit(
  ctx: CommandContext,
  input: { appId: AppId }
): Promise<{ ok: boolean }> {
  ctx.log("info", `Initializing app: ${input.appId}`);
  switch (input.appId) {
    case "oc-codex-multi-account":
      await initOcCodexMultiAccount(ctx);
      break;
    case "oc-anthropic-multi-account":
      await initOcAnthropicMultiAccount(ctx);
      break;
    case "opencode-gitbutler":
      await initOpencodeGitbutler(ctx);
      break;
    case "opencode-usage":
      await initOpencodeUsage(ctx);
      break;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Repair workflow
// ---------------------------------------------------------------------------

async function runRepair(
  ctx: CommandContext,
  input: { appId: AppId }
): Promise<{ ok: boolean; state: AppState }> {
  ctx.log("info", `Repairing app: ${input.appId}`);

  // Re-run detection first
  const catalog = await getAppCatalog();
  const app = catalog.find((a) => a.id === input.appId);
  if (!app) {
    ctx.log("error", `App not found: ${input.appId}`);
    return { ok: false, state: "not-installed" };
  }

  ctx.log("info", `Current state: ${app.state} — ${app.details.join(", ")}`);

  if (app.state === "ready") {
    ctx.log("info", "App is already in ready state, no repair needed");
    return { ok: true, state: "ready" };
  }

  // Attempt init to fix partial states
  ctx.log("info", "Attempting repair via init workflow...");
  await runInit(ctx, input);

  // Re-detect after repair
  const afterCatalog = await getAppCatalog();
  const afterApp = afterCatalog.find((a) => a.id === input.appId);
  const finalState = afterApp?.state ?? "not-installed";

  ctx.log("info", `Post-repair state: ${finalState}`);
  return { ok: finalState === "ready", state: finalState };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

let registered = false;

export function ensureAppCommandsRegistered(): void {
  if (registered) return;
  registered = true;

  registerCommand({
    id: "apps.init",
    validateInput: validateAppInput,
    run: runInit,
    timeoutMs: 120_000,
    allowInUi: true,
  });

  registerCommand({
    id: "apps.repair",
    validateInput: validateAppInput,
    run: runRepair,
    timeoutMs: 120_000,
    allowInUi: true,
  });
}
