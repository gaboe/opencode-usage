import { readdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageJson, CursorState } from "./types.js";

const isBun = typeof globalThis.Bun !== "undefined";
const BATCH_SIZE = 10000;

export function getOpenCodeStoragePath(): string {
  const xdgDataHome =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdgDataHome, "opencode", "storage");
}

async function readJsonFile(filePath: string): Promise<MessageJson> {
  const content = isBun
    ? await Bun.file(filePath).text()
    : await readFile(filePath, "utf-8");
  return JSON.parse(content) as MessageJson;
}

async function collectFilePaths(messagesDir: string): Promise<string[]> {
  const sessionDirs = await readdir(messagesDir);

  const pathArrays = await Promise.all(
    sessionDirs.map(async (sessionDir) => {
      const sessionPath = join(messagesDir, sessionDir);
      const st = await stat(sessionPath);
      if (!st.isDirectory()) return [];

      const files = await readdir(sessionPath);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(sessionPath, f));
    })
  );

  return pathArrays.flat();
}

async function processInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export async function loadRecentMessages(
  storagePath: string,
  hoursBack: number = 24,
  providerFilter?: string
): Promise<MessageJson[]> {
  const messagesDir = join(storagePath, "message");
  const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;

  try {
    const sessionDirs = await readdir(messagesDir);
    const recentFiles: string[] = [];

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(messagesDir, sessionDir);
      try {
        const sessionStat = await stat(sessionPath);
        if (!sessionStat.isDirectory()) continue;
        
        if (sessionStat.mtimeMs < cutoffTime) {
          continue;
        }
      } catch {
        continue;
      }

      const files = await readdir(sessionPath);
      const fileStats = await Promise.all(
        files.map(async (file) => {
          if (!file.endsWith(".json")) return null;
          const filePath = join(sessionPath, file);
          try {
            const fileStat = await stat(filePath);
            return { filePath, mtime: fileStat.mtimeMs };
          } catch {
            return null;
          }
        })
      );

      for (const fileInfo of fileStats) {
        if (fileInfo && fileInfo.mtime >= cutoffTime) {
          recentFiles.push(fileInfo.filePath);
        }
      }
    }

    const results = await processInBatches(
      recentFiles,
      async (filePath) => {
        try {
          return await readJsonFile(filePath);
        } catch {
          return null;
        }
      },
      BATCH_SIZE
    );

    return results.filter((msg): msg is MessageJson => {
      if (!msg) return false;
      if (msg.role === "user") return false;
      if (!msg.tokens) return false;

      if (providerFilter) {
        const providerId = msg.model?.providerID ?? msg.providerID ?? "unknown";
        if (providerId.toLowerCase() !== providerFilter) return false;
      }

      return true;
    });
  } catch (err) {
    console.error(`Error reading recent messages: ${err}`);
    return [];
  }
}

export async function loadMessages(
  storagePath: string,
  providerFilter?: string
): Promise<MessageJson[]> {
  const messagesDir = join(storagePath, "message");

  try {
    const filePaths = await collectFilePaths(messagesDir);

    const results = await processInBatches(
      filePaths,
      async (filePath) => {
        try {
          return await readJsonFile(filePath);
        } catch {
          return null;
        }
      },
      BATCH_SIZE
    );

    return results.filter((msg): msg is MessageJson => {
      if (!msg) return false;
      if (msg.role === "user") return false;
      if (!msg.tokens) return false;

      if (providerFilter) {
        const providerId = msg.model?.providerID ?? msg.providerID ?? "unknown";
        if (providerId.toLowerCase() !== providerFilter) return false;
      }

      return true;
    });
  } catch (err) {
    console.error(`Error reading messages directory: ${err}`);
    return [];
  }
}

/**
 * Create an empty cursor state for first load
 */
export function createCursor(): CursorState {
  return {
    knownSessions: new Set(),
    fileCountPerSession: new Map(),
    lastTimestamp: 0,
  };
}

/**
 * Load messages incrementally using cursor state
 * Returns new messages and updated cursor
 */
export async function loadMessagesIncremental(
  storagePath: string,
  cursor: CursorState,
  providerFilter?: string
): Promise<{ messages: MessageJson[]; cursor: CursorState }> {
  const messagesDir = join(storagePath, "message");
  const newMessages: MessageJson[] = [];
  const newCursor: CursorState = {
    knownSessions: new Set(cursor.knownSessions),
    fileCountPerSession: new Map(cursor.fileCountPerSession),
    lastTimestamp: cursor.lastTimestamp,
  };

  try {
    const sessionDirs = await readdir(messagesDir);

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(messagesDir, sessionDir);
      const st = await stat(sessionPath);
      if (!st.isDirectory()) continue;

      const files = await readdir(sessionPath);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const previousCount = cursor.fileCountPerSession.get(sessionDir) ?? 0;

      // Only read new files
      if (jsonFiles.length > previousCount) {
        // Sort files to get consistent ordering (by name = by time usually)
        const sortedFiles = jsonFiles.sort();
        const newFiles = sortedFiles.slice(previousCount);

        for (const file of newFiles) {
          const filePath = join(sessionPath, file);
          try {
            const msg = await readJsonFile(filePath);
            if (isValidMessage(msg, providerFilter)) {
              newMessages.push(msg);
              if (
                msg.time?.created &&
                msg.time.created > newCursor.lastTimestamp
              ) {
                newCursor.lastTimestamp = msg.time.created;
              }
            }
          } catch {
            // Skip invalid files
          }
        }
      }

      newCursor.knownSessions.add(sessionDir);
      newCursor.fileCountPerSession.set(sessionDir, jsonFiles.length);
    }

    return { messages: newMessages, cursor: newCursor };
  } catch (err) {
    console.error(`Error in incremental load: ${err}`);
    return { messages: [], cursor: newCursor };
  }
}

/**
 * Helper to validate message
 */
function isValidMessage(
  msg: MessageJson | null,
  providerFilter?: string
): msg is MessageJson {
  if (!msg) return false;
  if (msg.role === "user") return false;
  if (!msg.tokens) return false;

  if (providerFilter) {
    const providerId = msg.model?.providerID ?? msg.providerID ?? "unknown";
    if (providerId.toLowerCase() !== providerFilter) return false;
  }

  return true;
}
