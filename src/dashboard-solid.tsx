import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, onMount, For, Show } from "solid-js";
import type {
  DailyStats,
  QuotaSnapshot,
  CodexThresholds,
  MultiAccountThresholds,
  MessageJson,
  CursorState,
} from "./types.js";
import { aggregateByDate } from "./aggregator.js";
import {
  loadMessages,
  loadRecentMessages,
  loadMessagesIncremental,
  createCursor,
  getOpenCodeStoragePath,
} from "./loader.js";
import {
  loadMultiAccountQuota,
  loadMultiAccountThresholds,
  loadAntigravityQuota,
} from "./quota-loader.js";
import { loadCodexQuota, loadCodexThresholds } from "./codex-client.js";

type DashboardProps = {
  providerFilter?: string;
  initialDays?: number;
  refreshInterval?: number;
};

const COLORS = {
  bg: {
    primary: "#0a0e1a",
    secondary: "#151b2e",
    accent: "#1e2842",
  },
  text: {
    primary: "#e2e8f0",
    secondary: "#94a3b8",
    muted: "#64748b",
  },
  accent: {
    teal: "#14b8a6",
    amber: "#f59e0b",
    red: "#ef4444",
    cyan: "#06b6d4",
  },
  border: "#334155",
};

const padLeft = (str: string, width: number) => str.padStart(width, " ");
const padRight = (str: string, width: number) => str.padEnd(width, " ");
const truncateText = (str: string, width: number) => {
  if (width <= 0) return "";
  if (str.length <= width) return str;
  if (width <= 3) return str.slice(0, width);
  return `${str.slice(0, width - 3)}...`;
};

