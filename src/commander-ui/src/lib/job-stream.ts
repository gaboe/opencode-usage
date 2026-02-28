import { api } from "./api";

type JobState = Awaited<ReturnType<typeof api.getJob>>;

export async function* pollJob(
  jobId: string,
  intervalMs = 500
): AsyncGenerator<JobState> {
  const terminal = new Set(["success", "failed", "cancelled"]);
  while (true) {
    const job = await api.getJob(jobId);
    yield job;
    if (terminal.has(job.status)) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
