// Tour reply-agent adapter for the `gemini` CLI (Google Gemini CLI).
//
// Shipped with the Tour binary as a string constant — same rationale as
// claude.ts: bun's --compile bundles JS only, so embedding the script as a
// template literal keeps it available in the compiled binary without an
// extra asset-bundling step. On first run, `ensureShippedAdapter("gemini")`
// writes this content to `~/.config/tour/agents/gemini.sh` (chmod 0755).
// Subsequent runs do not overwrite — the user owns that path once it exists.
//
// Capability-bounding gap: gemini-cli's tool surface is younger than
// claude's and the flag names / tool registry names have shifted across
// releases. We use `--allowed-tools "ShellTool(tour annotate)"` (auto-
// approves only shell commands matching the prefix) plus
// `--exclude-tools "WriteFileTool,EditTool"` (hard-denies the file-mutating
// tools). If a future gemini-cli release renames these flags or the
// ShellTool registry entry, edit this file in place — Tour will not
// overwrite a user-edited adapter.
export const GEMINI_ADAPTER_SCRIPT = `#!/usr/bin/env bash
# Tour reply-agent adapter for the \`gemini\` CLI (Google Gemini CLI).
#
# Reads a JSON envelope from stdin (Tour's adapter contract), pulls the
# canonical reply-agent system prompt from \`tour reply-system-prompt\`, and
# invokes \`gemini --prompt\` capability-bounded so the agent's only callable
# shell prefix is \`tour annotate ...\`. The agent inside writes its reply
# via that single allowed pattern; this script exits when gemini exits.
# Capability-bounding is enforced by gemini's native allow-list, not just
# hortatory in the prompt.
#
# Required env (set by the Tour runtime):
#   TOUR_ID         — id of the Tour the human's note landed in
#   TOUR_HEAD_SHA   — pinned head SHA
#   TOUR_BASE_SHA   — pinned base SHA
#   TOUR_DIR        — path to .tour/<id>/
#
# Required on PATH:
#   tour    — the Tour binary
#   gemini  — the Google Gemini CLI
#
# Notes on capability bounding:
#   gemini-cli does not expose a separate --system-prompt flag the way
#   claude does — system instructions are inlined at the top of the user
#   prompt (or supplied via a GEMINI.md context file). We choose inlining
#   so the adapter is self-contained and does not write any files.
#
#   The allow-list flag accepts a tool registry name; for the shell tool
#   it accepts a parametrized prefix as \`ShellTool(<command-prefix>)\`,
#   meaning only shell commands starting with that prefix auto-approve.
#   In non-interactive mode (no TTY for approval prompts), tools outside
#   the allow-list cannot run. Combined with --exclude-tools for the
#   file-mutating tools, the surface is "tour annotate <anything>" only.
#
# Customization: edit this file in place. Tour will not overwrite it on
# subsequent runs once it exists at ~/.config/tour/agents/gemini.sh.

set -euo pipefail

ENVELOPE="$(cat)"
SYSTEM_PROMPT="$(tour reply-system-prompt)"

# Gemini has no --system-prompt flag, so we concatenate the canonical
# reply-system-prompt with the per-invocation framing.
PROMPT="\${SYSTEM_PROMPT}

A human reviewer just left a note in Tour \${TOUR_ID}. The JSON envelope below contains the tour metadata, the triggering annotation, and the full thread chain.

<envelope>
\${ENVELOPE}
</envelope>

Read the triggering_annotation and the thread, then either:
  - reply via: tour annotate \\"\${TOUR_ID}\\" --reply-to <triggering_annotation.id> --as-agent --author gemini --body \\"<your reply>\\"
  - or exit silently if the note is just an acknowledgment.

Use the triggering_annotation.id from the envelope as the --reply-to argument."

# --prompt: non-interactive single-shot.
# --allowed-tools: only shell commands starting with \`tour annotate\` are
#   auto-approved. Tools outside the allow-list require interactive
#   approval and therefore fail in non-TTY mode.
# --exclude-tools: hard-deny the file-mutating tools so a future gemini-cli
#   release that softens allow-list semantics still cannot widen the surface.
exec gemini \\
  --allowed-tools "ShellTool(tour annotate)" \\
  --exclude-tools "WriteFileTool,EditTool" \\
  --prompt "\${PROMPT}"
`;
