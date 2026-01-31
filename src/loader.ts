/**
 * OpenCode storage data loader - works with both Bun and Node.js
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageJson } from "./types.js";

// Runtime detection
const isBun = typeof globalThis.Bun !== "undefined";

export function getOpenCodeStoragePath(): string {
  const xdgDataHome =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdgDataHome, "opencode", "storage");
}

const BATCH_SIZE = 500;

async function readJsonFile(filePath: string): Promise<MessageJson> {
  if (isBun) {
    return Bun.file(filePath).json() as Promise<MessageJson>;
  }
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as MessageJson;
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

export async function loadMessages(
  storagePath: string,
  providerFilter?: string
): Promise<MessageJson[]> {
  const messagesDir = join(storagePath, "message");

  try {
    const sessionDirs = readdirSync(messagesDir);

    const filePaths: string[] = [];
    for (const sessionDir of sessionDirs) {
      const sessionPath = join(messagesDir, sessionDir);
      const stat = statSync(sessionPath);

      if (!stat.isDirectory()) continue;

      const messageFiles = readdirSync(sessionPath).filter((f) =>
        f.endsWith(".json")
      );

      for (const messageFile of messageFiles) {
        filePaths.push(join(sessionPath, messageFile));
      }
    }

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
