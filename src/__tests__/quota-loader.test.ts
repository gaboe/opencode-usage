import { describe, it, expect, afterEach } from "bun:test";
import {
  loadMultiAccountQuota,
  loadAntigravityQuota,
} from "../quota-loader.js";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";

const multiAccountPath = join(
  homedir(),
  ".config",
  "opencode",
  "anthropic-multi-account-state.json"
);
const legacyMultiAccountPath = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "multi-account-state.json"
);
const testDir = join(homedir(), ".local/share");
const antigravityPath = join(testDir, "opencode-antigravity/accounts.json");

async function setupTestFile(path: string, data: unknown) {
  const dir = path.substring(0, path.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

async function cleanupTestFile(path: string) {
  try {
    await rm(path);
  } catch {
    // File doesn't exist, ignore
  }
}

describe("quota-loader", () => {
  describe("loadMultiAccountQuota", () => {
    afterEach(async () => {
      await cleanupTestFile(multiAccountPath);
      await cleanupTestFile(legacyMultiAccountPath);
    });

    it("loads quota from multi-account state file", async () => {
      const testData = {
        currentAccount: "account1",
        usage: {
          account1: {
            session5h: { utilization: 0.5, reset: 1700000000 },
            weekly7d: { utilization: 0.3, reset: 1700100000 },
          },
          account2: {
            weekly7dSonnet: { utilization: 0.8, reset: 1700200000 },
          },
        },
      };

      await setupTestFile(multiAccountPath, testData);
      const result = await loadMultiAccountQuota();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        source: "anthropic",
        label: "account1 [ACTIVE] - Session 5h",
        used: 0.5,
        resetAt: 1700000000,
      });
      expect(result[1]).toEqual({
        source: "anthropic",
        label: "account1 [ACTIVE] - Weekly",
        used: 0.3,
        resetAt: 1700100000,
      });
      expect(result[2]).toEqual({
        source: "anthropic",
        label: "account2 - Sonnet",
        used: 0.8,
        resetAt: 1700200000,
      });
    });

    it("marks active account with [ACTIVE] suffix", async () => {
      const testData = {
        currentAccount: "prod",
        usage: {
          prod: {
            session5h: { utilization: 0.2, reset: 1700000000 },
          },
          dev: {
            session5h: { utilization: 0.1, reset: 1700000000 },
          },
        },
      };

      await setupTestFile(multiAccountPath, testData);
      const result = await loadMultiAccountQuota();

      const activeLabel = result.find((r) => r.label.includes("[ACTIVE]"));
      const inactiveLabel = result.find((r) => !r.label.includes("[ACTIVE]"));

      expect(activeLabel?.label).toContain("prod [ACTIVE]");
      expect(inactiveLabel?.label).toContain("dev -");
      expect(inactiveLabel?.label).not.toContain("[ACTIVE]");
    });

    it("returns error snapshot when file is missing", async () => {
      await cleanupTestFile(multiAccountPath);
      const result = await loadMultiAccountQuota();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: "anthropic",
        label: "Multi-Account",
        used: 0,
        error: "No data",
      });
    });

    it("returns error snapshot when usage is empty", async () => {
      const testData = { currentAccount: "account1", usage: {} };

      await setupTestFile(multiAccountPath, testData);
      const result = await loadMultiAccountQuota();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: "anthropic",
        label: "Multi-Account",
        used: 0,
        error: "No usage data",
      });
    });

    it("skips undefined quota types", async () => {
      const testData = {
        currentAccount: "account1",
        usage: {
          account1: {
            session5h: { utilization: 0.5, reset: 1700000000 },
            // weekly7d and weekly7dSonnet are undefined
          },
        },
      };

      await setupTestFile(multiAccountPath, testData);
      const result = await loadMultiAccountQuota();

      expect(result).toHaveLength(1);
      expect(result[0].label).toContain("Session 5h");
    });
  });

  describe("loadAntigravityQuota", () => {
    afterEach(async () => {
      await cleanupTestFile(antigravityPath);
    });

    it("loads quota from antigravity accounts file", async () => {
      const testData = {
        accounts: [
          {
            email: "user1@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.4,
                resetTime: "2025-02-12T00:00:00Z",
              },
              "gemini-pro": {
                remainingFraction: 0.6,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
          {
            email: "user2@example.com",
            cachedQuota: {
              "gemini-flash": {
                remainingFraction: 0.2,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        source: "antigravity",
        label: "user1@example.com - Claude",
        used: 0.6, // 1 - 0.4
        resetAt: expect.any(Number),
      });
      expect(result[1]).toEqual({
        source: "antigravity",
        label: "user1@example.com - Gemini Pro",
        used: 0.4, // 1 - 0.6
        resetAt: expect.any(Number),
      });
      expect(result[2]).toEqual({
        source: "antigravity",
        label: "user2@example.com - Gemini Flash",
        used: 0.8, // 1 - 0.2
        resetAt: expect.any(Number),
      });
    });

    it("inverts remainingFraction to calculate used percentage", async () => {
      const testData = {
        accounts: [
          {
            email: "test@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.25,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result[0].used).toBe(0.75); // 1 - 0.25
    });

    it("handles missing resetTime gracefully", async () => {
      const testData = {
        accounts: [
          {
            email: "test@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                // resetTime is undefined
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result[0]).toEqual({
        source: "antigravity",
        label: "test@example.com - Claude",
        used: 0.5,
        resetAt: undefined,
      });
    });

    it("skips disabled accounts", async () => {
      const testData = {
        accounts: [
          {
            email: "active@example.com",
            disabled: false,
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
          {
            email: "disabled@example.com",
            disabled: true,
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(1);
      expect(result[0].label).toContain("active@example.com");
    });

    it("skips accounts without cachedQuota", async () => {
      const testData = {
        accounts: [
          {
            email: "with-quota@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
          {
            email: "without-quota@example.com",
            // cachedQuota is undefined
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(1);
      expect(result[0].label).toContain("with-quota@example.com");
    });

    it("uses 'Account' as fallback label when email is missing", async () => {
      const testData = {
        accounts: [
          {
            // email is undefined
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T00:00:00Z",
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result[0].label).toBe("Account - Claude");
    });

    it("returns error snapshot when file is missing", async () => {
      await cleanupTestFile(antigravityPath);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: "antigravity",
        label: "Antigravity",
        used: 0,
        error: "No accounts",
      });
    });

    it("returns error snapshot when accounts array is empty", async () => {
      const testData = { accounts: [] };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        source: "antigravity",
        label: "Antigravity",
        used: 0,
        error: "No accounts",
      });
    });

    it("skips quota groups without data", async () => {
      const testData = {
        accounts: [
          {
            email: "test@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T00:00:00Z",
              },
              // gemini-pro and gemini-flash are undefined
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      expect(result).toHaveLength(1);
      expect(result[0].label).toContain("Claude");
    });

    it("converts ISO date string to Unix timestamp", async () => {
      const testData = {
        accounts: [
          {
            email: "test@example.com",
            cachedQuota: {
              claude: {
                remainingFraction: 0.5,
                resetTime: "2025-02-12T12:30:45Z",
              },
            },
          },
        ],
      };

      await setupTestFile(antigravityPath, testData);
      const result = await loadAntigravityQuota();

      const expectedTimestamp = Math.floor(
        Date.parse("2025-02-12T12:30:45Z") / 1000
      );
      expect(result[0].resetAt).toBe(expectedTimestamp);
    });
  });
});
