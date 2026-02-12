import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadCodexQuota, resolveCodexToken } from "../codex-client.js";
import type { CodexUsageResponse } from "../types.js";

describe("loadCodexQuota", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(
    fn: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  ) {
    global.fetch = fn as typeof global.fetch;
  }

  it("resolveCodexToken returns explicit token over auto-read", async () => {
    const token = await resolveCodexToken("explicit-token");
    expect(token).toBe("explicit-token");
  });

  it("parses all three quota types from valid response", async () => {
    const mockResponse: CodexUsageResponse = {
      user_id: "user123",
      account_id: "acc123",
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 45,
          reset_at: 1707000000,
        },
        secondary_window: {
          used_percent: 20,
          reset_at: 1707600000,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 75,
          reset_at: 1707100000,
        },
      },
    };

    mockFetch(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      source: "codex",
      label: "Codex - 5h Limit",
      used: 0.45,
      resetAt: 1707000000,
    });
    expect(result[1]).toEqual({
      source: "codex",
      label: "Codex - Weekly",
      used: 0.2,
      resetAt: 1707600000,
    });
    expect(result[2]).toEqual({
      source: "codex",
      label: "Codex - Code Review",
      used: 0.75,
      resetAt: 1707100000,
    });
  });

  it("divides used_percent by 100 correctly", async () => {
    const mockResponse: CodexUsageResponse = {
      rate_limit: {
        primary_window: {
          used_percent: 2,
          reset_at: 1707000000,
        },
      },
    };

    mockFetch(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(1);
    expect(result[0].used).toBe(0.02);
  });

  it("handles HTTP error gracefully", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    const result = await loadCodexQuota("invalid-token");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "codex",
      label: "Codex",
      used: 0,
      error: "API error: 401 (token expired? Run: codex login)",
    });
  });

  it("handles network error gracefully", async () => {
    mockFetch(async () => {
      throw new Error("Network timeout");
    });

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "codex",
      label: "Codex",
      used: 0,
      error: "Request failed: Network timeout",
    });
  });

  it("handles non-Error exceptions gracefully", async () => {
    mockFetch(async () => {
      throw "Unknown error";
    });

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "codex",
      label: "Codex",
      used: 0,
      error: "Request failed: Unknown error",
    });
  });

  it("returns error snapshot when response has no rate limit data", async () => {
    const mockResponse: CodexUsageResponse = {
      user_id: "user123",
    };

    mockFetch(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "codex",
      label: "Codex",
      used: 0,
      error: "No rate limit data",
    });
  });

  it("includes only available quota windows", async () => {
    const mockResponse: CodexUsageResponse = {
      rate_limit: {
        primary_window: {
          used_percent: 30,
          reset_at: 1707000000,
        },
      },
    };

    mockFetch(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await loadCodexQuota("test-token");

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Codex - 5h Limit");
  });

  it("sends correct headers with token", async () => {
    let capturedHeaders: HeadersInit | undefined;

    mockFetch(async (url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ rate_limit: {} }), { status: 200 });
    });

    await loadCodexQuota("my-secret-token");

    expect(capturedHeaders).toEqual({
      Authorization: "Bearer my-secret-token",
      "Content-Type": "application/json",
    });
  });

  it("uses GET method", async () => {
    let capturedMethod: string | undefined;

    mockFetch(async (url, init) => {
      capturedMethod = init?.method;
      return new Response(JSON.stringify({ rate_limit: {} }), { status: 200 });
    });

    await loadCodexQuota("test-token");

    expect(capturedMethod).toBe("GET");
  });
});
