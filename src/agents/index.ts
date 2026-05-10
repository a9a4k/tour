// Registry of adapter shell scripts shipped with the Tour binary. Keyed by
// agent name; the value is the script content. `ensureShippedAdapter` reads
// from this map on first run and writes the script to
// ~/.config/tour/agents/<name>.sh.
//
// All adapters from PRD #73 (slices 6–10) have shipped.
import { CLAUDE_ADAPTER_SCRIPT } from "./claude.js";
import { CODEX_ADAPTER_SCRIPT } from "./codex.js";
import { GEMINI_ADAPTER_SCRIPT } from "./gemini.js";
import { OPENCODE_ADAPTER_SCRIPT } from "./opencode.js";
import { PI_ADAPTER_SCRIPT } from "./pi.js";

export const SHIPPED_ADAPTERS: Record<string, string> = {
  claude: CLAUDE_ADAPTER_SCRIPT,
  codex: CODEX_ADAPTER_SCRIPT,
  gemini: GEMINI_ADAPTER_SCRIPT,
  opencode: OPENCODE_ADAPTER_SCRIPT,
  pi: PI_ADAPTER_SCRIPT,
};
