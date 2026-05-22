// Registry of TS-native reply-agent adapters shipped with the Tour binary.
// Keyed by the name passed via `--reply-agent <name>`. Each adapter spawns
// its inner CLI directly via child_process.spawn — no on-disk script, no
// `~/.config/tour/agents/` materialisation. Custom (out-of-tree) adapters
// are not honored.
import type { ShippedAdapter } from "../core/agent-adapter.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";
import { opencodeAdapter } from "./opencode.js";
import { piAdapter } from "./pi.js";

export const SHIPPED_ADAPTERS: Record<string, ShippedAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
  pi: piAdapter,
};

export function availableShippedAgents(): string[] {
  return Object.keys(SHIPPED_ADAPTERS).sort();
}

// Hard-fails at startup if `name` is not in the shipped registry. The error
// message lists the supported names so users see what they can pick from.
export function assertShippedAgent(name: string, sourcePath?: string): void {
  if (!(name in SHIPPED_ADAPTERS)) {
    const provenance = sourcePath ? ` (from ${sourcePath})` : "";
    throw new Error(
      `Unknown reply-agent "${name}"${provenance}. Available agents: ${availableShippedAgents().join(", ")}`,
    );
  }
}
