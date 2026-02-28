import { useState, useEffect, useRef } from "react";
import { pollJob } from "@/lib/job-stream";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type LogEntry = { ts: string; level: string; message: string };

type JobState = {
  id: string;
  commandId: string;
  status: string;
  logs: LogEntry[];
  result?: unknown;
  error?: { code: string; message: string };
};

export function JobLogPanel({
  jobId,
  onComplete,
  className,
}: {
  jobId: string | null;
  onComplete?: (job: JobState) => void;
  className?: string;
}) {
  const [job, setJob] = useState<JobState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function run() {
      for await (const state of pollJob(jobId!)) {
        if (cancelled) break;
        setJob(state);
        if (
          state.status === "success" ||
          state.status === "failed" ||
          state.status === "cancelled"
        ) {
          onComplete?.(state);
          break;
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [jobId, onComplete]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [job?.logs.length]);

  if (!jobId) return null;

  const statusColor =
    job?.status === "success"
      ? "default"
      : job?.status === "failed"
        ? "destructive"
        : "secondary";

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Job {jobId.slice(0, 8)}
        </span>
        {job && <Badge variant={statusColor}>{job.status}</Badge>}
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto bg-muted/50 border p-2 font-mono text-[11px] leading-relaxed"
      >
        {job?.logs.length === 0 && (
          <span className="text-muted-foreground">Waiting for logs...</span>
        )}
        {job?.logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-muted-foreground shrink-0">
              {new Date(log.ts).toLocaleTimeString()}
            </span>
            <span
              className={cn(
                log.level === "error" && "text-destructive",
                log.level === "warn" && "text-yellow-500"
              )}
            >
              {log.message}
            </span>
          </div>
        ))}
        {job?.error && (
          <div className="mt-1 text-destructive">
            Error: {job.error.message} ({job.error.code})
          </div>
        )}
      </div>
    </div>
  );
}
