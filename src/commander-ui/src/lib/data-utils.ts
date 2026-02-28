export type ProviderDetail = {
  provider: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
  cost: number;
  models: string[];
};

export type UsageRow = {
  date: string;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  providers: string[];
  providerDetails: ProviderDetail[];
  cacheWrite: number;
  cacheRead: number;
  reasoning: number;
};

export type QuotaEntry = {
  provider: string;
  used: number;
  limit: number;
  percentage: number;
};

export function parseUsageRows(data: unknown): UsageRow[] {
  if (!data || !Array.isArray(data)) return [];
  return data
    .map((r: Record<string, unknown>) => {
      const providerStats =
        r.providerStats && typeof r.providerStats === "object"
          ? (r.providerStats as Record<string, Record<string, unknown>>)
          : {};

      const providerDetails: ProviderDetail[] = Object.entries(
        providerStats
      ).map(([id, ps]) => ({
        provider: id,
        input: Number(ps.input ?? 0),
        output: Number(ps.output ?? 0),
        cacheWrite: Number(ps.cacheWrite ?? 0),
        cacheRead: Number(ps.cacheRead ?? 0),
        reasoning: Number(ps.reasoning ?? 0),
        cost: Number(ps.cost ?? 0),
        models: Array.isArray(ps.models) ? (ps.models as string[]) : [],
      }));

      return {
        date: String(r.date ?? ""),
        models: Array.isArray(r.models)
          ? (r.models as string[])
          : [String(r.model ?? "")],
        inputTokens: Number(r.inputTokens ?? r.input ?? 0),
        outputTokens: Number(r.outputTokens ?? r.output ?? 0),
        totalTokens: Number(r.totalTokens ?? r.total_tokens ?? 0),
        cost: Number(r.cost ?? 0),
        providers: Array.isArray(r.providers) ? (r.providers as string[]) : [],
        providerDetails,
        cacheWrite: Number(r.cacheWrite ?? 0),
        cacheRead: Number(r.cacheRead ?? 0),
        reasoning: Number(r.reasoning ?? 0),
      };
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
}

export function parseQuotaEntries(data: unknown): QuotaEntry[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map((q: Record<string, unknown>) => ({
      provider: String(q.provider ?? ""),
      used: Number(q.used ?? 0),
      limit: Number(q.limit ?? 0),
      percentage: Number(q.percentage ?? 0),
    }));
  }
  if (typeof data === "object" && data !== null) {
    return Object.entries(data as Record<string, unknown>).map(([key, val]) => {
      const v = val as Record<string, unknown>;
      return {
        provider: key,
        used: Number(v.used ?? 0),
        limit: Number(v.limit ?? 0),
        percentage: Number(v.percentage ?? 0),
      };
    });
  }
  return [];
}

export function aggregateMonthly(rows: UsageRow[]): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const existing = map.get(month);
    if (existing) {
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.totalTokens += row.totalTokens;
      existing.cost += row.cost;
      existing.cacheWrite += row.cacheWrite;
      existing.cacheRead += row.cacheRead;
      existing.reasoning += row.reasoning;
      for (const m of row.models) {
        if (!existing.models.includes(m)) existing.models.push(m);
      }
      for (const p of row.providers) {
        if (!existing.providers.includes(p)) existing.providers.push(p);
      }
      // Merge provider details
      for (const pd of row.providerDetails) {
        const ep = existing.providerDetails.find(
          (e) => e.provider === pd.provider
        );
        if (ep) {
          ep.input += pd.input;
          ep.output += pd.output;
          ep.cacheWrite += pd.cacheWrite;
          ep.cacheRead += pd.cacheRead;
          ep.reasoning += pd.reasoning;
          ep.cost += pd.cost;
          for (const m of pd.models) {
            if (!ep.models.includes(m)) ep.models.push(m);
          }
        } else {
          existing.providerDetails.push({ ...pd, models: [...pd.models] });
        }
      }
    } else {
      map.set(month, {
        ...row,
        date: month,
        models: [...row.models],
        providers: [...row.providers],
        providerDetails: row.providerDetails.map((pd) => ({
          ...pd,
          models: [...pd.models],
        })),
      });
    }
  }
  return Array.from(map.values());
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
