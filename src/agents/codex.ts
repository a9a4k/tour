// Tour reply-agent adapter for the `codex` CLI (OpenAI Codex CLI).
//
// Shipped as a string constant for the same reason as the claude adapter:
// bun's --compile bundles JS only, so embedding the script as a template
// literal keeps it available in the compiled binary without an extra
// asset-bundling step. On first run, `ensureShippedAdapter("codex")`
// writes this content to `~/.config/tour/agents/codex.sh` (chmod 0755);
// subsequent runs do not overwrite — once the file exists, the user owns it.
//
// Codex's capability-bounding surface differs from claude's: there is no
// per-tool allowlist flag like `--allowedTools`. The closest native
// mechanisms are the sandbox profile (`--sandbox workspace-write` blocks fs
// writes outside cwd via Seatbelt/Landlock) and the approval policy
// (`--ask-for-approval never` prevents the agent from escalating). The
// further narrowing to "tour annotate only" is reinforced in the prompt;
// the runtime guarantee that the agent cannot move the pinned SHA or edit
// code under review comes from the sandbox.
export const CODEX_ADAPTER_SCRIPT = `#!/usr/bin/env bash
# Tour reply-agent adapter for the \`codex\` CLI (OpenAI Codex CLI).
#
# Reads a JSON envelope from stdin (Tour's adapter contract), pulls the
# canonical reply-agent system prompt from \`tour reply-system-prompt\`, and
# invokes \`codex exec\` capability-bounded so the agent runs inside codex's
# native sandbox. The agent inside writes its reply via
# \`tour annotate --as-agent --reply-to <id>\`; this script exits when codex
# exits.
#
# Capability bounding (codex has no per-tool allowlist like claude):
#   --sandbox workspace-write    fs writes restricted to cwd via Seatbelt
#                                (macOS) / Landlock (Linux). The agent cannot
#                                touch \$HOME, system paths, or anything
#                                outside the repo root.
#   --ask-for-approval never     codex never asks for privilege escalation,
#                                so the sandbox profile is final.
#   --skip-git-repo-check        Tour reviews are pinned to a specific repo
#                                state; we already know cwd is the repo.
#
# Codex has no \`--system-prompt\` flag at the CLI surface, so the canonical
# system prompt is folded into the prompt argument with a clear delimiter.
#
# Required env (set by the Tour runtime):
#   TOUR_ID         — id of the Tour the human's note landed in
#   TOUR_HEAD_SHA   — pinned head SHA
#   TOUR_BASE_SHA   — pinned base SHA
#   TOUR_DIR        — path to .tour/<id>/
#
# Required on PATH:
#   tour    — the Tour binary
#   codex   — the OpenAI Codex CLI
#
# Customization: edit this file in place. Tour will not overwrite it on
# subsequent runs once it exists at ~/.config/tour/agents/codex.sh.

set -euo pipefail

ENVELOPE="$(cat)"
SYSTEM_PROMPT="$(tour reply-system-prompt)"

USER_PROMPT="<system>
\${SYSTEM_PROMPT}
</system>

A human reviewer just left a note in Tour \${TOUR_ID}. The JSON envelope below contains the tour metadata, the triggering annotation, and the full thread chain.

<envelope>
\${ENVELOPE}
</envelope>

Read the triggering_annotation and the thread, then either:
  - reply via: tour annotate \\"\${TOUR_ID}\\" --reply-to <triggering_annotation.id> --as-agent --author codex --body \\"<your reply>\\"
  - or exit silently if the note is just an acknowledgment.

Use the triggering_annotation.id from the envelope as the --reply-to argument.
Do not run any other shell command. Do not edit files. Your only available action is the single \\\`tour annotate\\\` invocation above."

exec codex exec \\
  --sandbox workspace-write \\
  --ask-for-approval never \\
  --skip-git-repo-check \\
  "\${USER_PROMPT}"
`;
