/**
 * Terminal table renderer
 */

import type { DailyStats } from "./types";

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

function padLeft(str: string, len: number): string {
  return str.padStart(len);
}

export type JsonOutput = {
  periods: Array<{
    date: string;
    models: string[];
    providers: Array<{
      id: string;
      models: string[];
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning: number;
      cost: number;
    }>;
    totals: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning: number;
      cost: number;
    };
  }>;
  totals: {
    input: number;
    output: number;
    cost: number;
  };
};

export function renderJson(dailyStats: Map<string, DailyStats>): void {
  const sortedDates = Array.from(dailyStats.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  const periods = sortedDates.map((date) => {
    const stats = dailyStats.get(date)!;
    const combinedInput = stats.input + stats.cacheRead + stats.cacheWrite;

    totalInput += combinedInput;
    totalOutput += stats.output;
    totalCost += stats.cost;

    const providers = Array.from(stats.providerStats.entries())
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([id, ps]) => ({
        id,
        models: Array.from(ps.models).sort(),
        input: ps.input,
        output: ps.output,
        cacheRead: ps.cacheRead,
        cacheWrite: ps.cacheWrite,
        reasoning: ps.reasoning,
        cost: Math.round(ps.cost * 100) / 100,
      }));

    return {
      date,
      models: Array.from(stats.models).sort(),
      providers,
      totals: {
        input: stats.input,
        output: stats.output,
        cacheRead: stats.cacheRead,
        cacheWrite: stats.cacheWrite,
        reasoning: stats.reasoning,
        cost: Math.round(stats.cost * 100) / 100,
      },
    };
  });

  const output: JsonOutput = {
    periods,
    totals: {
      input: totalInput,
      output: totalOutput,
      cost: Math.round(totalCost * 100) / 100,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

export function renderTable(dailyStats: Map<string, DailyStats>): void {
  const sortedDates = Array.from(dailyStats.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  if (sortedDates.length === 0) {
    console.log("\nNo usage data found.\n");
    return;
  }

  // Column widths
  const colDate = 12;
  const colModels = 35;
  const colInput = 16;
  const colOutput = 14;
  const colTotal = 16;
  const colCost = 12;

  // Border characters
  const h = "\u2500";
  const v = "\u2502";
  const tl = "\u250C";
  const tr = "\u2510";
  const bl = "\u2514";
  const br = "\u2518";
  const ml = "\u251C";
  const mr = "\u2524";
  const mt = "\u252C";
  const mb = "\u2534";
  const mm = "\u253C";

  const topLine =
    tl +
    h.repeat(colDate) +
    mt +
    h.repeat(colModels) +
    mt +
    h.repeat(colInput) +
    mt +
    h.repeat(colOutput) +
    mt +
    h.repeat(colTotal) +
    mt +
    h.repeat(colCost) +
    tr;

  const midLine =
    ml +
    h.repeat(colDate) +
    mm +
    h.repeat(colModels) +
    mm +
    h.repeat(colInput) +
    mm +
    h.repeat(colOutput) +
    mm +
    h.repeat(colTotal) +
    mm +
    h.repeat(colCost) +
    mr;

  const bottomLine =
    bl +
    h.repeat(colDate) +
    mb +
    h.repeat(colModels) +
    mb +
    h.repeat(colInput) +
    mb +
    h.repeat(colOutput) +
    mb +
    h.repeat(colTotal) +
    mb +
    h.repeat(colCost) +
    br;

  const header =
    v +
    padRight(" Date", colDate) +
    v +
    padRight(" Models", colModels) +
    v +
    padLeft("Input ", colInput) +
    v +
    padLeft("Output ", colOutput) +
    v +
    padLeft("Total Tokens ", colTotal) +
    v +
    padLeft("Cost ", colCost) +
    v;

  console.log("\n" + topLine);
  console.log(header);
  console.log(midLine);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const date of sortedDates) {
    const stats = dailyStats.get(date)!;
    const models = Array.from(stats.models).sort();

    const combinedInput = stats.input + stats.cacheRead + stats.cacheWrite;
    const totalTokens = combinedInput + stats.output;

    totalInput += combinedInput;
    totalOutput += stats.output;
    totalCost += stats.cost;

    const firstModel = models[0] ? `- ${models[0]}` : "";
    console.log(
      v +
        padRight(` ${date}`, colDate) +
        v +
        padRight(` ${firstModel}`, colModels) +
        v +
        padLeft(`${formatNumber(combinedInput)} `, colInput) +
        v +
        padLeft(`${formatNumber(stats.output)} `, colOutput) +
        v +
        padLeft(`${formatNumber(totalTokens)} `, colTotal) +
        v +
        padLeft(`${formatCost(stats.cost)} `, colCost) +
        v
    );

    for (let i = 1; i < models.length; i++) {
      console.log(
        v +
          " ".repeat(colDate) +
          v +
          padRight(` - ${models[i]}`, colModels) +
          v +
          " ".repeat(colInput) +
          v +
          " ".repeat(colOutput) +
          v +
          " ".repeat(colTotal) +
          v +
          " ".repeat(colCost) +
          v
      );
    }

    const providers = Array.from(stats.providerStats.entries()).sort(
      (a, b) => b[1].cost - a[1].cost
    );

    for (const [providerId, providerStat] of providers) {
      const providerInput =
        providerStat.input + providerStat.cacheRead + providerStat.cacheWrite;
      const providerTokens = providerInput + providerStat.output;
      console.log(
        v +
          " ".repeat(colDate) +
          v +
          padRight(`   [${providerId}]`, colModels) +
          v +
          padLeft(`${formatNumber(providerInput)} `, colInput) +
          v +
          padLeft(`${formatNumber(providerStat.output)} `, colOutput) +
          v +
          padLeft(`${formatNumber(providerTokens)} `, colTotal) +
          v +
          padLeft(`${formatCost(providerStat.cost)} `, colCost) +
          v
      );
    }

    console.log(midLine);
  }

  const grandTotal = totalInput + totalOutput;
  console.log(
    v +
      padRight(" Total", colDate) +
      v +
      " ".repeat(colModels) +
      v +
      padLeft(`${formatNumber(totalInput)} `, colInput) +
      v +
      padLeft(`${formatNumber(totalOutput)} `, colOutput) +
      v +
      padLeft(`${formatNumber(grandTotal)} `, colTotal) +
      v +
      padLeft(`${formatCost(totalCost)} `, colCost) +
      v
  );
  console.log(bottomLine);
  console.log();
}
