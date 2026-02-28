import { describe, test, expect } from "bun:test";
import {
  registerCommand,
  runCommand,
  getJob,
  listJobs,
} from "../commander/services/command-runner.js";
import type { CommandSpec } from "../commander/services/types.js";

// ---------------------------------------------------------------------------
// Test helpers — each test uses a unique command ID to avoid registry collisions
// ---------------------------------------------------------------------------

let testCounter = 0;
function uniqueId(prefix: string): string {
  return `__test_${prefix}_${++testCounter}_${Date.now()}`;
}

function makeEchoSpec(
  id: string
): CommandSpec<{ msg: string }, { echo: string }> {
  return {
    id,
    validateInput(payload: unknown) {
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("msg" in payload) ||
        typeof (payload as { msg: unknown }).msg !== "string"
      ) {
        throw new Error("msg is required");
      }
      return payload as { msg: string };
    },
    async run(_ctx, input) {
      return { echo: input.msg };
    },
    timeoutMs: 5_000,
    allowInUi: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("commander command-runner", () => {
  // -----------------------------------------------------------------------
  // registerCommand
  // -----------------------------------------------------------------------
  describe("registerCommand", () => {
    test("registers a new command without throwing", () => {
      const id = uniqueId("register");
      expect(() => registerCommand(makeEchoSpec(id))).not.toThrow();
    });

    test("throws when registering duplicate id", () => {
      const id = uniqueId("dup");
      registerCommand(makeEchoSpec(id));
      expect(() => registerCommand(makeEchoSpec(id))).toThrow(
        `Command "${id}" is already registered`
      );
    });
  });

  // -----------------------------------------------------------------------
  // runCommand
  // -----------------------------------------------------------------------
  describe("runCommand", () => {
    test("returns a jobId string for a valid command", () => {
      const id = uniqueId("run");
      registerCommand(makeEchoSpec(id));
      const jobId = runCommand(id, { msg: "hello" });
      expect(typeof jobId).toBe("string");
      expect(jobId.length).toBeGreaterThan(0);
    });

    test("throws for unknown commandId", () => {
      expect(() => runCommand("__nonexistent_cmd__", {})).toThrow(
        'Unknown command: "__nonexistent_cmd__"'
      );
    });

    test("throws when validateInput fails", () => {
      const id = uniqueId("badinput");
      registerCommand(makeEchoSpec(id));
      expect(() => runCommand(id, { wrong: true })).toThrow("msg is required");
    });
  });

  // -----------------------------------------------------------------------
  // getJob / listJobs
  // -----------------------------------------------------------------------
  describe("getJob", () => {
    test("returns the job with correct commandId", () => {
      const id = uniqueId("getjob");
      registerCommand(makeEchoSpec(id));
      const jobId = runCommand(id, { msg: "test" });
      const job = getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.commandId).toBe(id);
      expect(job!.id).toBe(jobId);
    });

    test("returns undefined for unknown jobId", () => {
      expect(getJob("nonexistent-job-id")).toBeUndefined();
    });
  });

  describe("listJobs", () => {
    test("includes submitted job", () => {
      const id = uniqueId("listjobs");
      registerCommand(makeEchoSpec(id));
      const jobId = runCommand(id, { msg: "list-me" });
      const jobs = listJobs();
      const found = jobs.find((j) => j.id === jobId);
      expect(found).toBeDefined();
      expect(found!.commandId).toBe(id);
    });

    test("returns an array", () => {
      expect(Array.isArray(listJobs())).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Job lifecycle: queued → running → success
  // -----------------------------------------------------------------------
  describe("job lifecycle", () => {
    test("job reaches success status after execution", async () => {
      const id = uniqueId("lifecycle");
      registerCommand(makeEchoSpec(id));
      const jobId = runCommand(id, { msg: "lifecycle" });

      // Wait for the fire-and-forget async execution to complete
      await new Promise((r) => setTimeout(r, 200));

      const job = getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.status).toBe("success");
      expect(job!.result).toEqual({ echo: "lifecycle" });
      expect(job!.finishedAt).toBeDefined();
      expect(job!.startedAt).toBeDefined();
    });

    test("job logs contain execution messages", async () => {
      const id = uniqueId("logs");
      registerCommand(makeEchoSpec(id));
      const jobId = runCommand(id, { msg: "logtest" });

      await new Promise((r) => setTimeout(r, 200));

      const job = getJob(jobId);
      expect(job!.logs.length).toBeGreaterThan(0);

      const messages = job!.logs.map((l) => l.message);
      expect(messages.some((m) => m.includes("Running command"))).toBe(true);
      expect(messages.some((m) => m.includes("completed successfully"))).toBe(
        true
      );
    });

    test("failing command sets status to failed", async () => {
      const id = uniqueId("fail");
      registerCommand({
        id,
        validateInput: (p: unknown) => p,
        async run() {
          throw new Error("intentional test failure");
        },
        timeoutMs: 5_000,
        allowInUi: false,
      });

      const jobId = runCommand(id, {});
      await new Promise((r) => setTimeout(r, 200));

      const job = getJob(jobId);
      expect(job!.status).toBe("failed");
      expect(job!.error).toBeDefined();
      expect(job!.error!.code).toBe("RUNTIME_ERROR");
      expect(job!.error!.message).toBe("intentional test failure");
    });
  });
});