function UsageTable(props: {
  stats: Map<string, DailyStats>;
  pageOffset: number;
  daysFilter: number;
  internalScroll: number;
  maxVisibleDays: number;
  isLoading: boolean;
  isSelected: boolean;
  width?: number | "auto" | `${number}%`;
}) {
  const getWindowedData = () => {
    const allEntries = Array.from(props.stats.entries());
    const sortedByDateDesc = allEntries.sort((a, b) =>
      b[0].localeCompare(a[0])
    );
    const afterScrollOffset = sortedByDateDesc.slice(props.pageOffset);
    const requestedDays = props.daysFilter === 0 ? 10 : props.daysFilter;
    return afterScrollOffset.slice(0, requestedDays);
  };

  const statsArray = () => {
    const windowedData = getWindowedData();
    return windowedData.slice(
      props.internalScroll,
      props.internalScroll + props.maxVisibleDays
    );
  };

  const totalDaysInWindow = () => getWindowedData().length;

  const formatNum = (n: number) => n.toLocaleString("en-US");
  const formatCost = (c: number) => `$${c.toFixed(2)}`;

  const formatDateRange = () => {
    const windowedData = getWindowedData();
    if (windowedData.length === 0) return "";

    const firstDate = windowedData[0][0];
    const lastDate = windowedData[windowedData.length - 1][0];

    if (props.daysFilter === 1) {
      return firstDate;
    }

    if (props.daysFilter === 7) {
      const start = new Date(firstDate);
      const end = new Date(lastDate);
      const monthName = start.toLocaleDateString("en-US", { month: "short" });
      return `${monthName} ${start.getDate()}-${end.getDate()}`;
    }

    if (props.daysFilter === 30) {
      const start = new Date(firstDate);
      const end = new Date(lastDate);
      const startMonth = start.toLocaleDateString("en-US", { month: "short" });
      const endMonth = end.toLocaleDateString("en-US", { month: "short" });

      if (startMonth === endMonth) {
        return `${startMonth} ${start.getDate()}-${end.getDate()}`;
      }
      return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
    }

    if (firstDate === lastDate) {
      return firstDate;
    }

    const start = new Date(firstDate);
    const end = new Date(lastDate);
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  };

  const totalStats = () => {
    const windowedData = getWindowedData();
    let totalTokens = 0;
    let totalCost = 0;

    windowedData.forEach(([_, stat]) => {
      totalTokens += stat.input + stat.output;
      totalCost += stat.cost;
    });

    return { tokens: totalTokens, cost: totalCost };
  };

  return (
    <box
      border
      borderStyle="single"
      borderColor={props.isSelected ? COLORS.accent.teal : COLORS.border}
      width={props.width ?? "49%"}
      height="auto"
      flexGrow={1}
      backgroundColor={COLORS.bg.secondary}
      padding={0}
    >
      <box flexDirection="column">
        <box paddingBottom={0} paddingLeft={1}>
          <text fg={COLORS.accent.teal}>
            <b>■ USAGE BREAKDOWN</b>
            {statsArray().length > 0 && (
              <span style={{ fg: COLORS.text.muted }}>
                {" "}
                ({formatDateRange()})
              </span>
            )}
            {totalDaysInWindow() > props.maxVisibleDays && (
              <span style={{ fg: COLORS.text.muted }}>
                {" "}
                [{props.internalScroll + 1}-
                {Math.min(
                  props.internalScroll + props.maxVisibleDays,
                  totalDaysInWindow()
                )}{" "}
                of {totalDaysInWindow()}]
              </span>
            )}
            {props.isLoading && (
              <span style={{ fg: COLORS.accent.amber }}> ⟳ Loading...</span>
            )}
          </text>
        </box>

        <box
          paddingTop={1}
          paddingBottom={1}
          border-bottom
          borderColor={COLORS.border}
        >
          <text fg={COLORS.text.muted} wrapMode="none">
            <b>
              {padRight("DATE", 18)}
              {padLeft("TOKENS", 13)}
              {padLeft("COST", 10)}
            </b>
          </text>
        </box>

        <For each={statsArray()}>
          {([dateKey, stat], index) => {
            const isLast = index() === statsArray().length - 1;
            const isEven = index() % 2 === 0;
            const providers = Array.from(stat.providerStats.entries());

            return (
              <>
                <box
                  paddingTop={0.5}
                  paddingBottom={providers.length > 0 ? 0.25 : 0.5}
                  backgroundColor={
                    isEven ? COLORS.bg.secondary : COLORS.bg.accent
                  }
                >
                  <text overflow="hidden" wrapMode="none">
                    <span style={{ fg: COLORS.text.primary, bold: true }}>
                      {padRight(dateKey, 18)}
                    </span>
                    <span style={{ fg: COLORS.accent.cyan, bold: true }}>
                      {padLeft(formatNum(stat.input + stat.output), 13)}
                    </span>
                    <span style={{ fg: COLORS.accent.amber, bold: true }}>
                      {padLeft(formatCost(stat.cost), 10)}
                    </span>
                  </text>
                </box>

                <For each={providers}>
                  {([providerId, providerStat], pIndex) => {
                    const isLastProvider = pIndex() === providers.length - 1;
                    return (
                      <box
                        paddingTop={0.25}
                        paddingBottom={isLastProvider ? 0.5 : 0.25}
                        paddingLeft={2}
                        backgroundColor={
                          isEven ? COLORS.bg.secondary : COLORS.bg.accent
                        }
                      >
                        <text overflow="hidden" wrapMode="none">
                          <span style={{ fg: COLORS.text.muted }}>
                            {padRight(`[${providerId}]`, 18)}
                          </span>
                          <span style={{ fg: COLORS.accent.cyan }}>
                            {padLeft(
                              formatNum(
                                providerStat.input + providerStat.output
                              ),
                              13
                            )}
                          </span>
                          <span style={{ fg: COLORS.accent.amber }}>
                            {padLeft(formatCost(providerStat.cost), 10)}
                          </span>
                        </text>
                      </box>
                    );
                  }}
                </For>

                {!isLast && (
                  <box height={1} border-bottom borderColor={COLORS.border} />
                )}
              </>
            );
          }}
        </For>

        <box
          paddingTop={1}
          paddingBottom={0.5}
          border-top
          borderColor={COLORS.border}
        >
          <text wrapMode="none">
            <span style={{ fg: COLORS.accent.teal, bold: true }}>
              {padRight("TOTAL", 18)}
            </span>
            <span style={{ fg: COLORS.accent.cyan, bold: true }}>
              {padLeft(formatNum(totalStats().tokens), 13)}
            </span>
            <span style={{ fg: COLORS.accent.amber, bold: true }}>
              {padLeft(formatCost(totalStats().cost), 10)}
            </span>
          </text>
        </box>
      </box>
    </box>
  );
}

