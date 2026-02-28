/**
 * Quota data service — thin wrapper over quota loaders for the Commander API.
 */

import {
  loadMultiAccountQuota,
  loadAntigravityQuota,
} from "../../quota-loader.js";
import { loadCodexQuota } from "../../codex-client.js";
import type { QuotaSnapshot } from "../../types.js";

export type QuotaData = {
  anthropic: QuotaSnapshot[];
  antigravity: QuotaSnapshot[];
  codex: QuotaSnapshot[];
};

export async function getQuotaData(): Promise<QuotaData> {
  const [anthropic, antigravity, codex] = await Promise.all([
    loadMultiAccountQuota(),
    loadAntigravityQuota(),
    loadCodexQuota(),
  ]);

  return { anthropic, antigravity, codex };
}
