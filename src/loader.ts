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

async function readJsonFile(filePath: string): Promise<MessageJson> {
  if (isBun) {
    return Bun.file(filePath).json() as Promise<MessageJson>;
  }
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as MessageJson;
}

export async function loadMessages(
  storagePath: string,
  providerFilter?: string
): Promise<MessageJson[]> {
  const messagesDir = join(storagePath, "message");
  const messages: MessageJson[] = [];

  try {
    const sessionDirs = readdirSync(messagesDir);

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(messagesDir, sessionDir);
      const stat = statSync(sessionPath);

      if (!stat.isDirectory()) continue;

      const messageFiles = readdirSync(sessionPath).filter((f) =>
        f.endsWith(".json")
      );

      for (const messageFile of messageFiles) {
        try {
          const messagePath = join(sessionPath, messageFile);
          const msg = await readJsonFile(messagePath);

          if (msg.role === "user") continue;
          if (!msg.tokens) continue;

          const providerId =
            msg.model?.providerID ?? msg.providerID ?? "unknown";

          if (providerFilter && providerId.toLowerCase() !== providerFilter) {
            continue;
          }

          messages.push(msg);
        } catch {
          // Skip invalid JSON files
        }
      }
    }
  } catch (err) {
    console.error(`Error reading messages directory: ${err}`);
  }

  return messages;
}
