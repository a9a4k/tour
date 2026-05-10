// Registry of adapter shell scripts shipped with the Tour binary. Keyed by
// agent name; the value is the script content. `ensureShippedAdapter` reads
// from this map on first run and writes the script to
// ~/.config/tour/agents/<name>.sh.
//
// New adapters land here as they ship: codex, opencode, pi follow in the
// remaining slices per PRD #73.
import { CLAUDE_ADAPTER_SCRIPT } from "./claude.js";
import { GEMINI_ADAPTER_SCRIPT } from "./gemini.js";

export const SHIPPED_ADAPTERS: Record<string, string> = {
  claude: CLAUDE_ADAPTER_SCRIPT,
  gemini: GEMINI_ADAPTER_SCRIPT,
};
