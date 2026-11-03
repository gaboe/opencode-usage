import { describe, it, expect, mock, spyOn } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type TestStdin = {
  isTTY: boolean;
  setRawMode: (value: boolean) => void;
  resume: () => void;
  setEncoding: (encoding: string) => void;
  pause: () => void;
};

function patchStdin(events: string[]) {
  const stdin = process.stdin as unknown as TestStdin;
  const saved = {
    isTTY: stdin.isTTY,
    setRawMode: stdin.setRawMode,
    resume: stdin.resume,
    setEncoding: stdin.setEncoding,
    pause: stdin.pause,
  };
  stdin.isTTY = true;
  stdin.setRawMode = mock((value: boolean) => {
    events.push(`setRawMode(${value})`);
  });
  stdin.resume = mock(() => {});
  stdin.setEncoding = mock(() => {});
  stdin.pause = mock(() => {
    events.push("pause");
  });
  return () => {
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    stdin.resume = saved.resume;
    stdin.setEncoding = saved.setEncoding;
    stdin.pause = saved.pause;
  };
}

function cleanup(
  intervalSpy: ReturnType<typeof spyOn>,
  processOnSpy: ReturnType<typeof spyOn>
) {
  for (const call of intervalSpy.mock.results) {
    if (call.type === "return") clearInterval(call.value);
  }
  for (const call of processOnSpy.mock.calls) {
    if (call[0] === ("SIGINT" as string)) {
      process.removeListener("SIGINT", call[1] as () => void);
    }
  }
  process.stdin.removeAllListeners("data");
}

// XDG_DATA_HOME is read at call time by getOpenCodeStoragePath(); pointing it
// at an empty dir makes the real loaders return empty data without touching
// the user's actual storage.
function patchStorageHome() {
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "opencode-usage-"));
  return () => {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
  };
}

describe("exit handling", () => {
  describe("dashboard.ts Ctrl+C handling", () => {
    it("restores stdin state on Ctrl+C even before the first render completes", async () => {
      const events: string[] = [];
      const restoreStdin = patchStdin(events);
      const restoreHome = patchStorageHome();
      const exitSpy = spyOn(process, "exit").mockImplementation(((
        code?: number
      ) => {
        events.push(`exit(${code})`);
      }) as never);
      const onSpy = spyOn(process.stdin, "on");
      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        (() => true) as never
      );
      const intervalSpy = spyOn(globalThis, "setInterval");
      const processOnSpy = spyOn(process, "on");

      try {
        const { runDashboard } = await import("../dashboard.js");
        // The stdin handler is registered synchronously; invoke it while the
        // first render is still in flight so the watch interval does not exist
        // yet (regression test for a TDZ ReferenceError that skipped cleanup).
        const pending = runDashboard({ refreshInterval: 3600 });
        const dataHandler = onSpy.mock.calls.find(
          (call) => call[0] === "data"
        )?.[1] as ((key: string) => Promise<void>) | undefined;
        expect(dataHandler).toBeDefined();

        await dataHandler!("\u0003");

        expect(events.slice(-3)).toEqual([
          "setRawMode(false)",
          "pause",
          "exit(0)",
        ]);

        await pending;
      } finally {
        cleanup(intervalSpy, processOnSpy);
        processOnSpy.mockRestore();
        intervalSpy.mockRestore();
        writeSpy.mockRestore();
        onSpy.mockRestore();
        exitSpy.mockRestore();
        restoreHome();
        restoreStdin();
      }
    });

    it("clears the watch interval and restores raw mode on SIGINT", async () => {
      const events: string[] = [];
      const restoreStdin = patchStdin(events);
      const restoreHome = patchStorageHome();
      const exitSpy = spyOn(process, "exit").mockImplementation(((
        code?: number
      ) => {
        events.push(`exit(${code})`);
      }) as never);
      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        (() => true) as never
      );
      const intervalSpy = spyOn(globalThis, "setInterval");
      const clearIntervalSpy = spyOn(
        globalThis,
        "clearInterval"
      ).mockImplementation((() => {}) as never);
      const processOnSpy = spyOn(process, "on");

      try {
        const { runDashboard } = await import("../dashboard.js");
        await runDashboard({ refreshInterval: 3600 });

        const interval = intervalSpy.mock.results.find(
          (result) => result.type === "return"
        )?.value as ReturnType<typeof setInterval> | undefined;
        const sigintHandler = processOnSpy.mock.calls.find(
          (call) => call[0] === ("SIGINT" as string)
        )?.[1] as (() => void) | undefined;
        expect(interval).toBeDefined();
        expect(sigintHandler).toBeDefined();

        sigintHandler!();

        expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
        expect(events).toContain("setRawMode(false)");
        expect(events).toContain("exit(0)");
      } finally {
        clearIntervalSpy.mockRestore();
        cleanup(intervalSpy, processOnSpy);
        processOnSpy.mockRestore();
        intervalSpy.mockRestore();
        writeSpy.mockRestore();
        exitSpy.mockRestore();
        restoreHome();
        restoreStdin();
      }
    });
  });

  describe("index.ts watch mode SIGINT handling", () => {
    it("should handle SIGINT in watch mode", () => {
      const index = readFileSync(join(process.cwd(), "src/index.ts"), "utf-8");

      // Check that watch mode has SIGINT handler
      const hasWatchMode = index.includes("if (watch)");
      const hasSigintHandler = index.includes('process.on("SIGINT"');
      const hasClearInterval = index.includes("clearInterval(intervalId)");
      const hasExitMessage = index.includes("Watch mode stopped");

      expect(hasWatchMode).toBe(true);
      expect(hasSigintHandler).toBe(true);
      expect(hasClearInterval).toBe(true);
      expect(hasExitMessage).toBe(true);
    });
  });

  describe("dashboard-solid.tsx Ctrl+C handling", () => {
    it("lets the renderer tear down on Ctrl+C via exitOnCtrlC", async () => {
      // Ctrl+C must go through OpenTUI's renderer teardown (exitOnCtrlC),
      // not a process.exit() shortcut that skips restoring the terminal.
      const renderSpy = mock(
        async (_component: unknown, _options?: unknown) => {}
      );
      mock.module("@opentui/solid", () => ({
        render: renderSpy,
        useKeyboard: () => {},
        useTerminalDimensions: () => ({ width: 80, height: 24 }),
      }));
      mock.module("@opentui/solid/jsx-runtime", () => ({
        jsx: () => null,
        jsxs: () => null,
        jsxDEV: () => null,
        Fragment: null,
      }));

      const { runSolidDashboard } = await import("../dashboard-solid.js");
      await runSolidDashboard({});

      const options = renderSpy.mock.calls[0]?.[1] as
        | { exitOnCtrlC?: boolean }
        | undefined;
      expect(options?.exitOnCtrlC).toBe(true);

      // Guard against reintroducing a process.exit() shortcut in the
      // keyboard handler, which would bypass renderer teardown.
      const solid = readFileSync(
        join(process.cwd(), "src/dashboard-solid.tsx"),
        "utf-8"
      );
      expect(solid.includes("process.exit(")).toBe(false);
    });
  });
});
