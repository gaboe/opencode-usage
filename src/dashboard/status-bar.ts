/**
 * Status bar renderer for dashboard
 */

export type StatusInfo = {
  lastUpdate: number;
  refreshInterval: number;
  daysFilter?: number;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function renderStatusBar(info: StatusInfo, width?: number): string {
  const totalWidth = width ?? 80;

  const lastUpdateStr = `Last update: ${formatTime(info.lastUpdate)}`;
  const intervalStr = `Refresh: ${info.refreshInterval}s`;
  const daysStr = info.daysFilter ? `Days: ${info.daysFilter}` : "Days: all";
  const hints = "t: today | w: week | m: month | a: all | Ctrl+C: exit";

  const leftPart = `${lastUpdateStr}  ${intervalStr}  ${daysStr}`;
  const padding = totalWidth - leftPart.length - hints.length;

  if (padding < 2) {
    return `${leftPart} ${hints}`;
  }

  return `${leftPart}${" ".repeat(padding)}${hints}`;
}
