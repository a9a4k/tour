#!/usr/bin/env bash
# Test-only adapter: read the JSON envelope from stdin, look up the triggering
# annotation's id, and emit a canned agent reply via `tour annotate
# --as-agent --reply-to`. Used to demonstrate the reply-agent loop end-to-end
# without depending on a real LLM CLI.
#
# Required env: TOUR_ID (set by the runtime).
# Optional env: TOUR_CLI (path to the Tour binary; defaults to `tour` on PATH).
#               TOUR_FIXTURE_BODY (the canned reply body; defaults below).

set -e

ENVELOPE="$(cat)"
TRIGGER_ID="$(printf '%s' "$ENVELOPE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(j.triggering_annotation.id);})')"

BODY="${TOUR_FIXTURE_BODY:-fixture: thanks for the note — this is a canned reply.}"
CLI="${TOUR_CLI:-tour}"

"$CLI" annotate "$TOUR_ID" \
  --reply-to "$TRIGGER_ID" \
  --body "$BODY" \
  --as-agent \
  --author "fixture-agent"
