/**
 * Commander HTTP server — local-only web interface bootstrap
 *
 * Bun-only: uses Bun.serve() for the HTTP server.
 */

import type { CliArgs } from "../cli.js";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getUsageData,
  type UsageQueryOpts,
  type SerializedDailyStats,
} from "./services/usage-service.js";
import { getQuotaData } from "./services/quota-service.js";
import { getJob, runCommand } from "./services/command-runner.js";
import { ensureActionsRegistered } from "./services/action-service.js";
import {
  getAppCatalog,
  ensureAppCommandsRegistered,
} from "./services/app-init-service.js";
import {
  listConfigFiles,
  readConfig,
  writeConfig,
  rollbackConfig,
  isValidSource,
  ConfigError,
} from "./services/config-service.js";

const isBun = typeof globalThis.Bun !== "undefined";

const DEFAULT_PORT = 4466;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")
    );
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

// ---------------------------------------------------------------------------
// Usage query — Worker thread in dev, direct call in bundled mode
// ---------------------------------------------------------------------------

const usageWorkerPath = join(__dirname, "services", "usage-worker.ts");
const canUseWorker = await Bun.file(usageWorkerPath).exists();

async function queryUsage(
  opts: UsageQueryOpts
): Promise<SerializedDailyStats[]> {
  if (!canUseWorker) return getUsageData(opts);
  return new Promise((resolve, reject) => {
    const worker = new Worker(usageWorkerPath);
    worker.onmessage = (event: MessageEvent) => {
      worker.terminate();
      const msg = event.data as
        | { ok: true; data: SerializedDailyStats[] }
        | { ok: false; error: string };
      if (msg.ok) resolve(msg.data);
      else reject(new Error(msg.error));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage(opts);
  });
}

export async function runCommanderServer(args: CliArgs): Promise<void> {
  if (!isBun) {
    console.error("Commander mode requires Bun runtime.");
    process.exit(1);
  }

  ensureActionsRegistered();
  ensureAppCommandsRegistered();

  // Warmup: pre-read config files so Bun's I/O is hot for first real request
  await listConfigFiles();

  const port = args.commanderPort ?? DEFAULT_PORT;
  const hostname = "127.0.0.1";

  Bun.serve({
    hostname,
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/api/health") {
        return Response.json({
          status: "ok",
          version: PKG_VERSION,
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/usage") {
        try {
          const provider = url.searchParams.get("provider") ?? undefined;
          const daysParam = url.searchParams.get("days");
          const days = daysParam !== null ? Number(daysParam) : undefined;
          const since = url.searchParams.get("since") ?? undefined;
          const until = url.searchParams.get("until") ?? undefined;
          const monthly = url.searchParams.get("monthly") === "true";

          const data = await queryUsage({
            provider,
            days,
            since,
            until,
            monthly,
          });
          return Response.json(data);
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error ? err.message : "Internal server error",
            },
            { status: 500 }
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/api/quota") {
        try {
          const data = await getQuotaData();
          return Response.json(data);
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error ? err.message : "Internal server error",
            },
            { status: 500 }
          );
        }
      }

      // POST /api/commands/run
      if (req.method === "POST" && url.pathname === "/api/commands/run") {
        try {
          const body = (await req.json()) as {
            commandId?: string;
            payload?: unknown;
          };
          if (typeof body.commandId !== "string" || !body.commandId) {
            return Response.json(
              { error: "Missing or invalid commandId" },
              { status: 400 }
            );
          }
          const jobId = runCommand(body.commandId, body.payload);
          return Response.json({ jobId }, { status: 202 });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status: 400 });
        }
      }

      // GET /api/jobs/:jobId
      if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
        const jobId = url.pathname.slice("/api/jobs/".length);
        const job = getJob(jobId);
        if (!job) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        return Response.json(job);
      }

      // GET /api/config/files
      if (req.method === "GET" && url.pathname === "/api/config/files") {
        try {
          const files = await listConfigFiles();
          return Response.json(files);
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error ? err.message : "Internal server error",
            },
            { status: 500 }
          );
        }
      }

      // GET /api/config/:source
      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/config/") &&
        url.pathname !== "/api/config/files"
      ) {
        const source = url.pathname.slice("/api/config/".length);
        if (!isValidSource(source)) {
          return Response.json(
            { error: `Unknown config source: ${source}` },
            { status: 404 }
          );
        }
        try {
          const data = readConfig(source);
          return Response.json(data);
        } catch (err) {
          const status = err instanceof ConfigError ? err.status : 500;
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status });
        }
      }

      // PUT /api/config/:source
      if (req.method === "PUT" && url.pathname.startsWith("/api/config/")) {
        const source = url.pathname.slice("/api/config/".length);
        if (!isValidSource(source)) {
          return Response.json(
            { error: `Unknown config source: ${source}` },
            { status: 404 }
          );
        }
        try {
          const body = await req.json();
          const { backupPath } = await writeConfig(source, body);
          return Response.json({ ok: true, backupPath });
        } catch (err) {
          if (err instanceof SyntaxError) {
            return Response.json(
              { error: "Request body is not valid JSON" },
              { status: 400 }
            );
          }
          const status = err instanceof ConfigError ? err.status : 500;
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status });
        }
      }

      // POST /api/config/:source/rollback
      if (
        req.method === "POST" &&
        url.pathname.endsWith("/rollback") &&
        url.pathname.startsWith("/api/config/")
      ) {
        const source = url.pathname
          .slice("/api/config/".length)
          .replace(/\/rollback$/, "");
        if (!isValidSource(source)) {
          return Response.json(
            { error: `Unknown config source: ${source}` },
            { status: 404 }
          );
        }
        try {
          const result = await rollbackConfig(source);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const status = err instanceof ConfigError ? err.status : 500;
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status });
        }
      }

      // POST /api/accounts/:provider/:action
      if (req.method === "POST" && url.pathname.startsWith("/api/accounts/")) {
        const parts = url.pathname.split("/");
        const provider = parts[3];
        const action = parts[4];
        if (!provider || !action) {
          return Response.json(
            { error: "Invalid account route" },
            { status: 400 }
          );
        }
        try {
          const body = (await req.json()) as Record<string, unknown>;
          const jobId = runCommand(`accounts.${action}`, {
            provider,
            ...body,
          });
          return Response.json({ jobId }, { status: 202 });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status: 400 });
        }
      }

      // POST /api/actions/:action
      if (req.method === "POST" && url.pathname.startsWith("/api/actions/")) {
        const action = url.pathname.slice("/api/actions/".length);
        if (!action) {
          return Response.json(
            { error: "Invalid action route" },
            { status: 400 }
          );
        }
        try {
          const body = await req.json();
          const jobId = runCommand(`actions.${action}`, body);
          return Response.json({ jobId }, { status: 202 });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status: 400 });
        }
      }

      // GET /api/apps
      if (req.method === "GET" && url.pathname === "/api/apps") {
        try {
          const catalog = await getAppCatalog();
          return Response.json(catalog);
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error ? err.message : "Internal server error",
            },
            { status: 500 }
          );
        }
      }

      // POST /api/apps/:appId/init
      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/apps/") &&
        url.pathname.endsWith("/init")
      ) {
        const appId = url.pathname
          .slice("/api/apps/".length)
          .replace(/\/init$/, "");
        try {
          const jobId = runCommand("apps.init", { appId });
          return Response.json({ jobId }, { status: 202 });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status: 400 });
        }
      }

      // POST /api/apps/:appId/repair
      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/apps/") &&
        url.pathname.endsWith("/repair")
      ) {
        const appId = url.pathname
          .slice("/api/apps/".length)
          .replace(/\/repair$/, "");
        try {
          const jobId = runCommand("apps.repair", { appId });
          return Response.json({ jobId }, { status: 202 });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Internal server error";
          return Response.json({ error: message }, { status: 400 });
        }
      }

      // Serve static UI files (SPA fallback)
      if (!url.pathname.startsWith("/api/")) {
        // Dev: import.meta.url = src/commander/server.ts → ../commander-ui/dist
        // Prod: import.meta.url = dist/index.js → ./commander-ui
        const base = new URL(".", import.meta.url).pathname;
        const UI_DIST = (await Bun.file(
          join(base, "commander-ui", "index.html")
        ).exists())
          ? join(base, "commander-ui")
          : join(base, "..", "commander-ui", "dist");
        const filePath =
          url.pathname === "/"
            ? join(UI_DIST, "index.html")
            : join(UI_DIST, url.pathname);
        const file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);
        // SPA fallback
        return new Response(Bun.file(join(UI_DIST, "index.html")));
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  const serverUrl = `http://${hostname}:${port}`;
  console.log(`Commander ready at ${serverUrl}`);

  if (isBun && !process.env.NO_OPEN) {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "start", serverUrl]
        : process.platform === "darwin"
          ? ["open", serverUrl]
          : ["xdg-open", serverUrl];
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] });
  }
}
