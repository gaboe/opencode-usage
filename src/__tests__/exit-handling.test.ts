import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("exit handling", () => {
  describe("dashboard.ts Ctrl+C handling", () => {
    it("should handle Ctrl+C in stdin handler", () => {
      const dashboard = readFileSync(join(process.cwd(), "src/dashboard.ts"), "utf-8");
      
      // Check that Ctrl+C handler exists with proper cleanup
      const hasCtrlCHandler = dashboard.includes('key === "\\u0003"');
      const hasSetRawModeFalse = dashboard.includes('stdin.setRawMode(false)');
      const hasPause = dashboard.includes('stdin.pause()');
      const hasClearInterval = dashboard.includes('clearInterval(intervalId)');
      
      expect(hasCtrlCHandler).toBe(true);
      expect(hasSetRawModeFalse).toBe(true);
      expect(hasPause).toBe(true);
      expect(hasClearInterval).toBe(true);
    });

    it("should have SIGINT handler with proper cleanup", () => {
      const dashboard = readFileSync(join(process.cwd(), "src/dashboard.ts"), "utf-8");
      
      // Check that SIGINT handler exists with proper cleanup
      const hasSigintHandler = dashboard.includes('process.on("SIGINT"');
      const hasClearIntervalInSigint = dashboard.includes('clearInterval(intervalId)');
      const hasClearScreen = dashboard.includes('clearScreen()');
      const hasSetRawModeCheck = dashboard.includes('stdin.setRawMode(false)');
      
      expect(hasSigintHandler).toBe(true);
      expect(hasClearIntervalInSigint).toBe(true);
      expect(hasClearScreen).toBe(true);
      expect(hasSetRawModeCheck).toBe(true);
    });
  });

  describe("index.ts watch mode SIGINT handling", () => {
    it("should handle SIGINT in watch mode", () => {
      const index = readFileSync(join(process.cwd(), "src/index.ts"), "utf-8");
      
      // Check that watch mode has SIGINT handler
      const hasWatchMode = index.includes('if (watch)');
      const hasSigintHandler = index.includes('process.on("SIGINT"');
      const hasClearInterval = index.includes('clearInterval(intervalId)');
      const hasExitMessage = index.includes('Watch mode stopped');
      
      expect(hasWatchMode).toBe(true);
      expect(hasSigintHandler).toBe(true);
      expect(hasClearInterval).toBe(true);
      expect(hasExitMessage).toBe(true);
    });
  });

  describe("dashboard-solid.tsx Ctrl+C handling", () => {
    it("should handle Ctrl+C in keyboard handler", () => {
      const solid = readFileSync(join(process.cwd(), "src/dashboard-solid.tsx"), "utf-8");
      
      // Check that keyboard handler has Ctrl+C handling
      const hasKeyboardHandler = solid.includes('useKeyboard');
      const hasCtrlCCheck = solid.includes('keyName === "c" && key.ctrl');
      const hasProcessExit = solid.includes('process.exit(0)');
      
      expect(hasKeyboardHandler).toBe(true);
      expect(hasCtrlCCheck).toBe(true);
      expect(hasProcessExit).toBe(true);
    });
  });
});
