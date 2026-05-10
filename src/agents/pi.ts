// Tour reply-agent adapter for the `pi` CLI (pi-coding-agent).
//
// Shipped with the Tour binary as a string constant rather than a separate
// .sh file: bun's --compile bundles JS only, so embedding the script as a
// template literal keeps it available in the compiled binary without an
// extra asset-bundling step. On first run, `ensureShippedAdapter("pi")`
// writes this content to `~/.config/tour/agents/pi.sh` (chmod 0755) so
// users can read, edit, or replace it with a custom version. Subsequent
// runs do not overwrite — once the file exists, the user owns it.
//
// Capability bounding strategy: pi is a host runtime with read/write/edit/
// bash built-in tools, plus extensions/skills/prompt-templates that may
// register more. The native `--tools` flag is an allowlist of tool names;
// `--tools bash` reduces the surface to a single tool (bash) — no fs read,
// no fs write, no edit. Pi doesn't pattern-match bash invocations the way
// claude's `Bash(tour annotate:*)` does, so within the bash sandbox the
// system prompt + user prompt direct the agent to only call `tour annotate`.
// We additionally pass `--no-extensions --no-skills --no-prompt-templates
// --no-context-files` so nothing in the user's pi config can re-introduce
// banned tools or rewrite the system prompt out from under us — important
// because pi's `--system-prompt` only replaces the default; context files
// and skills append on top by default.
export const PI_ADAPTER_SCRIPT = `#!/usr/bin/env bash
# Tour reply-agent adapter for the \`pi\` CLI (pi-coding-agent).
#
# Reads a JSON envelope from stdin (Tour's adapter contract), pulls the
# canonical reply-agent system prompt from \`tour reply-system-prompt\`, and
# invokes \`pi --print\` capability-bounded so the only available tool is
# bash. The system prompt + user prompt confine bash to \`tour annotate\`;
# the agent inside writes its reply via that path. This script exits when
# pi exits.
#
# Capability-bounding is enforced by pi's native \`--tools\` allowlist (only
# bash is exposed, so no fs read/write). Pi doesn't allowlist bash command
# patterns like claude does — within bash, the prompt is the boundary. The
# \`--no-*\` flags below stop user-side pi config (extensions, skills,
# context files, prompt templates) from re-introducing banned tools or
# overriding the system prompt.
#
# Required env (set by the Tour runtime):
#   TOUR_ID         — id of the Tour the human's note landed in
#   TOUR_HEAD_SHA   — pinned head SHA
#   TOUR_BASE_SHA   — pinned base SHA
#   TOUR_DIR        — path to .tour/<id>/
#
# Required on PATH:
#   tour    — the Tour binary
#   pi      — the pi-coding-agent CLI
#
# Customization: edit this file in place. Tour will not overwrite it on
# subsequent runs once it exists at ~/.config/tour/agents/pi.sh.

set -euo pipefail

ENVELOPE="$(cat)"
SYSTEM_PROMPT="$(tour reply-system-prompt)"

USER_PROMPT="A human reviewer just left a note in Tour \${TOUR_ID}. The JSON envelope below contains the tour metadata, the triggering annotation, and the full thread chain.

<envelope>
\${ENVELOPE}
</envelope>

Read the triggering_annotation and the thread, then either:
  - reply via: tour annotate \\"\${TOUR_ID}\\" --reply-to <triggering_annotation.id> --as-agent --author pi --body \\"<your reply>\\"
  - or exit silently if the note is just an acknowledgment.

Use the triggering_annotation.id from the envelope as the --reply-to argument."

# --print: non-interactive single-shot.
# --tools bash: only the bash tool is exposed (no read/write/edit/grep/find/ls).
# --no-extensions/skills/prompt-templates/context-files: stop user pi config
#   from re-introducing banned tools or overriding the system prompt.
# --system-prompt: canonical Tour reply-agent prompt; replaces pi's default.
exec pi --print \\
  --system-prompt "\${SYSTEM_PROMPT}" \\
  --tools bash \\
  --no-extensions \\
  --no-skills \\
  --no-prompt-templates \\
  --no-context-files \\
  "\${USER_PROMPT}"
`;
