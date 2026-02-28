/**
 * Command registry and background job runner.
 *
 * Commands are registered via `registerCommand`, then executed asynchronously
 * via `runCommand`. Jobs are tracked in-memory with log streaming support.
 */

import type {
  CommandContext,
  CommandJob,
  CommandSpec,
  JobLogEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, CommandSpec<any, any>>();

export function registerCommand<I, O>(spec: CommandSpec<I, O>): void {
  if (registry.has(spec.id)) {
    throw new Error(`Command "${spec.id}" is already registered`);
  }
  registry.set(spec.id, spec);
}

// ---------------------------------------------------------------------------
// Job store
// ---------------------------------------------------------------------------

const jobs = new Map<string, CommandJob>();

export function getJob(jobId: string): CommandJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(): CommandJob[] {
  return [...jobs.values()];
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status !== "queued" && job.status !== "running") return false;

  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  job.logs.push({
    ts: new Date().toISOString(),
    level: "warn",
    message: "Job cancelled by user",
  });
  return true;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runCommand(commandId: string, payload: unknown): string {
  const spec = registry.get(commandId);
  if (!spec) {
    throw new Error(`Unknown command: "${commandId}"`);
  }

  // Validate input synchronously — throws on invalid input
  const input = spec.validateInput(payload);

  const jobId = crypto.randomUUID();
  const job: CommandJob = {
    id: jobId,
    commandId,
    status: "queued",
    logs: [],
  };
  jobs.set(jobId, job);

  const ctx: CommandContext = {
    jobId,
    log(level: JobLogEntry["level"], message: string) {
      job.logs.push({ ts: new Date().toISOString(), level, message });
    },
  };

  // Fire-and-forget — execution is fully async
  void executeJob(job, ctx, spec, input);

  return jobId;
}

// ---------------------------------------------------------------------------
// Internal async executor
// ---------------------------------------------------------------------------

async function executeJob<I, O>(
  job: CommandJob,
  ctx: CommandContext,
  spec: CommandSpec<I, O>,
  input: I
): Promise<void> {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  ctx.log("info", `Running command "${job.commandId}"`);

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    if (job.status === "running") {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.error = {
        code: "TIMEOUT",
        message: `Command "${job.commandId}" timed out after ${spec.timeoutMs}ms`,
      };
      ctx.log("error", `Timeout after ${spec.timeoutMs}ms`);
    }
  }, spec.timeoutMs);

  try {
    const result = await spec.run(ctx, input);

    // If the timeout already fired, ignore the late result
    if (timedOut) return;

    clearTimeout(timer);
    job.status = "success";
    job.finishedAt = new Date().toISOString();
    job.result = result;
    ctx.log("info", "Command completed successfully");
  } catch (err: unknown) {
    // If the timeout already fired, ignore the late error
    if (timedOut) return;

    clearTimeout(timer);
    const message =
      err instanceof Error ? err.message : "Unknown runtime error";
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = { code: "RUNTIME_ERROR", message };
    ctx.log("error", message);
  }
}