function QuotaPanel(props: {
  quotas: QuotaSnapshot[];
  isSelected: boolean;
  width?: number | "auto" | `${number}%`;
  twoColumns?: boolean;
  anthropicThresholds?: MultiAccountThresholds | null;
  codexThresholds?: CodexThresholds | null;
}) {
  const renderBar = (used: number, width: number = 30) => {
    const filled = Math.round(used * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  };

  const getColor = (used: number) => {
    if (used >= 0.8) return COLORS.accent.red;
    if (used >= 0.5) return COLORS.accent.amber;
    return COLORS.accent.teal;
  };

  const formatResetTime = (resetAt?: number, compact: boolean = false) => {
    if (!resetAt) return "";
    const resetDate = new Date(resetAt * 1000);
    const now = new Date();

    if (resetDate <= now) return compact ? "⟳ reset" : "⟳ resetting...";

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);

    const hours = resetDate.getHours().toString().padStart(2, "0");
    const mins = resetDate.getMinutes().toString().padStart(2, "0");

    if (resetDate >= today && resetDate < tomorrow) {
      return compact ? `↻ ${hours}:${mins}` : `↻ today ${hours}:${mins}`;
    }
    if (resetDate >= tomorrow && resetDate < dayAfter) {
      return compact ? `↻ tmr ${hours}:${mins}` : `↻ tomorrow ${hours}:${mins}`;
    }

    const day = resetDate.getDate().toString().padStart(2, "0");
    const month = (resetDate.getMonth() + 1).toString().padStart(2, "0");
    return compact
      ? `↻ ${day}.${month}`
      : `↻ ${day}.${month}. ${hours}:${mins}`;
  };

  const groupedQuotas = () => {
    const groups = new Map<string, QuotaSnapshot[]>();
    props.quotas.forEach((q) => {
      if (!groups.has(q.source)) groups.set(q.source, []);
      groups.get(q.source)!.push(q);
    });
    return Array.from(groups.entries());
  };

  return (
    <box
      border
      borderStyle="single"
      borderColor={props.isSelected ? COLORS.accent.teal : COLORS.border}
      width={props.width ?? "49%"}
      height="auto"
      flexGrow={1}
      backgroundColor={COLORS.bg.secondary}
      padding={0}
    >
      <box flexDirection="column">
        <box paddingBottom={0} paddingLeft={1}>
          <text fg={COLORS.accent.teal}>
            <b>■ QUOTA STATUS</b>
          </text>
        </box>

        <For each={groupedQuotas()}>
          {([source, quotas]) => {
            const groupByAccount = () => {
              const groups: Map<string, QuotaSnapshot[]> = new Map();
              quotas.forEach((q) => {
                const accountName = q.label.split(" - ")[0];
                if (!groups.has(accountName)) groups.set(accountName, []);
                groups.get(accountName)!.push(q);
              });
              return Array.from(groups.entries());
            };

            return (
              <box flexDirection="column" paddingTop={0} flexShrink={0} gap={0}>
                <box flexShrink={0} paddingTop={1} paddingBottom={0}>
                  <box flexDirection="column" flexShrink={0}>
                    <text
                      fg={COLORS.text.primary}
                      flexShrink={0}
                      wrapMode="none"
                    >
                      <b>▸ {source.toUpperCase()}</b>
                    </text>
                    <Show
                      when={source === "anthropic" && props.anthropicThresholds}
                    >
                      <text
                        fg={COLORS.text.muted}
                        flexShrink={0}
                        wrapMode="none"
                      >
                        {`  thr 5h:${Math.round((props.anthropicThresholds?.session5h ?? 0.7) * 100)}%  w:${Math.round((props.anthropicThresholds?.weekly7d ?? 0.7) * 100)}%  s:${Math.round((props.anthropicThresholds?.weekly7dSonnet ?? 0.7) * 100)}%`}
                      </text>
                    </Show>
                    <Show when={source === "codex" && props.codexThresholds}>
                      <text
                        fg={COLORS.text.muted}
                        flexShrink={0}
                        wrapMode="none"
                      >
                        {`  thr 5h:${Math.round((props.codexThresholds?.fiveHour ?? 0.7) * 100)}%  w:${Math.round((props.codexThresholds?.weekly ?? 0.7) * 100)}%`}
                      </text>
                    </Show>
                  </box>
                </box>

                <For
                  each={(() => {
                    const entries = groupByAccount();
                    if (!props.twoColumns) {
                      return entries.map((entry) => [entry]);
                    }
                    const rows: Array<Array<(typeof entries)[number]>> = [];
                    for (let i = 0; i < entries.length; i += 2) {
                      rows.push(entries.slice(i, i + 2));
                    }
                    return rows;
                  })()}
                >
                  {(row) => (
                    <box
                      flexDirection={props.twoColumns ? "row" : "column"}
                      gap={props.twoColumns ? 1 : 0}
                    >
                      <For each={row}>
                        {([accountName, accountQuotas]) => {
                          const isActive = accountName.includes("[ACTIVE]");
                          const cleanName = accountName
                            .replace(" [ACTIVE]", "")
                            .trim();
                          const displayAccountName = props.twoColumns
                            ? truncateText(cleanName, isActive ? 15 : 22)
                            : cleanName;

                          return (
                            <box
                              flexDirection="column"
                              flexShrink={0}
                              marginBottom={0}
                              paddingTop={0}
                              paddingBottom={0}
                              paddingLeft={1}
                              paddingRight={1}
                              marginLeft={0}
                              marginRight={0}
                              border
                              borderStyle="rounded"
                              borderColor={isActive ? "#14b8a6" : "#334155"}
                              flexGrow={1}
                            >
                              <box paddingBottom={0} flexShrink={0}>
                                <text flexShrink={0} wrapMode="none">
                                  {isActive ? (
                                    <>
                                      <span
                                        style={{
                                          fg: COLORS.accent.teal,
                                          bold: true,
                                        }}
                                      >
                                        ● {displayAccountName}
                                      </span>
                                      <span style={{ fg: COLORS.accent.teal }}>
                                        {" "}
                                        (ACTIVE)
                                      </span>
                                    </>
                                  ) : (
                                    <span
                                      style={{
                                        fg: COLORS.text.primary,
                                        bold: true,
                                      }}
                                    >
                                      {displayAccountName}
                                    </span>
                                  )}
                                </text>
                              </box>

                              <For each={accountQuotas}>
                                {(quota) => {
                                  const rawDisplayLabel = quota.label
                                    .replace(accountName, "")
                                    .replace(/^[\s-]+/, "")
                                    .trim();
                                  const displayLabel =
                                    rawDisplayLabel || "Status";

                                  const compact = Boolean(props.twoColumns);
                                  const labelWidth = compact ? 10 : 15;
                                  const barWidth = compact ? 10 : 20;
                                  const displayLabelText = compact
                                    ? truncateText(displayLabel, labelWidth)
                                    : displayLabel;
                                  const resetText = formatResetTime(
                                    quota.resetAt,
                                    compact
                                  );
                                  const compactResetText = resetText;
                                  const errorText = compact
                                    ? truncateText(
                                        `${displayLabel}: ${quota.error ?? "Error"}`,
                                        28
                                      )
                                    : `${displayLabel}: ${quota.error}`;

                                  return (
                                    <Show
                                      when={!quota.error}
                                      fallback={
                                        <box paddingLeft={1} flexShrink={0}>
                                          <text fg={COLORS.accent.red}>
                                            ✗ {errorText}
                                          </text>
                                        </box>
                                      }
                                    >
                                      <box paddingLeft={1} flexShrink={0}>
                                        <text wrapMode="none">
                                          <span
                                            style={{
                                              fg: COLORS.text.secondary,
                                            }}
                                          >
                                            {padRight(
                                              displayLabelText,
                                              labelWidth
                                            )}
                                          </span>
                                          <span
                                            style={{ fg: getColor(quota.used) }}
                                          >
                                            {renderBar(quota.used, barWidth)}
                                          </span>
                                          <span
                                            style={{ fg: COLORS.text.primary }}
                                          >
                                            {" "}
                                            {padLeft(
                                              (quota.used * 100).toFixed(0) +
                                                "%",
                                              4
                                            )}
                                          </span>
                                          <span
                                            style={{ fg: COLORS.text.muted }}
                                          >
                                            {" "}
                                            {compactResetText}
                                          </span>
                                        </text>
                                      </box>
                                    </Show>
                                  );
                                }}
                              </For>
                            </box>
                          );
                        }}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            );
          }}
        </For>
      </box>
    </box>
  );
}

function StatusBar(props: { daysFilter: number; lastUpdate: Date }) {
  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  const daysLabel = () => {
    const days = props.daysFilter;
    if (days === 0) return "ALL";
    if (days === 1) return "TODAY";
    if (days === 7) return "WEEK";
    if (days === 30) return "MONTH";
    return days.toString();
  };

  return (
    <box
      height={1}
      border-top
      borderColor={COLORS.border}
      backgroundColor={COLORS.bg.accent}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={COLORS.text.secondary} wrapMode="none">
        <span style={{ fg: COLORS.accent.teal }}>
          ⟳ {formatTime(props.lastUpdate)}
        </span>
        {" │ "}
        DAYS: <span style={{ fg: COLORS.accent.teal }}>{daysLabel()}</span>
        {" │ "}
        <span style={{ fg: COLORS.text.muted }}>
          TAB:PANEL ↑↓:SCROLL ←→:DAYS t:TODAY w:WEEK m:MONTH a:ALL HOME:RESET
          ^C:EXIT
        </span>
      </text>
    </box>
  );
}

function Dashboard(props: DashboardProps) {
  const [daysFilter, setDaysFilter] = createSignal(props.initialDays ?? 1);
  const [lastUpdate, setLastUpdate] = createSignal(new Date());
  const [allMessages, setAllMessages] = createSignal<MessageJson[]>([]);
  const [cachedStats, setCachedStats] = createSignal<Map<string, DailyStats>>(
    new Map()
  );
  const [quotas, setQuotas] = createSignal<QuotaSnapshot[]>([]);
  const [anthropicThresholds, setAnthropicThresholds] =
    createSignal<MultiAccountThresholds | null>(null);
  const [codexThresholds, setCodexThresholds] =
    createSignal<CodexThresholds | null>(null);
  const [cursor, setCursor] = createSignal<CursorState>(createCursor());
  const [isFirstLoad, setIsFirstLoad] = createSignal(true);
  const [isFullyLoaded, setIsFullyLoaded] = createSignal(false);
  const [pageOffset, setPageOffset] = createSignal(0);
  const [internalScroll, setInternalScroll] = createSignal(0);
  const [selectedPanel, setSelectedPanel] = createSignal<"usage" | "quota">(
    "usage"
  );

  const dimensions = useTerminalDimensions();

  const maxVisibleDays = () => {
    const termHeight = dimensions().height;
    const headerHeight = 3;
    const statusBarHeight = 1;
    const contentHeight = termHeight - headerHeight - statusBarHeight - 2;
    const panelHeight = sideBySide()
      ? contentHeight
      : Math.floor(contentHeight / 2);
    const linesPerDay = 5;
    return Math.max(1, Math.floor((panelHeight - 6) / linesPerDay));
  };

  const displayedStats = () => cachedStats();

  const loadData = async () => {
    const storagePath = getOpenCodeStoragePath();

    if (isFirstLoad()) {
      const recentMessages = await loadRecentMessages(
        storagePath,
        24,
        props.providerFilter
      );
      setAllMessages(recentMessages);
      const stats = aggregateByDate(recentMessages);
      setCachedStats(stats);
      setIsFirstLoad(false);
      setLastUpdate(new Date());

      setTimeout(async () => {
        const allMessages = await loadMessages(
          storagePath,
          props.providerFilter
        );
        setAllMessages(allMessages);
        const fullStats = aggregateByDate(allMessages);
        setCachedStats(fullStats);
        setIsFullyLoaded(true);
        setLastUpdate(new Date());
      }, 0);
    } else {
      const result = await loadMessagesIncremental(
        storagePath,
        cursor(),
        props.providerFilter
      );
      if (result.messages.length > 0) {
        const updated = [...allMessages(), ...result.messages];
        setAllMessages(updated);
        const stats = aggregateByDate(updated);
        setCachedStats(stats);
      }
      setCursor(result.cursor);
      setLastUpdate(new Date());
    }
  };

  const loadQuotas = async () => {
    const results: QuotaSnapshot[] = [];

    try {
      const thresholds = await loadMultiAccountThresholds();
      setAnthropicThresholds(thresholds);
      const multiAccount = await loadMultiAccountQuota();
      results.push(...multiAccount);
    } catch (err) {
      setAnthropicThresholds(null);
      results.push({
        source: "anthropic",
        label: "Multi-Account",
        used: 0,
        error: `Load error: ${err}`,
      });
    }

    try {
      const antigravity = await loadAntigravityQuota();
      results.push(...antigravity);
    } catch (err) {
      results.push({
        source: "antigravity",
        label: "Antigravity",
        used: 0,
        error: `Load error: ${err}`,
      });
    }

    try {
      const codexThresholdConfig = await loadCodexThresholds();
      setCodexThresholds(codexThresholdConfig);
      const codex = await loadCodexQuota();
      results.push(...codex);
    } catch (err) {
      setCodexThresholds(null);
      results.push({
        source: "codex",
        label: "Codex",
        used: 0,
        error: `Load error: ${err}`,
      });
    }

    setQuotas(results);
  };

  onMount(async () => {
    await Promise.all([loadQuotas(), loadData()]);

    const intervalId = setInterval(
      async () => {
        await Promise.all([loadQuotas(), loadData()]);
      },
      (props.refreshInterval ?? 300) * 1000
    );

    return () => clearInterval(intervalId);
  });

  useKeyboard((key) => {
    const keyName = key.name?.toLowerCase() || key.sequence;

    if (keyName === "t") {
      setDaysFilter(1);
      setPageOffset(0);
      setInternalScroll(0);
    }
    if (keyName === "w") {
      setDaysFilter(7);
      setPageOffset(0);
      setInternalScroll(0);
    }
    if (keyName === "m") {
      setDaysFilter(30);
      setPageOffset(0);
      setInternalScroll(0);
    }
    if (keyName === "a") {
      setDaysFilter(0);
      setPageOffset(0);
      setInternalScroll(0);
    }

    if (keyName === "tab" || keyName === "\t") {
      setSelectedPanel(selectedPanel() === "usage" ? "quota" : "usage");
    }

    if (selectedPanel() === "usage") {
      const totalDays = cachedStats().size;
      const visibleDays = daysFilter() === 0 ? 10 : daysFilter();
      const scrollStep = visibleDays;
      const maxOffset = Math.max(0, totalDays - visibleDays);

      if (keyName === "left" || keyName === "\x1b[d") {
        setPageOffset(Math.min(pageOffset() + scrollStep, maxOffset));
        setInternalScroll(0);
      }
      if (keyName === "right" || keyName === "\x1b[c") {
        setPageOffset(Math.max(pageOffset() - scrollStep, 0));
        setInternalScroll(0);
      }
      if (keyName === "home") {
        setPageOffset(0);
        setInternalScroll(0);
      }

      const allEntries = Array.from(cachedStats().entries());
      const sortedByDateDesc = allEntries.sort((a, b) =>
        b[0].localeCompare(a[0])
      );
      const afterScrollOffset = sortedByDateDesc.slice(pageOffset());
      const requestedDays = visibleDays;
      const totalInWindow = Math.min(afterScrollOffset.length, requestedDays);
      const maxInternalScroll = Math.max(0, totalInWindow - maxVisibleDays());

      if (keyName === "up" || keyName === "\x1b[a") {
        setInternalScroll(Math.max(internalScroll() - 1, 0));
      }
      if (keyName === "down" || keyName === "\x1b[b") {
        setInternalScroll(Math.min(internalScroll() + 1, maxInternalScroll));
      }
    }
  });

  const sideBySide = () => dimensions().width >= 168;
  const quotaTwoColumns = () => dimensions().width >= 150;

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={COLORS.bg.primary}
    >
      <box
        flexGrow={1}
        width="100%"
        flexDirection={sideBySide() ? "row" : "column"}
        gap={0}
        padding={0}
      >
        <UsageTable
          stats={displayedStats()}
          pageOffset={pageOffset()}
          daysFilter={daysFilter()}
          internalScroll={internalScroll()}
          maxVisibleDays={maxVisibleDays()}
          isLoading={!isFullyLoaded()}
          isSelected={selectedPanel() === "usage"}
          width={sideBySide() ? "49%" : "100%"}
        />
        <QuotaPanel
          quotas={quotas()}
          isSelected={selectedPanel() === "quota"}
          width={sideBySide() ? "49%" : "100%"}
          twoColumns={quotaTwoColumns()}
          anthropicThresholds={anthropicThresholds()}
          codexThresholds={codexThresholds()}
        />
      </box>

      <StatusBar daysFilter={daysFilter()} lastUpdate={lastUpdate()} />
    </box>
  );
}

export async function runSolidDashboard(options: DashboardProps) {
  await render(
    () => (
      <Dashboard
        providerFilter={options.providerFilter}
        initialDays={
          typeof options.initialDays === "number" ? options.initialDays : 1
        }
        refreshInterval={
          typeof options.refreshInterval === "number"
            ? options.refreshInterval
            : 300
        }
      />
    ),
    {
      exitOnCtrlC: true,
      targetFps: 30,
      useMouse: false,
    }
  );
}
