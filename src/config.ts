// Tiny JSON config: ~/.config/ctui/config.json (Windows: %APPDATA%\ctui\config.json)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export function configPath(): string {
  if (process.env.CTUI_CONFIG) return process.env.CTUI_CONFIG
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "ctui", "config.json")
}

export function loadConfig(): Record<string, any> {
  try {
    const d = JSON.parse(readFileSync(configPath(), "utf8"))
    return d && typeof d === "object" ? d : {}
  } catch {
    return {}
  }
}

export function saveConfig(cfg: Record<string, any>) {
  try {
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
  } catch {}
}
