---
name: tour
description: >
  Tour is a local code-walkthrough CLI for AI agents. After finishing a
  task, the agent leaves line-anchored comments on a pinned git diff
  (a guided traversal) that a human steps through in a TUI or webapp.

  Activates when the user asks to "review this branch", "review this PR",
  "walk me through this diff", "leave feedback on these changes", "comment
  on the diff", "create a tour", or whenever the agent has produced
  line-anchored findings (security scan, lint output, external review) the
  human will read asynchronously. Also activates on responding to a human
  reply on an existing Tour, via `tour pickup`.

  Does NOT apply to inline chat feedback consumed this turn, opening GitHub
  PRs, filing issues, or repo-wide notes with no line anchor.
allowed-tools: Bash(tour:*),
  Bash(bunx tourdiff:*),
  Bash(npx tourdiff:*),
  Bash(npx -y tourdiff:*),
  Bash(pnpm dlx tourdiff:*),
  Bash(yarn dlx tourdiff:*)
---

# Tour

## Author

Before creating: if `tour list --status open --json` returns a tour whose `head_sha` matches `git rev-parse HEAD`, reuse its id. Otherwise create.

```sh
TOUR_ID=$(tour create --head HEAD --title "<short>")
cat <<'JSONL' | tour comment "$TOUR_ID" --batch -
{"file":"src/foo.ts","side":"additions","line_start":12,"line_end":14,"body":"..."}
{"file":"src/foo.ts","side":"additions","line_start":40,"body":"..."}
JSONL
tour serve "$TOUR_ID" --reply-agent claude &
```

The server prints a clickable URL. Your job ends there — don't pass `--open`.

For terminal review: `tour tui "$TOUR_ID"`.

Pass `--reply-agent <name>` only when you can self-identify (Claude Code → `claude`, Codex → `codex`). If unsure, drop the flag — Tour auto-detects shipped CLIs on PATH. See [REFERENCE.md](REFERENCE.md#reply-agent-selection).

Uncommitted work: `--head WIP` (synthetic snapshot, no commit needed).

`--base` only for non-default-branch targets; default matches the GitHub PR diff. See [REFERENCE.md](REFERENCE.md#base-resolution).

## Comment rules

1. **Architectural scope.** Tour is the senior-engineer walkthrough. Every comment is real cost; if a beat doesn't earn its place, cut it.
2. **Order by reading flow, motivation first.** Open with one comment answering _why does this PR exist?_ (the problem, not the diff) — anchored to a representative line or the first changed file. Then move through the changes in reading order, not file order.
3. **What to comment on**: new dependency shapes, why a refactor moved boundaries this way, the non-obvious trade-off, the part the diff doesn't explain, the bug's root cause.
4. **What to skip**: variable renames, micro-formatting, "five lines instead of seven", linter-catchable nits. If the diff is the explanation, don't comment.
5. **Lead with the claim; cut unless un-evaluable.** Sentence 1 is the load-bearing point — a reader who stops there has the answer. Sentences 2+ survive only if removing them leaves the claim unjudgable by a reasonable reviewer of this codebase. Evidence (provenance, timeline, links) is reply material — the reader can ask.
6. **Match medium to message.** Diagrams for flow, snippets for code changes, tables for comparisons, prose for the *why* and the narrative. Markdown renders rich in the webapp.
7. **Findings batch**: external findings (security scan, lint, thorough-review) get one comment per finding — drop the narrative arc. Optional `[severity]` prefix per [Conventional Comments](https://conventionalcomments.org/).

## Continue (pickup)

When the user references human comments on an existing Tour:

```sh
tour pickup "$TOUR_ID" --json
```

Returns comments + replies. Actors:

| `author_kind` | `author` value                                    | Actor         |
| ------------- | ------------------------------------------------- | ------------- |
| `"human"`     | (any)                                             | Human         |
| `"agent"`     | `claude` / `codex` / `gemini` / `opencode` / `pi` | Reply-agent   |
| `"agent"`     | other                                             | You (earlier) |

Most human comments have no reply-agent child — they're directives for you. Comments with a reply-agent child already had one agent turn; you may need to follow up.

For each thread: code change | reply | close | defer. Reply with `replies_to`:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"<comment-id>","body":"..."}' | tour comment "$TOUR_ID" --batch -
```

Replies inherit the parent's anchor; `file`/`side`/`line_start` are still required at write time.

## Lookup

```sh
tour list --json
tour show "$TOUR_ID" --json
tour serve "$TOUR_ID" --reply-agent claude &
```

Reuse when `head_sha` matches current HEAD; create a new Tour when it doesn't.

## Reference

- [REFERENCE.md](REFERENCE.md) — JSONL schema, flag reference, reply-agent registry, install fallback, edge cases
- [EXAMPLES.md](EXAMPLES.md) — worked examples
