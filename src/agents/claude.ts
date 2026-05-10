// Tour reply-agent adapter for the `claude` CLI (Claude Code).
//
// Shipped with the Tour binary as a string constant rather than a separate
// .sh file: bun's --compile bundles JS only, so embedding the script as a
// template literal keeps it available in the compiled binary without an
// extra asset-bundling step. On first run, `ensureShippedAdapter("claude")`
// writes this content to `~/.config/tour/agents/claude.sh` (chmod 0755)
// so users can read, edit, or replace it with a custom version. Subsequent
// runs do not overwrite — once the file exists, the user owns it.
export const CLAUDE_ADAPTER_SCRIPT = `#!/usr/bin/env bash
# Tour reply-agent adapter for the \`claude\` CLI (Claude Code).
#
# Reads a JSON envelope from stdin (Tour's adapter contract), pulls the
# canonical reply-agent system prompt from \`tour reply-system-prompt\`, and
# invokes \`claude --print\` capability-bounded so the agent's only callable
# tool is \`tour annotate --as-agent --reply-to <id>\`. The agent inside
# writes its reply via that single allowed tool; this script exits when
# claude exits. Capability-bounding is enforced by claude's native
# allow/deny flag surface, not just hortatory in the system prompt.
#
# Required env (set by the Tour runtime):
#   TOUR_ID         — id of the Tour the human's note landed in
#   TOUR_HEAD_SHA   — pinned head SHA
#   TOUR_BASE_SHA   — pinned base SHA
#   TOUR_DIR        — path to .tour/<id>/
#
# Required on PATH:
#   tour    — the Tour binary
#   claude  — the Claude Code CLI
#
# Customization: edit this file in place. Tour will not overwrite it on
# subsequent runs once it exists at ~/.config/tour/agents/claude.sh.

set -euo pipefail

ENVELOPE="$(cat)"
SYSTEM_PROMPT="$(tour reply-system-prompt)"

USER_PROMPT="A human reviewer just left a note in Tour \${TOUR_ID}. The JSON envelope below contains the tour metadata, the triggering annotation, and the full thread chain.

<envelope>
\${ENVELOPE}
</envelope>

Read the triggering_annotation and the thread, then either:
  - reply via: tour annotate \\"\${TOUR_ID}\\" --reply-to <triggering_annotation.id> --as-agent --author claude --body \\"<your reply>\\"
  - or exit silently if the note is just an acknowledgment.

Use the triggering_annotation.id from the envelope as the --reply-to argument."

# --print: non-interactive single-shot.
# --allowedTools: only \`tour annotate ...\` Bash patterns are permitted.
# --disallowedTools: hard-deny Edit, Write, and bare Bash so the only path
#   for the agent to act on the world is the single allowed pattern above.
# The trailing \`--\` is required because --disallowedTools is variadic in
# claude's CLI: without the separator it would swallow USER_PROMPT as another
# tool name, leaving claude with no prompt and erroring with
# "Input must be provided…".
exec claude --print \\
  --system-prompt "\${SYSTEM_PROMPT}" \\
  --allowedTools "Bash(tour annotate:*)" \\
  --disallowedTools "Edit Write Bash" \\
  -- "\${USER_PROMPT}"
`;
