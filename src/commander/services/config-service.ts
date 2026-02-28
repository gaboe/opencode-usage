/**
 * Config service — read, write, backup and rollback for Commander-managed config files.
 *
 * Supports atomic writes (tmp + rename) and auto-backup before every mutation.
 */

import { homedir } from "node:os";
import { join, basename } from "node:path";
import { rename, mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";

const isBun = typeof globalThis.Bun !== "undefined";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigSource =
  | "codex-multi-account-accounts"
  | "anthropic-multi-account-state"
  | "antigravity-accounts"
  | "opencode";

export type ConfigFileMeta = {
  source: ConfigSource;
  path: string;
  exists: boolean;
  parseOk: boolean;
  sizeBytes: number;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const BACKUP_ROOT = join(CONFIG_DIR, "commander-backups");

const SOURCE_FILENAMES: Record<ConfigSource, string> = {
  "codex-multi-account-accounts": "codex-multi-account-accounts.json",
  "anthropic-multi-account-state": "anthropic-multi-account-state.json",
  "antigravity-accounts": "antigravity-accounts.json",
  opencode: "opencode.json",
};

const VALID_SOURCES = new Set<string>(Object.keys(SOURCE_FILENAMES));

export function isValidSource(s: string): s is ConfigSource {
  return VALID_SOURCES.has(s);
}

function configPath(source: ConfigSource): string {
  return join(CONFIG_DIR, SOURCE_FILENAMES[source]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file text synchronously — avoids Bun's async I/O thread pool which
 * has intermittent multi-second stalls after idle periods.
 */
function readFileTextSync(path: string): string {
  return readFileSync(path, "utf-8");
}

async function writeFileText(path: string, content: string): Promise<void> {
  if (isBun) {
    await Bun.write(path, content);
    return;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Read cache — small JSON configs don't need disk I/O on every request
// ---------------------------------------------------------------------------

const CONFIG_CACHE_TTL = 2_000; // 2 seconds
const configCache = new Map<string, { data: unknown; expiry: number }>();

function getCached(path: string): unknown | undefined {
  const entry = configCache.get(path);
  if (entry && Date.now() < entry.expiry) return entry.data;
  return undefined;
}

function setCache(path: string, data: unknown): void {
  configCache.set(path, { data, expiry: Date.now() + CONFIG_CACHE_TTL });
}

/** Invalidate cache for a source after writes. */
function invalidateCache(source: ConfigSource): void {
  configCache.delete(configPath(source));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all known config files with metadata.
 */
export async function listConfigFiles(): Promise<ConfigFileMeta[]> {
  const sources = Object.keys(SOURCE_FILENAMES) as ConfigSource[];
  const results: ConfigFileMeta[] = [];

  for (const source of sources) {
    const path = configPath(source);
    let exists = false;
    let parseOk = false;
    let sizeBytes = 0;

    try {
      const s = await stat(path);
      exists = true;
      sizeBytes = s.size;
      const raw = readFileTextSync(path);
      JSON.parse(raw);
      parseOk = true;
    } catch {
      // exists / parseOk remain false as appropriate
    }

    results.push({ source, path, exists, parseOk, sizeBytes });
  }

  return results;
}

/**
 * Read and parse a config file. Throws if missing or unparseable.
 */
export function readConfig(source: ConfigSource): unknown {
  const path = configPath(source);

  // Check cache first
  const cached = getCached(path);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = readFileTextSync(path);
  } catch {
    throw new ConfigError(`Config file not found: ${path}`, 404);
  }

  try {
    const result = JSON.parse(raw) as unknown;
    setCache(path, result);
    return result;
  } catch {
    throw new ConfigError(
      `Config file is not valid JSON: ${basename(path)}`,
      422
    );
  }
}

/**
 * Write config with atomic tmp+rename and auto-backup.
 */
export async function writeConfig(
  source: ConfigSource,
  data: unknown
): Promise<{ backupPath: string }> {
  const path = configPath(source);

  // Backup current file (if it exists) before writing
  const backupPath = await createBackup(source);

  // Atomic write: tmp → rename
  const tmpPath = `${path}.tmp`;
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFileText(tmpPath, content);
  await rename(tmpPath, path);
  invalidateCache(source);

  return { backupPath };
}

/**
 * Rollback config to the latest backup.
 */
export async function rollbackConfig(
  source: ConfigSource
): Promise<{ restoredFrom: string }> {
  const latest = await findLatestBackup(source);
  if (!latest) {
    throw new ConfigError(`No backup found for source: ${source}`, 404);
  }

  const path = configPath(source);

  // Atomic restore: copy to tmp, rename over current
  const tmpPath = `${path}.tmp`;
  await copyFile(latest, tmpPath);
  await rename(tmpPath, path);

  return { restoredFrom: latest };
}

// ---------------------------------------------------------------------------
// Backup helpers
// ---------------------------------------------------------------------------

async function createBackup(source: ConfigSource): Promise<string> {
  const path = configPath(source);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(BACKUP_ROOT, timestamp);
  await mkdir(backupDir, { recursive: true });

  const backupFile = join(backupDir, SOURCE_FILENAMES[source]);

  if (await fileExists(path)) {
    await copyFile(path, backupFile);
  } else {
    // Write an empty marker so we know there was no prior file
    await writeFileText(backupFile, "null\n");
  }

  return backupFile;
}

async function findLatestBackup(source: ConfigSource): Promise<string | null> {
  if (!(await fileExists(BACKUP_ROOT))) return null;

  const entries = await readdir(BACKUP_ROOT);
  // Timestamp dirs sort lexicographically in chronological order
  const sorted = entries.sort();

  // Walk backwards to find the most recent backup containing this source
  for (let i = sorted.length - 1; i >= 0; i--) {
    const candidate = join(BACKUP_ROOT, sorted[i], SOURCE_FILENAMES[source]);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ConfigError";
    this.status = status;
  }
}
