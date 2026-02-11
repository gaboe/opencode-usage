import { describe, expect, test } from "bun:test";
import { renderStatusBar } from "../dashboard/status-bar.js";

describe("status-bar", () => {
  test("renderStatusBar should include last update time", () => {
    const timestamp = new Date("2025-02-11T15:30:45").getTime();
    const output = renderStatusBar(
      { lastUpdate: timestamp, refreshInterval: 300 },
      80
    );
    expect(output).toContain("Last update:");
    expect(output).toContain("15:30:45");
  });

  test("renderStatusBar should include refresh interval", () => {
    const output = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 300 },
      80
    );
    expect(output).toContain("Refresh: 300s");
  });

  test("renderStatusBar should include exit hint", () => {
    const output = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 60 },
      80
    );
    expect(output).toContain("Ctrl+C: exit");
  });

  test("renderStatusBar should handle narrow widths", () => {
    const output = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 300 },
      40
    );
    expect(output).toContain("Last update:");
    expect(output).toContain("Ctrl+C: exit");
  });

  test("renderStatusBar should pad correctly for wide widths", () => {
    const output = renderStatusBar(
      { lastUpdate: Date.now(), refreshInterval: 300 },
      120
    );
    expect(output.length).toBeGreaterThanOrEqual(100);
    expect(output).toContain("Ctrl+C: exit");
  });

  test("renderStatusBar should use default width if not provided", () => {
    const output = renderStatusBar({
      lastUpdate: Date.now(),
      refreshInterval: 60,
    });
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Last update:");
  });

  test("renderStatusBar should format time with leading zeros", () => {
    const timestamp = new Date("2025-02-11T03:05:09").getTime();
    const output = renderStatusBar(
      { lastUpdate: timestamp, refreshInterval: 60 },
      80
    );
    expect(output).toContain("03:05:09");
  });
});
