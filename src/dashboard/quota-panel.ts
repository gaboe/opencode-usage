/**
 * Quota panel renderer for dashboard
 */

import type { QuotaSnapshot } from "../types.js";

function visibleLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padRight(str: string, len: number): string {
  const visible = visibleLength(str);
  const padding = Math.max(0, len - visible);
  return str + " ".repeat(padding);
}

function padLeft(str: string, len: number): string {
  const visible = visibleLength(str);
  const padding = Math.max(0, len - visible);
  return " ".repeat(padding) + str;
}

function renderProgressBar(used: number, width: number): string {
  const filled = Math.round(used * width);
  const empty = width - filled;

  let color = "\x1b[32m";
  if (used >= 0.8) {
    color = "\x1b[31m";
  } else if (used >= 0.5) {
    color = "\x1b[33m";
  }
  const reset = "\x1b[0m";

  const bar = color + "█".repeat(filled) + reset + "░".repeat(empty);
  const percent = `${(used * 100).toFixed(0)}%`;

  return `${bar} ${padLeft(percent, 4)}`;
}

function formatResetTime(resetAt?: number): string {
  if (!resetAt) return "";

  const now = Date.now();
  const diffMs = resetAt - now;

  if (diffMs <= 0) return "resetting...";

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours > 0) {
    return `resets in ${diffHours}h ${diffMinutes}m`;
  }
  return `resets in ${diffMinutes}m`;
}

export function renderQuotaPanel(
  quotas: QuotaSnapshot[],
  width?: number
): string {
  const effectiveWidth = width ?? 70;
  const labelWidth = 35;
  const barWidth = 35;
  const percentWidth = 5;
  const resetWidth = 22;
  const totalWidth = labelWidth + barWidth + percentWidth + resetWidth + 6;
  
  const h = "─";
  const v = "│";
  const tl = "┌";
  const tr = "┐";
  const bl = "└";
  const br = "┘";
  const ml = "├";
  const mr = "┤";

  let output = "";

  output += tl + h.repeat(totalWidth - 2) + tr + "\n";
  output += v + padRight(" QUOTAS", totalWidth - 2) + v + "\n";
  output += ml + h.repeat(totalWidth - 2) + mr + "\n";

  const grouped = new Map<string, QuotaSnapshot[]>();
  for (const quota of quotas) {
    const existing = grouped.get(quota.source) ?? [];
    existing.push(quota);
    grouped.set(quota.source, existing);
  }

  const sources = Array.from(grouped.keys()).sort();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceQuotas = grouped.get(source)!;

    output +=
      v + padRight(` ${source.toUpperCase()}`, totalWidth - 2) + v + "\n";

    for (const quota of sourceQuotas) {
      if (quota.error) {
        output +=
          v +
          padRight(`  ${quota.label}: ${quota.error}`, totalWidth - 2) +
          v +
          "\n";
      } else {
        const bar = renderProgressBar(quota.used, barWidth);
        const reset = formatResetTime(quota.resetAt);
        const label = padRight(`  ${quota.label}`, labelWidth);
        const resetPadded = padLeft(reset, resetWidth);
        
        output += v + " " + label + bar + resetPadded + " " + v + "\n";
      }
    }

    if (i < sources.length - 1) {
      output += ml + h.repeat(totalWidth - 2) + mr + "\n";
    }
  }

  output += bl + h.repeat(totalWidth - 2) + br;

  return output;
}
