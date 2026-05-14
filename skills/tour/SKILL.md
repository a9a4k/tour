---
name: tour
description: >
  Tour is a local code-walkthrough CLI for AI agents. After finishing a
  task, the agent leaves line-anchored annotations on a pinned git diff
  (a guided traversal) that a human steps through in a TUI or webapp.

  Activates when the user asks to "review this branch", "review this PR",
  "walk me through this diff", "leave feedback on these changes", "annotate
  the diff", "create a tour", or whenever the agent has produced
  line-anchored findings (security scan, lint output, external review) the
  human will read asynchronously. Also activates on responding to a human
  reply on an existing Tour, via `tour pickup`.

  Does NOT apply to inline chat feedback consumed this turn, opening GitHub
  PRs, filing issues, or repo-wide notes with no line
  anchor. For annotation style and authoring guidance, see the body of
  this skill.
allowed-tools: Bash(tour:*),
  Bash(bunx tourdiff:*),
  Bash(npx tourdiff:*),
  Bash(npx -y tourdiff:*),
  Bash(pnpm dlx tourdiff:*),
  Bash(yarn dlx tourdiff:*)
---

# Tour

## Author

When asked for a review / walkthrough on a branch or diff:

```sh
TOUR_ID=$(tour create --head HEAD)
cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/foo.ts","side":"additions","line_start":12,"line_end":14,"body":"..."}
{"file":"src/foo.ts","side":"additions","line_start":40,"body":"..."}
JSONL
tour serve "$TOUR_ID" --reply-agent claude &
```

The background server prints a Cmd/Ctrl-clickable URL. Your job ends there — don't pass `--open`. Same-cwd re-runs reuse the running server.

For terminal review: `tour tui "$TOUR_ID"`.

Pass `--reply-agent <name>` only when you can self-identify (Claude Code → `claude`, Codex → `codex`). If unsure, drop the flag — Tour auto-detects shipped CLIs on PATH. See [REFERENCE.md](REFERENCE.md#reply-agent-selection).

For uncommitted work, use `--head WIP` — Tour snapshots the working tree as a synthetic commit; no need to commit first.

Don't pass `--base` unless reviewing against a non-default-branch target. The default probes `origin/HEAD` → `origin/main` → `origin/master` → `@{upstream}` and picks the first that produces a non-empty merge-base — matching the GitHub PR diff for the common feature-branch-off-main flow.

## Annotation rules

1. **Architectural scope.** Tour is the senior-engineer walkthrough. Every annotation is real cost; if a beat doesn't earn its place, cut it.
2. **Order by reading flow, motivation first.** Open with one annotation answering _why does this PR exist?_ (the problem, not the diff) — anchored to a representative line or the first changed file. Then move through the changes in reading order, not file order.
3. **What to annotate**: new dependency shapes, why a refactor moved boundaries this way, the non-obvious trade-off, the part the diff doesn't explain, the bug's root cause.
4. **What to skip**: variable renames, micro-formatting, "five lines instead of seven", linter-catchable nits. If the diff is the explanation, don't annotate.
5. **Leverage every word.** Cut anything that doesn't carry the _why_. Inline any context the reader needs (linked issue, codebase convention, Slack thread) or drop the annotation.
6. **Match medium to message.** Diagrams for flow, snippets for code changes, tables for comparisons, prose for the *why* and the narrative. Markdown renders rich in the webapp.
7. **Findings batch**: external findings (security scan, lint, thorough-review) get one annotation per finding — drop the narrative arc.

## Continue (pickup)

When the user references human comments on an existing Tour:

```sh
tour pickup "$TOUR_ID" --json
```

Returns a `ConversationTree`. Actors:

| `author_kind` | `author` value                                    | Actor         |
| ------------- | ------------------------------------------------- | ------------- |
| `"human"`     | (any)                                             | Human         |
| `"agent"`     | `claude` / `codex` / `gemini` / `opencode` / `pi` | Reply-agent   |
| `"agent"`     | other                                             | You (earlier) |

Most human comments have no reply-agent child — they're directives for you. Comments with a reply-agent child already had one agent turn; you may need to follow up.

For each thread: code change | reply | close | defer. Reply with `replies_to`:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"ann_xxx","body":"..."}' | tour annotate "$TOUR_ID" --batch -
```

Replies inherit the parent's anchor; `file`/`side`/`line_start` are still required at write time.

## Lookup

```sh
tour list --json
tour show "$TOUR_ID" --json
tour serve "$TOUR_ID" --reply-agent claude &
```

Reuse for same HEAD; create a new Tour for a different HEAD.

## Install fallback

```sh
bunx tourdiff <command>      # bun
npx -y tourdiff <command>    # npm
```

## Reference

- [REFERENCE.md](REFERENCE.md) — JSONL schema, flag reference, reply-agent registry, edge cases
- [EXAMPLES.md](EXAMPLES.md) — worked examples
