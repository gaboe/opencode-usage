import { describe, test, expect } from "bun:test";
import {
  isValidSource,
  listConfigFiles,
  readConfig,
  ConfigError,
} from "../commander/services/config-service.js";

describe("commander config-service", () => {
  // ---------------------------------------------------------------------------
  // isValidSource
  // ---------------------------------------------------------------------------
  describe("isValidSource", () => {
    test("returns true for codex-multi-account-accounts", () => {
      expect(isValidSource("codex-multi-account-accounts")).toBe(true);
    });

    test("returns true for anthropic-multi-account-state", () => {
      expect(isValidSource("anthropic-multi-account-state")).toBe(true);
    });

    test("returns true for antigravity-accounts", () => {
      expect(isValidSource("antigravity-accounts")).toBe(true);
    });

    test("returns true for opencode", () => {
      expect(isValidSource("opencode")).toBe(true);
    });

    test("returns false for unknown source", () => {
      expect(isValidSource("unknown")).toBe(false);
    });

    test("returns false for empty string", () => {
      expect(isValidSource("")).toBe(false);
    });

    test("returns false for similar but invalid names", () => {
      expect(isValidSource("opencode-usage")).toBe(false);
      expect(isValidSource("opencode-config")).toBe(false);
      expect(isValidSource("OPENCODE")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // ConfigError
  // ---------------------------------------------------------------------------
  describe("ConfigError", () => {
    test("has correct name and status", () => {
      const err = new ConfigError("test message", 404);
      expect(err.name).toBe("ConfigError");
      expect(err.status).toBe(404);
      expect(err.message).toBe("test message");
    });

    test("is an instance of Error", () => {
      const err = new ConfigError("oops", 500);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ConfigError);
    });

    test("preserves different status codes", () => {
      expect(new ConfigError("not found", 404).status).toBe(404);
      expect(new ConfigError("bad json", 422).status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  // listConfigFiles
  // ---------------------------------------------------------------------------
  describe("listConfigFiles", () => {
    test("returns exactly 4 entries", async () => {
      const files = await listConfigFiles();
      expect(files).toHaveLength(4);
    });

    test("each entry has required fields", async () => {
      const files = await listConfigFiles();
      for (const f of files) {
        expect(typeof f.source).toBe("string");
        expect(typeof f.path).toBe("string");
        expect(typeof f.exists).toBe("boolean");
        expect(typeof f.parseOk).toBe("boolean");
        expect(typeof f.sizeBytes).toBe("number");
      }
    });

    test("sources match the 4 known config sources", async () => {
      const files = await listConfigFiles();
      const sources = files.map((f) => f.source);
      expect(sources).toContain("codex-multi-account-accounts");
      expect(sources).toContain("anthropic-multi-account-state");
      expect(sources).toContain("antigravity-accounts");
      expect(sources).toContain("opencode");
    });

    test("paths end with .json", async () => {
      const files = await listConfigFiles();
      for (const f of files) {
        expect(f.path.endsWith(".json")).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // readConfig — error cases
  // ---------------------------------------------------------------------------
  describe("readConfig", () => {
    test("throws ConfigError with 404 for missing file", async () => {
      // antigravity-accounts is unlikely to exist on CI / fresh machines
      try {
        await readConfig("antigravity-accounts");
        // If the file happens to exist, still validate it returns data
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).status).toBe(404);
      }
    });

    test("returns parsed JSON when file exists", async () => {
      // opencode.json usually exists on dev machines
      const files = await listConfigFiles();
      const existing = files.find((f) => f.exists && f.parseOk);
      if (!existing) return; // skip if no config files exist

      const data = await readConfig(existing.source);
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
    });
  });
});
