import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadRecentMessages, loadMessages } from "../loader.js";
import type { MessageJson } from "../types.js";
import { join } from "node:path";
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";

const PERF_THRESHOLD_RECENT = 100;
const PERF_THRESHOLD_FULL = 5000;

const createTestMessage = (
  id: string,
  sessionID: string,
  providerID: string = "anthropic",
  created: number = Date.now()
): MessageJson => ({
  id,
  sessionID,
  role: "assistant",
  model: {
    providerID,
    modelID: "claude-3-5-sonnet",
  },
  tokens: {
    input: 100,
    output: 50,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  time: {
    created,
    completed: created + 1000,
  },
});

describe("loader - performance tests", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `opencode-perf-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    const messagesDir = join(testDir, "message");

    const sessionsToCreate = 100;
    const filesPerSession = 50;
    const now = Date.now();

    for (let s = 0; s < sessionsToCreate; s++) {
      const sessionDir = join(messagesDir, `session-${s}`);
      await mkdir(sessionDir, { recursive: true });

      for (let f = 0; f < filesPerSession; f++) {
        const ageMs = (sessionsToCreate - s) * 1000 * 60 * 60 + (filesPerSession - f) * 1000;
        const timestamp = now - ageMs;
        
        const msg = createTestMessage(
          `msg-${s}-${f}`,
          `session-${s}`,
          "anthropic",
          timestamp
        );
        
        const filePath = join(sessionDir, `msg-${f}.json`);
        await writeFile(filePath, JSON.stringify(msg));
        
        const mtime = new Date(timestamp);
        await utimes(filePath, mtime, mtime);
      }
    }

    console.log(`Created ${sessionsToCreate * filesPerSession} test messages in ${sessionsToCreate} sessions`);
  });

  afterAll(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it(`loadRecentMessages() completes in under ${PERF_THRESHOLD_RECENT}ms (24 hours)`, async () => {
    const start = performance.now();
    const messages = await loadRecentMessages(testDir, 24);
    const duration = performance.now() - start;

    console.log(`loadRecentMessages(24h) took ${duration.toFixed(2)}ms`);
    console.log(`Loaded ${messages.length} messages`);

    expect(messages.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(PERF_THRESHOLD_RECENT);
  });

  it("loadRecentMessages() loads ALL files within time window (accurate)", async () => {
    const messages = await loadRecentMessages(testDir, 24);

    expect(messages.length).toBeGreaterThan(0);
    
    for (const msg of messages) {
      const messageTime = msg.time?.created || 0;
      const ageHours = (Date.now() - messageTime) / (1000 * 60 * 60);
      expect(ageHours).toBeLessThanOrEqual(24);
    }
  });

  it("loadRecentMessages() with shorter time window loads fewer messages", async () => {
    const messages24h = await loadRecentMessages(testDir, 24);
    const messages1h = await loadRecentMessages(testDir, 1);

    expect(messages1h.length).toBeLessThan(messages24h.length);
  });

  it(`loadMessages() completes in under ${PERF_THRESHOLD_FULL}ms (5000 files)`, async () => {
    const start = performance.now();
    const messages = await loadMessages(testDir);
    const duration = performance.now() - start;

    console.log(`loadMessages() (FULL) took ${duration.toFixed(2)}ms`);
    console.log(`Loaded ${messages.length} messages`);

    expect(messages.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(PERF_THRESHOLD_FULL);
  });

  it("loadRecentMessages() is significantly faster than loadMessages()", async () => {
    const startRecent = performance.now();
    const recentMessages = await loadRecentMessages(testDir, 24);
    const recentDuration = performance.now() - startRecent;

    const startFull = performance.now();
    const fullMessages = await loadMessages(testDir);
    const fullDuration = performance.now() - startFull;

    console.log(`Recent (24h): ${recentDuration.toFixed(2)}ms (${recentMessages.length} messages)`);
    console.log(`Full: ${fullDuration.toFixed(2)}ms (${fullMessages.length} messages)`);
    console.log(`Speedup: ${(fullDuration / recentDuration).toFixed(2)}x faster`);

    expect(recentDuration).toBeLessThan(fullDuration);
  });

  it("loadRecentMessages() with different time windows", async () => {
    const timings: Array<{ hours: number; duration: number; count: number }> = [];

    for (const hours of [1, 6, 12, 24]) {
      const start = performance.now();
      const messages = await loadRecentMessages(testDir, hours);
      const duration = performance.now() - start;

      timings.push({ hours, duration, count: messages.length });
    }

    console.log("\nPerformance by time window:");
    for (const timing of timings) {
      console.log(
        `  ${timing.hours}h: ${timing.duration.toFixed(2)}ms (${timing.count} messages)`
      );
    }

    for (const timing of timings) {
      expect(timing.duration).toBeLessThan(200);
    }
  });

  it("loadRecentMessages() respects provider filter without performance hit", async () => {
    const startWithoutFilter = performance.now();
    const withoutFilter = await loadRecentMessages(testDir, 24);
    const durationWithoutFilter = performance.now() - startWithoutFilter;

    const startWithFilter = performance.now();
    const withFilter = await loadRecentMessages(testDir, 24, "anthropic");
    const durationWithFilter = performance.now() - startWithFilter;

    console.log(`Without filter: ${durationWithoutFilter.toFixed(2)}ms (${withoutFilter.length} messages)`);
    console.log(`With filter: ${durationWithFilter.toFixed(2)}ms (${withFilter.length} messages)`);

    expect(durationWithFilter).toBeLessThan(durationWithoutFilter * 2.0);
    expect(withFilter.length).toBe(withoutFilter.length);
  });
});
