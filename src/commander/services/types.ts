/**
 * Shared types for the Commander command system.
 */

export type JobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type JobLogEntry = {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type CommandJob = {
  id: string;
  commandId: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  logs: JobLogEntry[];
  result?: unknown;
  error?: { code: string; message: string };
};

export type CommandContext = {
  log: (level: JobLogEntry["level"], message: string) => void;
  jobId: string;
};

export type CommandSpec<Input, Output> = {
  id: string;
  validateInput: (payload: unknown) => Input;
  run: (ctx: CommandContext, input: Input) => Promise<Output>;
  timeoutMs: number;
  allowInUi: boolean;
};
