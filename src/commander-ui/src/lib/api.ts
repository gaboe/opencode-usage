const BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    apiFetch<{ status: string; version: string; timestamp: string }>(
      "/api/health"
    ),
  usage: (params?: Record<string, string>) =>
    apiFetch<unknown>(`/api/usage?${new URLSearchParams(params)}`),
  quota: () => apiFetch<unknown>("/api/quota"),
  configFiles: () =>
    apiFetch<
      Array<{
        source: string;
        path: string;
        exists: boolean;
        parseOk: boolean;
        sizeBytes: number;
      }>
    >("/api/config/files"),
  getConfig: (source: string) => apiFetch<unknown>(`/api/config/${source}`),
  putConfig: (source: string, data: unknown) =>
    apiFetch<{ ok: boolean; backupPath: string }>(`/api/config/${source}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  rollbackConfig: (source: string) =>
    apiFetch<{ ok: boolean; restoredFrom: string }>(
      `/api/config/${source}/rollback`,
      { method: "POST" }
    ),
  apps: () =>
    apiFetch<
      Array<{
        id: string;
        name: string;
        description: string;
        state: string;
        details: string[];
      }>
    >("/api/apps"),
  initApp: (appId: string) =>
    apiFetch<{ jobId: string }>(`/api/apps/${appId}/init`, { method: "POST" }),
  repairApp: (appId: string) =>
    apiFetch<{ jobId: string }>(`/api/apps/${appId}/repair`, {
      method: "POST",
    }),
  runCommand: (commandId: string, payload?: unknown) =>
    apiFetch<{ jobId: string }>("/api/commands/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId, payload }),
    }),
  getJob: (jobId: string) =>
    apiFetch<{
      id: string;
      commandId: string;
      status: string;
      logs: Array<{ ts: string; level: string; message: string }>;
      result?: unknown;
      error?: { code: string; message: string };
    }>(`/api/jobs/${jobId}`),
  accountAction: (provider: string, action: string, alias: string) =>
    apiFetch<{ jobId: string }>(`/api/accounts/${provider}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias }),
    }),
  runAction: (action: string, payload: unknown) =>
    apiFetch<{ jobId: string }>(`/api/actions/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
