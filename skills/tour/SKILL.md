---
name: tour
description: >
  Tour is a local code-review CLI for AI agents that authors line-anchored
  annotations on a pinned git diff (a guided traversal) for a human to read
  later in a TUI or webapp.

  Activates when the user asks to "review this branch", "review this PR",
  "walk me through this diff", "leave feedback on these changes", "annotate
  the diff", "create a tour", or whenever the agent has produced
  line-anchored findings (security scan, lint output, external review) the
  human will read asynchronously. Also activates on responding to a human
  reply on an existing Tour, via `tour pickup`.

  Default annotation style is a narrative walkthrough — the reader lacks
  context about the problem, the codebase, or prior discussion; explain
  why, not just what. Findings-style batches are a supported variation.

  Does NOT apply to inline chat feedback consumed this turn, opening GitHub
  PRs (use `gh pr create`), filing issues, or repo-wide notes with no line
  anchor.
allowed-tools:
  Bash(tour:*),
  Bash(tourdiff:*),
  Bash(bunx tourdiff:*),
  Bash(npx tourdiff:*),
  Bash(npx -y tourdiff:*)
---

# Tour

A Tour is a guided traversal of a pinned git diff. The agent authors line-anchored annotations via CLI; the human reads them in a TUI or webapp; reply-agents respond to human replies in the background; the main-agent (you) closes the loop via `tour pickup`.

## Pick your phase

| Phase | When | Verbs |
|---|---|---|
| **Author** | User asks for review / feedback / a tour on a branch or diff | `tour create`, `tour annotate`, `tour serve --open` |
| **Continue** | Human replied on an existing Tour; user wants you to act on it | `tour pickup`, `tour annotate` with `replies_to` |
| **Lookup** | User references an existing Tour | `tour list`, `tour show` |

## Default style: narrative walkthrough

The reader has zero context about the problem, the codebase, or prior discussion. Annotations should:

- Explain **why**, not just **what** — the diff already shows what changed.
- Be ordered by reading flow, not file alphabetical order.
- Each annotation is a beat in the walkthrough.
- Shape varies by PR: a small refactor needs 2–3 beats; a bug fix often leads with root cause; a feature PR may need a context-setting opener. Use judgment; don't force a rigid skeleton onto small changes.

**Non-negotiable**: if an annotation requires the reader to have read the linked issue, know a codebase convention, or remember a Slack thread, inline that context or drop the annotation.

**Findings variation**: when converting external findings (security scan, lint output, thorough-review results) into Tour annotations, drop the narrative arc — one annotation per finding. Mechanically identical to author phase, stylistically a peer.

## Author — quick start

```sh
TOUR_ID=$(tour create --head HEAD --json | jq -r .id)

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/foo.ts","side":"additions","line_start":12,"line_end":14,"body":"..."}
{"file":"src/foo.ts","side":"additions","line_start":40,"body":"..."}
JSONL

tour serve --open "$TOUR_ID" --reply-agent claude &
```

Always end with `tour serve --open <id> --reply-agent <name> &` — this opens the webapp for the human *and* enables the reply-agent so their replies get answered. Without `--reply-agent`, the commenting feature appears broken to the human. See [REFERENCE.md](REFERENCE.md#reply-agent-selection) for picking `<name>`.

Skip the auto-open only when the user explicitly says "don't open it" or "I'll look at it later".

## Continue (pickup) — quick start

```sh
tour pickup "$TOUR_ID" --json
```

Returns a `ConversationTree` with threaded annotations. Distinguish actors by the `author` field:

| `author_kind` | `author` value | Actor |
|---|---|---|
| `"human"` | (any) | Human |
| `"agent"` | `claude` / `codex` / `gemini` / `opencode` / `pi` | Reply-agent |
| `"agent"` | `"agent"` (literal) or anything else | Main-agent (you, earlier) |

For each thread, decide: code change | reply | close | defer. Reply by writing an annotation with `replies_to` set:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"ann_xxx","body":"..."}' \
  | tour annotate "$TOUR_ID" --batch -
```

Reply annotations inherit their parent's anchor, but the schema still requires `file`/`side`/`line_start` for write-time validation. See [EXAMPLES.md](EXAMPLES.md) for full pickup → action flows.

## Lookup — quick start

```sh
tour list --json                  # find existing tours in this repo
tour show "$TOUR_ID" --json       # inspect a specific tour without TUI
```

Reuse an existing Tour for the same HEAD; create a new one for a different HEAD.

## Install fallback

If `tour` isn't on `PATH`:

```sh
bunx tourdiff <command> ...        # bun
npx -y tourdiff <command> ...      # npm
```

## Further reading

- [REFERENCE.md](REFERENCE.md) — JSONL schema, full flag reference, reply-agent registry, edge cases
- [EXAMPLES.md](EXAMPLES.md) — worked examples: narrative refactor tour, findings batch, pickup → reply, pickup → code change
