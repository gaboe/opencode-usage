/**
 * Worker thread for usage data queries.
 *
 * bun:sqlite is fully synchronous and blocks the event loop.
 * Running queries in a worker keeps the main server responsive.
 */

import { getUsageData, type UsageQueryOpts } from "./usage-service.js";

declare const self: Worker;

self.onmessage = (event: MessageEvent<UsageQueryOpts>) => {
  try {
    // getUsageData is async but the heavy part (bun:sqlite) is sync,
    // so running it here frees the main thread regardless
    void getUsageData(event.data).then(
      (result) => self.postMessage({ ok: true, data: result }),
      (err) =>
        self.postMessage({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
    );
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
