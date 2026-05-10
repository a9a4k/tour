// Tour reply-agent adapter for the `opencode` CLI.
//
// Shipped as a TS string constant for the same reason as claude.ts: bun's
// --compile bundles JS only, so embedding the script as a template literal
// keeps it available in the compiled binary without an extra asset-bundling
// step. On first run, `ensureShippedAdapter("opencode")` writes this content
// to `~/.config/tour/agents/opencode.sh` (chmod 0755). Subsequent runs do
// not overwrite — once the file exists, the user owns it.
//
// Why the shape differs from claude.ts: the `opencode` CLI does not expose
// per-invocation flags for system prompt or allowed-tools (claude has
// `--system-prompt` / `--allowedTools`; opencode does not). Capability
// bounding is configured via an opencode.json config file. The adapter
// materializes an ephemeral config in a /tmp dir and points
// `OPENCODE_CONFIG` at it so the agent's permission rules (deny edit/write
// and bare bash, allow only `tour annotate ...`) are enforced by opencode's
// runtime — not just hortatory in the system prompt. The /tmp dir leaks
// because `exec` discards EXIT traps; preserving `exec` semantics is
// load-bearing for `tour reply-cancel` (the runner records this script's
// pid in the lockfile and SIGKILLs it on cancel — without `exec` the kill
// would hit the shell parent and orphan opencode). OS tmp cleanup handles
// the leaked few-KB dir.
export const OPENCODE_ADAPTER_SCRIPT = `#!/usr/bin/env bash
# Tour reply-agent adapter for the \`opencode\` CLI.
#
# Reads a JSON envelope from stdin (Tour's adapter contract), pulls the
# canonical reply-agent system prompt from \`tour reply-system-prompt\`, and
# invokes \`opencode run --agent tour-reply\` with an ephemeral, capability-
# bounded agent config in /tmp. The agent inside writes its reply via
# \`tour annotate --as-agent --reply-to <id>\` — the only Bash pattern the
# permission rules allow.
#
# Capability bounding is enforced by opencode's permission system (last-
# match-wins glob on bash patterns; \`*\` deny + \`tour annotate *\` allow),
# not just hortatory in the system prompt. Top-level edit/write tools are
# also denied so the agent literally cannot touch source files.
#
# Required env (set by the Tour runtime):
#   TOUR_ID         — id of the Tour the human's note landed in
#   TOUR_HEAD_SHA   — pinned head SHA
#   TOUR_BASE_SHA   — pinned base SHA
#   TOUR_DIR        — path to .tour/<id>/
#
# Required on PATH:
#   tour      — the Tour binary
#   opencode  — the opencode CLI
#
# Customization: edit this file in place. Tour will not overwrite it on
# subsequent runs once it exists at ~/.config/tour/agents/opencode.sh.

set -euo pipefail

ENVELOPE="$(cat)"

# Ephemeral config dir. Leaks on \`exec\` (EXIT traps don't fire across
# exec); kept in /tmp so the OS reclaims it on the standard cadence.
WORKDIR="$(mktemp -d -t tour-opencode-XXXXXX)"

tour reply-system-prompt > "\${WORKDIR}/system-prompt.txt"

# opencode.json: the agent named \`tour-reply\` is the only mode opencode
# will run, with both top-level and per-agent permission rules denying
# everything except the single \`tour annotate ...\` Bash pattern. Last-
# match-wins glob ordering means the explicit allow overrides the catch-
# all deny for that one pattern only.
cat > "\${WORKDIR}/opencode.json" <<JSON_END
{
  "permission": {
    "edit": "deny",
    "write": "deny",
    "bash": {
      "*": "deny",
      "tour annotate *": "allow"
    }
  },
  "agent": {
    "tour-reply": {
      "description": "Tour reply-agent (ephemeral, capability-bounded)",
      "mode": "primary",
      "prompt": "{file:\${WORKDIR}/system-prompt.txt}",
      "permission": {
        "edit": "deny",
        "write": "deny",
        "bash": {
          "*": "deny",
          "tour annotate *": "allow"
        }
      }
    }
  }
}
JSON_END

USER_PROMPT="A human reviewer just left a note in Tour \${TOUR_ID}. The JSON envelope below contains the tour metadata, the triggering annotation, and the full thread chain.

<envelope>
\${ENVELOPE}
</envelope>

Read the triggering_annotation and the thread, then either:
  - reply via: tour annotate \\"\${TOUR_ID}\\" --reply-to <triggering_annotation.id> --as-agent --author opencode --body \\"<your reply>\\"
  - or exit silently if the note is just an acknowledgment.

Use the triggering_annotation.id from the envelope as the --reply-to argument."

export OPENCODE_CONFIG="\${WORKDIR}/opencode.json"
exec opencode run --agent tour-reply "\${USER_PROMPT}"
`;
