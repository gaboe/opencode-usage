import { describe, test, expect } from "bun:test";
import { getAppCatalog } from "../commander/services/app-init-service.js";
import type { AppState } from "../commander/services/app-init-service.js";

const EXPECTED_APP_IDS = [
  "oc-codex-multi-account",
  "oc-anthropic-multi-account",
  "opencode-gitbutler",
  "opencode-usage",
] as const;

const VALID_STATES: ReadonlySet<string> = new Set<AppState>([
  "ready",
  "partial",
  "missing-deps",
  "not-installed",
]);

describe("commander app-init-service", () => {
  // -----------------------------------------------------------------------
  // getAppCatalog — count & IDs
  // -----------------------------------------------------------------------
  describe("getAppCatalog", () => {
    test("returns exactly 4 apps", async () => {
      const apps = await getAppCatalog();
      expect(apps).toHaveLength(4);
    });

    test("app IDs match the 4 expected apps", async () => {
      const apps = await getAppCatalog();
      const ids = apps.map((a) => a.id);
      for (const expected of EXPECTED_APP_IDS) {
        expect(ids).toContain(expected);
      }
    });

    test("app IDs are returned in deterministic order", async () => {
      const apps = await getAppCatalog();
      const ids = apps.map((a) => a.id);
      expect(ids).toEqual([...EXPECTED_APP_IDS]);
    });
  });

  // -----------------------------------------------------------------------
  // AppStatus shape
  // -----------------------------------------------------------------------
  describe("AppStatus shape", () => {
    test("each app has id, name, description, state, details", async () => {
      const apps = await getAppCatalog();
      for (const app of apps) {
        expect(typeof app.id).toBe("string");
        expect(typeof app.name).toBe("string");
        expect(typeof app.description).toBe("string");
        expect(typeof app.state).toBe("string");
        expect(Array.isArray(app.details)).toBe(true);
      }
    });

    test("each app state is a valid AppState value", async () => {
      const apps = await getAppCatalog();
      for (const app of apps) {
        expect(VALID_STATES.has(app.state)).toBe(true);
      }
    });

    test("each app has a non-empty name and description", async () => {
      const apps = await getAppCatalog();
      for (const app of apps) {
        expect(app.name.length).toBeGreaterThan(0);
        expect(app.description.length).toBeGreaterThan(0);
      }
    });

    test("each app has at least one detail entry", async () => {
      const apps = await getAppCatalog();
      for (const app of apps) {
        expect(app.details.length).toBeGreaterThan(0);
        for (const detail of app.details) {
          expect(typeof detail).toBe("string");
        }
      }
    });
  });
});
