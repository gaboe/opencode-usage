import { useState, useMemo, Fragment } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  type UsageRow,
  type ProviderDetail,
  aggregateMonthly,
  formatNumber,
  formatCost,
} from "@/lib/data-utils";
import { RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDERS = ["all", "anthropic", "antigravity", "codex"] as const;

type UsageSectionProps = {
  dailyRows: UsageRow[];
  usageStatus: string;
  usageError: Error | null;
  onRefetch: () => void;
  filters: {
    provider: string;
    days: string;
    since: string;
    until: string;
  };
  onFilterChange: {
    setProvider: (v: string) => void;
    setDays: (v: string) => void;
    setSince: (v: string) => void;
    setUntil: (v: string) => void;
  };
};

function ProviderRow({ detail }: { detail: ProviderDetail }) {
  const total = detail.input + detail.output;
  return (
    <TableRow className="bg-muted/20 hover:bg-muted/30">
      <TableCell />
      <TableCell className="pl-6">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          [{detail.provider}]
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground">
          {detail.models.join(", ")}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(detail.input)}
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(detail.output)}
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(total)}
      </TableCell>
      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatCost(detail.cost)}
      </TableCell>
    </TableRow>
  );
}

function CacheRow({ row }: { row: UsageRow }) {
  const hasCacheOrReasoning =
    row.cacheWrite > 0 || row.cacheRead > 0 || row.reasoning > 0;
  if (!hasCacheOrReasoning) return null;
  return (
    <TableRow className="bg-muted/10 hover:bg-muted/20">
      <TableCell />
      <TableCell className="pl-6">
        <span className="text-[10px] text-muted-foreground/70 italic">
          {row.cacheWrite > 0 && `cache-write: ${formatNumber(row.cacheWrite)}`}
          {row.cacheWrite > 0 && (row.cacheRead > 0 || row.reasoning > 0)
            ? "  "
            : ""}
          {row.cacheRead > 0 && `cache-read: ${formatNumber(row.cacheRead)}`}
          {row.cacheRead > 0 && row.reasoning > 0 ? "  " : ""}
          {row.reasoning > 0 && `reasoning: ${formatNumber(row.reasoning)}`}
        </span>
      </TableCell>
      <TableCell colSpan={4} />
    </TableRow>
  );
}

function UsageTable({ rows }: { rows: UsageRow[] }) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs py-4">No usage data</p>;
  }

  const totals = {
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    totalTokens: rows.reduce((s, r) => s + r.totalTokens, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
  };

  function toggleRow(date: string) {
    setExpandedDate((prev) => (prev === date ? null : date));
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Models</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const expanded = expandedDate === row.date;
          const hasDetails = row.providerDetails.length > 0;
          return (
            <Fragment key={row.date}>
              <TableRow
                className={cn(
                  hasDetails && "cursor-pointer",
                  expanded && "bg-accent/50"
                )}
                onClick={() => hasDetails && toggleRow(row.date)}
              >
                <TableCell className="font-mono">
                  <span className="flex items-center gap-1">
                    {hasDetails &&
                      (expanded ? (
                        <ChevronDown className="size-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3 text-muted-foreground" />
                      ))}
                    {row.date}
                  </span>
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  {row.models.join(", ")}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumber(row.inputTokens)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumber(row.outputTokens)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumber(row.totalTokens)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCost(row.cost)}
                </TableCell>
              </TableRow>
              {expanded &&
                row.providerDetails.map((pd) => (
                  <ProviderRow key={pd.provider} detail={pd} />
                ))}
              {expanded && <CacheRow row={row} />}
            </Fragment>
          );
        })}
        {/* Total */}
        <TableRow className="border-t-2 border-border bg-muted/30">
          <TableCell className="font-mono font-semibold">Total</TableCell>
          <TableCell />
          <TableCell className="text-right font-mono tabular-nums font-semibold">
            {formatNumber(totals.inputTokens)}
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums font-semibold">
            {formatNumber(totals.outputTokens)}
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums font-semibold">
            {formatNumber(totals.totalTokens)}
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums font-semibold">
            {formatCost(totals.cost)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function UsageSection({
  dailyRows,
  usageStatus,
  usageError,
  onRefetch,
  filters,
  onFilterChange,
}: UsageSectionProps) {
  const [view, setView] = useState<"daily" | "monthly">("daily");
  const monthlyRows = useMemo(() => aggregateMonthly(dailyRows), [dailyRows]);
  const rows = view === "daily" ? dailyRows : monthlyRows;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          ■ Usage Breakdown
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefetch}
          className="size-7 p-0"
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
            Provider
          </label>
          <Select
            value={filters.provider}
            onValueChange={(v) => v && onFilterChange.setProvider(v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p === "all" ? "All Providers" : p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
            Days
          </label>
          <Input
            type="number"
            value={filters.days}
            onChange={(e) => onFilterChange.setDays(e.target.value)}
            className="w-20 tabular-nums"
            min={1}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
            Since
          </label>
          <Input
            type="date"
            value={filters.since}
            onChange={(e) => onFilterChange.setSince(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
            Until
          </label>
          <Input
            type="date"
            value={filters.until}
            onChange={(e) => onFilterChange.setUntil(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="ml-auto flex gap-px">
          <Button
            variant={view === "daily" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("daily")}
          >
            Daily
          </Button>
          <Button
            variant={view === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("monthly")}
          >
            Monthly
          </Button>
        </div>
      </div>

      {/* Usage table */}
      {usageStatus === "loading" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Models</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((k) => (
              <TableRow key={k}>
                <TableCell>
                  <Skeleton className="h-3.5 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3.5 w-40" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-3.5 w-20" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-3.5 w-16" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-3.5 w-20" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-3.5 w-14" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {usageStatus === "error" && usageError && (
        <Card>
          <CardContent className="py-3 flex items-center justify-between">
            <p className="text-destructive text-xs">
              Failed to load usage: {usageError.message}
            </p>
            <Button variant="outline" size="sm" onClick={onRefetch}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {usageStatus === "success" && <UsageTable rows={rows} />}
    </div>
  );
}
