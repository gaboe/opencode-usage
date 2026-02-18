import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configDir, "opencode", "opencode-usage-config.json");
}
