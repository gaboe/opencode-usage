import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { JobLogPanel } from "@/components/job-log-panel";
import {
  Plus,
  ArrowRightLeft,
  Trash2,
  Settings2,
  AlertTriangle,
  Wifi,
  Loader2,
  Check,
  X,
  KeyRound,
  Copy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricData = {
  label: string;
  usagePercent: number;
  resetDisplay: string;
  isStale: boolean;
};

type AccountData = {
  name: string;
  active: boolean;
  metrics: MetricData[];
};

type PingStatus = "idle" | "pinging" | "ok" | "error";
type PingResult = { status: PingStatus; message: string };

type ThresholdEntry = { key: string; label: string; value: number };

type ProviderQuotaData = {
  provider: string;
  configSource: string;
  thresholds: ThresholdEntry[];
  accounts: AccountData[];
  supportsThresholdEdit: boolean;
  rawData: unknown;
};

// ---------------------------------------------------------------------------
// Reset time formatting
// ---------------------------------------------------------------------------

function formatResetTime(date: Date | null): string {
  if (!date) return "—";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isResetPassed(date: Date | null): boolean {
  if (!date) return false;
  return date.getTime() < Date.now();
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function usageColor(pct: number): string {
  if (pct >= 70) return "text-red-500";
  if (pct >= 50) return "text-yellow-500";
  return "text-green-500";
}

function barIndicatorColor(pct: number): string {
  if (pct >= 70) return "bg-red-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

function activeBorderClass(active: boolean): string {
  return active ? "ring-green-500/40" : "";
}

// ---------------------------------------------------------------------------
// Anthropic parser
// ---------------------------------------------------------------------------

function normalizeAnthropicThresholds(
  value: unknown,
  fallback: number
): { session5h: number; weekly7d: number; weekly7dSonnet: number } {
  if (typeof value === "number")
    return { session5h: value, weekly7d: value, weekly7dSonnet: value };
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    return {
      session5h: typeof v.session5h === "number" ? v.session5h : fallback,
      weekly7d: typeof v.weekly7d === "number" ? v.weekly7d : fallback,
      weekly7dSonnet:
        typeof v.weekly7dSonnet === "number" ? v.weekly7dSonnet : fallback,
    };
  }
  return { session5h: fallback, weekly7d: fallback, weekly7dSonnet: fallback };
}

function parseAnthropicQuota(data: unknown): ProviderQuotaData {
  const empty: ProviderQuotaData = {
    provider: "anthropic",
    configSource: "anthropic-multi-account-state",
    thresholds: [],
    accounts: [],
    supportsThresholdEdit: true,
    rawData: data,
  };
  if (!data || typeof data !== "object") return empty;
  const d = data as Record<string, unknown>;
  const currentAccount =
    typeof d.currentAccount === "string" ? d.currentAccount : "";
  const config =
    d.config && typeof d.config === "object"
      ? (d.config as Record<string, unknown>)
      : {};
  const t = normalizeAnthropicThresholds(config.threshold, 0.7);
  const thresholds: ThresholdEntry[] = [
    { key: "session5h", label: "5h", value: t.session5h },
    { key: "weekly7d", label: "w", value: t.weekly7d },
    { key: "weekly7dSonnet", label: "s", value: t.weekly7dSonnet },
  ];

  const usage =
    d.usage && typeof d.usage === "object"
      ? (d.usage as Record<string, unknown>)
      : {};

  const accounts: AccountData[] = Object.entries(usage).map(([name, val]) => {
    const u =
      val && typeof val === "object" ? (val as Record<string, unknown>) : {};

    const metricDefs: { label: string; key: string }[] = [
      { label: "Session 5h", key: "session5h" },
      { label: "Weekly", key: "weekly7d" },
      { label: "Sonnet", key: "weekly7dSonnet" },
    ];

    const metrics: MetricData[] = metricDefs.map(({ label, key }) => {
      const m =
        u[key] && typeof u[key] === "object"
          ? (u[key] as Record<string, unknown>)
          : {};
      const utilization = typeof m.utilization === "number" ? m.utilization : 0;
      const reset =
        typeof m.reset === "number" ? new Date(m.reset * 1000) : null;
      return {
        label,
        usagePercent: Math.round(utilization * 100),
        resetDisplay: formatResetTime(reset),
        isStale: isResetPassed(reset),
      };
    });

    return { name, active: name === currentAccount, metrics };
  });

  return { ...empty, thresholds, accounts };
}

// ---------------------------------------------------------------------------
// Codex parser
// ---------------------------------------------------------------------------

function parseCodexQuota(data: unknown): ProviderQuotaData {
  const empty: ProviderQuotaData = {
    provider: "codex",
    configSource: "codex-multi-account-accounts",
    thresholds: [],
    accounts: [],
    supportsThresholdEdit: true,
    rawData: data,
  };
  if (!data || typeof data !== "object") return empty;
  const d = data as Record<string, unknown>;
  const activeAlias = typeof d.activeAlias === "string" ? d.activeAlias : null;
  const config =
    d.config && typeof d.config === "object"
      ? (d.config as Record<string, unknown>)
      : {};
  const th5h =
    typeof config.stickyThresholdFiveHour === "number"
      ? config.stickyThresholdFiveHour
      : 0.7;
  const thW =
    typeof config.stickyThresholdWeekly === "number"
      ? config.stickyThresholdWeekly
      : 0.7;
  const thresholds: ThresholdEntry[] = [
    { key: "stickyThresholdFiveHour", label: "5h", value: th5h },
    { key: "stickyThresholdWeekly", label: "w", value: thW },
  ];

  const accts =
    d.accounts && typeof d.accounts === "object"
      ? (d.accounts as Record<string, unknown>)
      : {};

  const accounts: AccountData[] = Object.entries(accts).map(([alias, val]) => {
    const a =
      val && typeof val === "object" ? (val as Record<string, unknown>) : {};
    const rl =
      a.rateLimits && typeof a.rateLimits === "object"
        ? (a.rateLimits as Record<string, unknown>)
        : {};

    function parseWindow(w: unknown): {
      usagePercent: number;
      resetDisplay: string;
      isStale: boolean;
    } {
      if (!w || typeof w !== "object")
        return { usagePercent: 0, resetDisplay: "—", isStale: false };
      const win = w as Record<string, unknown>;
      const limit = typeof win.limit === "number" ? win.limit : 0;
      const remaining = typeof win.remaining === "number" ? win.remaining : 0;
      const resetAt =
        typeof win.resetAt === "number" ? new Date(win.resetAt) : null;
      const pct =
        limit > 0 ? Math.round(((limit - remaining) / limit) * 100) : 0;
      return {
        usagePercent: pct,
        resetDisplay: formatResetTime(resetAt),
        isStale: isResetPassed(resetAt),
      };
    }

    const fiveHour = parseWindow(rl.fiveHour);
    const weekly = parseWindow(rl.weekly);

    return {
      name: alias,
      active: alias === activeAlias,
      metrics: [
        { label: "5h Limit", ...fiveHour },
        { label: "Weekly", ...weekly },
      ],
    };
  });

  return { ...empty, thresholds, accounts };
}

// ---------------------------------------------------------------------------
// Antigravity parser
// ---------------------------------------------------------------------------

function parseAntigravityQuota(data: unknown): ProviderQuotaData {
  const empty: ProviderQuotaData = {
    provider: "antigravity",
    configSource: "antigravity-accounts",
    thresholds: [],
    accounts: [],
    supportsThresholdEdit: false,
    rawData: data,
  };
  if (!data || typeof data !== "object") return empty;
  const d = data as Record<string, unknown>;
  const activeIdx = typeof d.activeIndex === "number" ? d.activeIndex : -1;
  const accts = Array.isArray(d.accounts)
    ? (d.accounts as Array<Record<string, unknown>>)
    : [];

  const accounts: AccountData[] = accts.map((a, i) => {
    const email = typeof a.email === "string" ? a.email : `account-${i}`;
    const cachedQuota =
      a.cachedQuota && typeof a.cachedQuota === "object"
        ? (a.cachedQuota as Record<string, unknown>)
        : {};

    const metrics: MetricData[] = Object.entries(cachedQuota).map(
      ([group, val]) => {
        const q =
          val && typeof val === "object"
            ? (val as Record<string, unknown>)
            : {};
        const remaining =
          typeof q.remainingFraction === "number" ? q.remainingFraction : 1;
        const pct = Math.round((1 - remaining) * 100);
        const resetTime =
          typeof q.resetTime === "string" ? new Date(q.resetTime) : null;
        // Capitalize group label: "claude" → "Claude", "gemini-pro" → "Gemini Pro"
        const label = group
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return {
          label,
          usagePercent: pct,
          resetDisplay: formatResetTime(resetTime),
          isStale: isResetPassed(resetTime),
        };
      }
    );

    return { name: email, active: i === activeIdx, metrics };
  });

  return { ...empty, accounts };
}

// ---------------------------------------------------------------------------
// Fetch all provider data
// ---------------------------------------------------------------------------

const CONFIG_SOURCES = {
  anthropic: "anthropic-multi-account-state",
  codex: "codex-multi-account-accounts",
  antigravity: "antigravity-accounts",
} as const;

async function fetchProviderQuota(
  provider: string,
  source: string
): Promise<ProviderQuotaData> {
  const empty: ProviderQuotaData = {
    provider,
    configSource: source,
    thresholds: [],
    accounts: [],
    supportsThresholdEdit: provider !== "antigravity",
    rawData: null,
  };
  try {
    const data = await api.getConfig(source);
    if (provider === "anthropic") return parseAnthropicQuota(data);
    if (provider === "codex") return parseCodexQuota(data);
    if (provider === "antigravity") return parseAntigravityQuota(data);
    return empty;
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Threshold display
// ---------------------------------------------------------------------------

const THRESHOLD_TOOLTIPS: Record<string, string> = {
  "5h": "Session — 5-hour rolling window",
  w: "Weekly — 7-day rolling window",
  s: "Sonnet — weekly Sonnet model usage",
};

function ThresholdDisplay({ thresholds }: { thresholds: ThresholdEntry[] }) {
  if (thresholds.length === 0) return null;
  return (
    <span className="font-mono text-[10px] text-muted-foreground">
      thr{" "}
      {thresholds.map((t, i) => (
        <Tooltip key={t.key}>
          <TooltipTrigger
            render={
              <span className="underline decoration-dotted decoration-muted-foreground/40 cursor-help">
                {t.label}:{Math.round(t.value * 100)}%
                {i < thresholds.length - 1 ? "  " : ""}
              </span>
            }
          />
          <TooltipContent>
            {THRESHOLD_TOOLTIPS[t.label] ?? t.key}
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Threshold edit dialog
// ---------------------------------------------------------------------------

function ThresholdEditDialog({
  prov,
  onSaved,
}: {
  prov: ProviderQuotaData;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      prov.thresholds.map((t) => [t.key, String(Math.round(t.value * 100))])
    )
  );

  function updateValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const raw = prov.rawData as Record<string, unknown> | null;
      const base = raw ?? {};

      if (prov.provider === "anthropic") {
        const existing =
          base.config && typeof base.config === "object"
            ? { ...(base.config as Record<string, unknown>) }
            : {};
        const allSame =
          prov.thresholds.length > 1 &&
          new Set(Object.values(values)).size === 1;
        if (allSame) {
          existing.threshold = Number(Object.values(values)[0]) / 100;
        } else {
          existing.threshold = Object.fromEntries(
            prov.thresholds.map((t) => [
              t.key,
              Number(values[t.key] ?? 70) / 100,
            ])
          );
        }
        await api.putConfig(prov.configSource, { ...base, config: existing });
      } else if (prov.provider === "codex") {
        const existing =
          base.config && typeof base.config === "object"
            ? { ...(base.config as Record<string, unknown>) }
            : {};
        for (const t of prov.thresholds) {
          existing[t.key] = Number(values[t.key] ?? 70) / 100;
        }
        await api.putConfig(prov.configSource, { ...base, config: existing });
      }
      toast.success(`Thresholds updated for ${prov.provider}`);
      onSaved();
      setOpen(false);
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button variant="ghost" size="xs" className="size-5 p-0">
                  <Settings2 className="size-3" />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Edit thresholds</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {prov.provider} Thresholds
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {prov.thresholds.map((t) => (
            <div key={t.key} className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {t.label === "5h"
                  ? "Session (5h)"
                  : t.label === "w"
                    ? "Weekly"
                    : t.label === "s"
                      ? "Sonnet"
                      : t.label}{" "}
                %
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                value={values[t.key] ?? "70"}
                onChange={(e) => updateValue(t.key, e.target.value)}
                className="h-7 text-xs font-mono"
              />
            </div>
          ))}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="w-full"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add account dialog (preserved from original)
// ---------------------------------------------------------------------------

function AddAccountDialog({
  provider,
  onDone,
}: {
  provider: string;
  onDone: () => void;
}) {
  const [alias, setAlias] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    if (!alias.trim()) return;
    setLoading(true);
    try {
      const res = await api.accountAction(provider, "add", alias.trim());
      setJobId(res.jobId);
      toast.success(`Adding account "${alias}" to ${provider}...`);
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setLoading(false);
    }
  }

  function handleComplete() {
    onDone();
    setTimeout(() => {
      setOpen(false);
      setAlias("");
      setJobId(null);
    }, 1000);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button variant="ghost" size="xs">
                  <Plus className="size-3" />
                  Add
                </Button>
              }
            />
          }
        />
        <TooltipContent>Add new account</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {provider} Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Alias</label>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. work-account"
            />
          </div>
          <Button onClick={handleAdd} disabled={loading || !alias.trim()}>
            {loading ? "Adding..." : "Add"}
          </Button>
          <JobLogPanel jobId={jobId} onComplete={handleComplete} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Metric bar row
// ---------------------------------------------------------------------------
const METRIC_TOOLTIPS: Record<string, string> = {
  "Session 5h": "5-hour rolling session usage",
  Weekly: "7-day rolling usage",
  Sonnet: "Sonnet model weekly usage",
  "5h Limit": "5-hour rate limit usage",
  Claude: "Claude model group quota",
  "Gemini Pro": "Gemini Pro model group quota",
  "Gemini Flash": "Gemini Flash model group quota",
};

function MetricBar({ metric }: { metric: MetricData }) {
  const pct = Math.max(0, Math.min(100, metric.usagePercent));
  const stale = metric.isStale;
  const labelTip = METRIC_TOOLTIPS[metric.label];
  return (
    <div className={cn("flex items-center gap-2", stale && "opacity-50")}>
      {labelTip ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="w-20 shrink-0 text-[10px] text-muted-foreground truncate underline decoration-dotted decoration-muted-foreground/40 cursor-help">
                {metric.label}
              </span>
            }
          />
          <TooltipContent>{labelTip}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="w-20 shrink-0 text-[10px] text-muted-foreground truncate">
          {metric.label}
        </span>
      )}
      <Progress value={pct} className="flex-1 gap-0">
        <ProgressTrack className="h-1.5">
          <ProgressIndicator
            className={
              stale ? "bg-muted-foreground/40" : barIndicatorColor(pct)
            }
          />
        </ProgressTrack>
      </Progress>
      <span
        className={cn(
          "w-8 text-right font-mono text-[10px] tabular-nums",
          stale ? "text-muted-foreground line-through" : usageColor(pct)
        )}
      >
        {pct}%
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "w-12 text-right font-mono text-[10px] tabular-nums",
                stale ? "text-yellow-500" : "text-muted-foreground"
              )}
            >
              {stale && (
                <AlertTriangle className="inline size-2.5 mr-0.5 -mt-px" />
              )}
              ↻ {metric.resetDisplay}
            </span>
          }
        />
        <TooltipContent>
          {stale
            ? "Reset time passed — data is stale, needs refresh"
            : "Reset time"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account card
// ---------------------------------------------------------------------------

function AccountCard({
  account,
  provider,
  onRefresh,
  pingResult,
}: {
  account: AccountData;
  provider: string;
  onRefresh: () => void;
  pingResult?: PingResult;
}) {
  const [switchJobId, setSwitchJobId] = useState<string | null>(null);

  async function handleSwitch() {
    try {
      const res = await api.accountAction(provider, "switch", account.name);
      setSwitchJobId(res.jobId);
      toast.success(`Switching to "${account.name}"...`);
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async function handleRemove() {
    try {
      const res = await api.accountAction(provider, "remove", account.name);
      toast.success(`Removing "${account.name}"... (Job: ${res.jobId})`);
      onRefresh();
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const hasStaleMetrics = account.metrics.some((m) => m.isStale);

  return (
    <Card size="sm" className={cn(activeBorderClass(account.active))}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "inline-block size-1.5 shrink-0 rounded-full",
                account.active ? "bg-green-500" : "bg-muted-foreground/30"
              )}
            />
            <span className="font-mono text-xs truncate">{account.name}</span>
            {account.active && (
              <Badge
                variant="default"
                className="text-[9px] px-1 py-0 shrink-0"
              >
                ACTIVE
              </Badge>
            )}
            {hasStaleMetrics && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 shrink-0 border-yellow-500/50 text-yellow-500"
                    >
                      <AlertTriangle className="size-2.5 mr-0.5" />
                      STALE
                    </Badge>
                  }
                />
                <TooltipContent>
                  Reset time passed — cached data may be outdated
                </TooltipContent>
              </Tooltip>
            )}
            {pingResult && pingResult.status !== "idle" && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1 py-0 shrink-0",
                        pingResult.status === "pinging" &&
                          "border-blue-500/50 text-blue-500",
                        pingResult.status === "ok" &&
                          "border-green-500/50 text-green-500",
                        pingResult.status === "error" &&
                          "border-red-500/50 text-red-500"
                      )}
                    >
                      {pingResult.status === "pinging" && (
                        <Loader2 className="size-2.5 mr-0.5 animate-spin" />
                      )}
                      {pingResult.status === "ok" && (
                        <Check className="size-2.5 mr-0.5" />
                      )}
                      {pingResult.status === "error" && (
                        <X className="size-2.5 mr-0.5" />
                      )}
                      {pingResult.status === "pinging"
                        ? "PING"
                        : pingResult.status === "ok"
                          ? "PONG"
                          : "FAIL"}
                    </Badge>
                  }
                />
                <TooltipContent>{pingResult.message}</TooltipContent>
              </Tooltip>
            )}
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="xs" onClick={handleSwitch}>
                    <ArrowRightLeft className="size-3" />
                  </Button>
                }
              />
              <TooltipContent>Switch to this account</TooltipContent>
            </Tooltip>
            {(provider === "anthropic" || provider === "codex") && (
              <ReauthDialog
                provider={provider}
                accountName={account.name}
                onComplete={onRefresh}
              />
            )}
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <AlertDialogTrigger
                      render={
                        <Button variant="ghost" size="xs">
                          <Trash2 className="size-3" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent>Remove account</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove Account</AlertDialogTitle>
                  <AlertDialogDescription>
                    Remove &quot;{account.name}&quot; from {provider}? This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={handleRemove}
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {account.metrics.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">No usage data</p>
        ) : (
          account.metrics.map((m) => <MetricBar key={m.label} metric={m} />)
        )}
        {switchJobId && (
          <JobLogPanel
            jobId={switchJobId}
            onComplete={() => {
              onRefresh();
              setSwitchJobId(null);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Re-auth dialog
// ---------------------------------------------------------------------------

const API_BASE = "";

type ReauthStep =
  | "idle"
  | "generating"
  | "waiting"
  | "completing"
  | "done"
  | "error";

function ReauthDialog({
  provider,
  accountName,
  onComplete,
}: {
  provider: string;
  accountName: string;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ReauthStep>("idle");
  const [authUrl, setAuthUrl] = useState("");
  const [verifier, setVerifier] = useState("");
  const [callbackInput, setCallbackInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  function reset() {
    setStep("idle");
    setAuthUrl("");
    setVerifier("");
    setCallbackInput("");
    setErrorMsg("");
    setCopied(false);
  }

  async function pollJobResult(
    jobId: string
  ): Promise<Record<string, unknown>> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      if (!res.ok) throw new Error(`Job poll failed: ${res.status}`);
      const job = await res.json();
      if (job.status === "success")
        return job.result as Record<string, unknown>;
      if (job.status === "failed")
        throw new Error(job.error?.message ?? "Job failed");
    }
    throw new Error("Timed out waiting for job");
  }

  async function handleStart() {
    setStep("generating");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/accounts/${provider}/reauth-start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alias: accountName }),
        }
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const { jobId } = await res.json();
      const result = await pollJobResult(jobId);
      setAuthUrl(String(result.url ?? ""));
      setVerifier(String(result.verifier ?? ""));
      setStep("waiting");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  async function handleComplete() {
    if (!callbackInput.trim()) return;
    setStep("completing");
    setErrorMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/accounts/${provider}/reauth-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alias: accountName,
            callbackUrl: callbackInput.trim(),
            verifier,
          }),
        }
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const { jobId } = await res.json();
      const result = await pollJobResult(jobId);
      if (result.status === "ok") {
        setStep("done");
        toast.success(`Re-authenticated "${accountName}" successfully`);
        onComplete();
        setTimeout(() => {
          setOpen(false);
          reset();
        }, 1500);
      } else {
        setErrorMsg(String(result.message ?? "Unknown error"));
        setStep("error");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button variant="ghost" size="xs">
                  <KeyRound className="size-3" />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Re-authenticate account</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Re-authenticate &quot;{accountName}&quot;
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {step === "idle" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                This will generate a new OAuth authorization URL. Open it in
                your browser, log in, then paste the callback URL back here.
              </p>
              <Button size="sm" onClick={handleStart}>
                <ExternalLink className="size-3 mr-1.5" />
                Generate Auth URL
              </Button>
            </div>
          )}

          {step === "generating" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Generating authorization URL…
            </div>
          )}

          {step === "waiting" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  1. Open this URL in your browser:
                </p>
                <div className="flex items-center gap-1.5">
                  <Input
                    readOnly
                    value={authUrl}
                    className="text-[10px] font-mono flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs font-medium">
                2. Log in and authorize access
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  3. Paste the callback URL here:
                </p>
                <Input
                  placeholder="https://console.anthropic.com/oauth/code/callback?code=..."
                  value={callbackInput}
                  onChange={(e) => setCallbackInput(e.target.value)}
                  className="text-[10px] font-mono"
                />
              </div>
              <Button
                size="sm"
                onClick={handleComplete}
                disabled={!callbackInput.trim()}
              >
                Complete Re-auth
              </Button>
            </div>
          )}

          {step === "completing" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Exchanging tokens…
            </div>
          )}

          {step === "done" && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <Check className="size-3" />
              Re-authenticated successfully
            </div>
          )}

          {step === "error" && (
            <div className="space-y-2">
              <p className="text-xs text-destructive">{errorMsg}</p>
              <Button variant="outline" size="sm" onClick={reset}>
                Try Again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Provider section
// ---------------------------------------------------------------------------

function ProviderSection({
  prov,
  onRefresh,
  pingResults,
  setPingResults,
}: {
  prov: ProviderQuotaData;
  onRefresh: () => void;
  pingResults: Record<string, PingResult>;
  setPingResults: (results: Record<string, PingResult>) => void;
}) {
  const pingAbort = useRef<AbortController | null>(null);

  async function pollJob(jobId: string): Promise<PingResult> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const job = await api.getJob(jobId);
        if (job.status === "success") {
          const result = job.result as
            | { status: string; message: string }
            | undefined;
          const pingStatus = result?.status === "error" ? "error" : "ok";
          const pingMessage =
            result?.message ?? (pingStatus === "ok" ? "pong" : "unknown error");
          console.log(`[ping] ${pingStatus}: ${pingMessage}`, result);
          return { status: pingStatus, message: pingMessage };
        }
        if (job.status === "failed") {
          return {
            status: "error",
            message: job.error?.message ?? "failed",
          };
        }
      } catch {
        return { status: "error", message: "poll failed" };
      }
    }
    return { status: "error", message: "timeout" };
  }

  async function handlePingAll() {
    if (prov.accounts.length === 0) return;
    pingAbort.current?.abort();
    const ctrl = new AbortController();
    pingAbort.current = ctrl;

    // Mark all as pinging
    const initial: Record<string, PingResult> = {};
    for (const acc of prov.accounts) {
      initial[acc.name] = { status: "pinging", message: "pinging…" };
    }
    setPingResults(initial);

    // Fire all pings in parallel
    const entries = await Promise.all(
      prov.accounts.map(async (acc) => {
        try {
          const { jobId } = await api.accountAction(
            prov.provider,
            "ping",
            acc.name
          );
          const result = await pollJob(jobId);
          return [acc.name, result] as const;
        } catch (err) {
          return [
            acc.name,
            {
              status: "error" as const,
              message: err instanceof Error ? err.message : String(err),
            },
          ] as const;
        }
      })
    );

    if (ctrl.signal.aborted) return;
    setPingResults(Object.fromEntries(entries));
    // Delay refresh so user sees PONG/FAIL badges before data reloads
    setTimeout(onRefresh, 1500);
  }

  return (
    <div className="space-y-2">
      {/* Provider header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider">
            ▸ {prov.provider}
          </h4>
          <ThresholdDisplay thresholds={prov.thresholds} />
          {prov.supportsThresholdEdit && prov.thresholds.length > 0 && (
            <ThresholdEditDialog prov={prov} onSaved={onRefresh} />
          )}
        </div>
        <div className="flex items-center gap-1">
          {prov.accounts.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handlePingAll}
                    disabled={Object.values(pingResults).some(
                      (r) => r.status === "pinging"
                    )}
                  >
                    <Wifi className="size-3" />
                    Ping
                  </Button>
                }
              />
              <TooltipContent>
                Ping all accounts to verify connectivity
              </TooltipContent>
            </Tooltip>
          )}
          <AddAccountDialog provider={prov.provider} onDone={onRefresh} />
        </div>
      </div>

      {/* Account cards grid */}
      {prov.accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-4">No accounts</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {prov.accounts.map((acc) => (
            <AccountCard
              key={acc.name}
              account={acc}
              provider={prov.provider}
              onRefresh={onRefresh}
              pingResult={pingResults[acc.name]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Per-provider loading hook with stale-while-revalidate + auto-refresh. */
function useProviderQuota(
  provider: string,
  source: string,
  intervalMs: number
) {
  const fetcher = useCallback(
    () => fetchProviderQuota(provider, source),
    [provider, source]
  );
  const { data, status, refetch } = useAsync<ProviderQuotaData>(fetcher, [
    provider,
    source,
  ]);

  // Stale-while-revalidate: keep last data during refetch
  const lastData = useRef<ProviderQuotaData | null>(null);
  if (data) lastData.current = data;

  // Auto-refresh
  useEffect(() => {
    const id = setInterval(() => void refetch(), intervalMs);
    return () => clearInterval(id);
  }, [refetch, intervalMs]);

  return {
    data: data ?? lastData.current,
    isInitialLoad: status === "loading" && !lastData.current,
    refetch,
  };
}

const PROVIDERS = Object.entries(CONFIG_SOURCES) as [string, string][];
const REFRESH_INTERVAL = 5 * 60_000; // 5 minutes

export function AccountsSection() {
  // Ping results lifted here so they survive refetch-induced remounts
  const [allPingResults, setAllPingResults] = useState<
    Record<string, Record<string, PingResult>>
  >({});

  return (
    <div className="space-y-6">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        ■ Quota Status
      </h3>
      {PROVIDERS.map(([provider, source]) => (
        <ProviderLoader
          key={provider}
          provider={provider}
          source={source}
          pingResults={allPingResults[provider] ?? {}}
          setPingResults={(results) =>
            setAllPingResults((prev) => ({ ...prev, [provider]: results }))
          }
        />
      ))}
    </div>
  );
}

/** Wrapper that fetches one provider independently and shows skeleton while loading. */
function ProviderLoader({
  provider,
  source,
  pingResults,
  setPingResults,
}: {
  provider: string;
  source: string;
  pingResults: Record<string, PingResult>;
  setPingResults: (results: Record<string, PingResult>) => void;
}) {
  const { data, isInitialLoad, refetch } = useProviderQuota(
    provider,
    source,
    REFRESH_INTERVAL
  );

  if (isInitialLoad) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {[1, 2].map((k) => (
            <Card key={k} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Skeleton className="size-1.5 rounded-full" />
                  <Skeleton className="h-3.5 w-28" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {[1, 2, 3].map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className="h-1.5 flex-1" />
                    <Skeleton className="h-2.5 w-8" />
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <ProviderSection
      prov={data}
      onRefresh={refetch}
      pingResults={pingResults}
      setPingResults={setPingResults}
    />
  );
}
