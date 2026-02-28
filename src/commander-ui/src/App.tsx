import { useState, useEffect, useMemo, useCallback } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { parseUsageRows } from "@/lib/data-utils";
import { HeaderBar } from "@/components/header-bar";
import { UsageSection } from "@/sections/usage-section";
import { AccountsSection } from "@/sections/accounts-section";

type HealthStatus = {
  status: string;
  version: string;
  timestamp: string;
} | null;

function useHealth(intervalMs = 5000) {
  const [health, setHealth] = useState<HealthStatus>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await api.health();
        if (!cancelled) {
          setHealth(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void poll();
    const id = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { health, error };
}

export default function App() {
  const { health, error: healthError } = useHealth();

  const [provider, setProvider] = useState("all");
  const [days, setDays] = useState("1");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const usageParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (provider !== "all") params.provider = provider;
    if (days) params.days = days;
    if (since) params.since = since;
    if (until) params.until = until;
    return params;
  }, [provider, days, since, until]);

  const fetchUsage = useCallback(() => api.usage(usageParams), [usageParams]);

  const usage = useAsync<unknown>(fetchUsage, [usageParams]);

  const dailyRows = useMemo(() => parseUsageRows(usage.data), [usage.data]);

  return (
    <div className="grid h-screen grid-rows-[auto_2fr_1fr] bg-background text-foreground">
      <HeaderBar
        health={health}
        healthError={healthError}
        onRefresh={() => usage.refetch()}
      />

      {/* Accounts — top 2/3 */}
      <div className="overflow-auto border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <ErrorBoundary>
            <AccountsSection />
          </ErrorBoundary>
        </div>
      </div>

      {/* Usage — bottom 1/3 */}
      <div className="overflow-auto">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <ErrorBoundary>
            <UsageSection
              dailyRows={dailyRows}
              usageStatus={usage.status}
              usageError={usage.status === "error" ? usage.error : null}
              onRefetch={() => usage.refetch()}
              filters={{ provider, days, since, until }}
              onFilterChange={{
                setProvider,
                setDays,
                setSince,
                setUntil,
              }}
            />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
