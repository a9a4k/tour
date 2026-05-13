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
  PRs (use `gh pr create`), filing issues, or repo-wide notes with no line
  anchor. For annotation style and authoring guidance, see the body of
  this skill.
allowed-tools:
  Bash(tour:*),
  Bash(bunx tourdiff:*),
  Bash(npx tourdiff:*),
  Bash(npx -y tourdiff:*),
  Bash(pnpm dlx tourdiff:*),
  Bash(yarn dlx tourdiff:*)
---

# Tour

A Tour is a guided traversal of a pinned git diff. The agent authors line-anchored annotations via CLI; the human steps through them in a TUI or webapp and comments; the agent picks up the conversation via `tour pickup`.

## Pick your phase

| Phase | When | Verbs |
|---|---|---|
| **Author** | User asks for review / feedback / a tour on a branch or diff | `tour create`, `tour annotate`, `tour serve --open` |
| **Continue** | Human commented (or replied) on an existing Tour; user wants you to act on it | `tour pickup`, `tour annotate` with `replies_to` |
| **Lookup** | User references an existing Tour | `tour list`, `tour show` |

## Default style: narrative walkthrough

**Scope and sizing.** Tour is for **architectural and high-level review** — the kind of thing a senior engineer flags in a 15-minute conversation walking through a PR. **Target ~10 minutes for the human to step through.** Roughly 5–15 annotations; bigger diffs do not mean more annotations, they mean picking the architectural beats and trusting the reader to read the rest. If you're writing the 20th, stop — usually three or four collapse into one beat and the rest can disappear.

**First beat is always motivation.** Before any code beat, open with one annotation answering *why does this PR exist?* — the problem or need it addresses, not what the diff shows. Anchor it to a representative line or the first changed file.

**What to annotate**: the shape of new dependencies, why a refactor moved boundaries this way, the non-obvious trade-off, the part the diff alone doesn't explain, the bug's root cause and why the fix lives where it does.

**What to skip**: variable renames, micro-formatting, "this method is now five lines instead of seven", anything a linter or a careful code-read catches on its own. If the diff itself is the explanation, don't annotate.

**Per annotation**: 2–4 sentences in plain language; cut anything that doesn't carry the *why*. Order by reading flow, not file order. Visual when it helps — before/after snippets, small tables, Mermaid for control/data flow render in the webapp. If an annotation needs context from a linked issue, codebase convention, or Slack thread, inline that context or drop the annotation.

**Findings variation**: when converting external findings (security scan, lint output, thorough-review results) into Tour annotations, drop the narrative arc — one annotation per finding.

## Author — quick start

```sh
TOUR_ID=$(tour create --head HEAD)

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/foo.ts","side":"additions","line_start":12,"line_end":14,"body":"..."}
{"file":"src/foo.ts","side":"additions","line_start":40,"body":"..."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

**Diff scope**: leave `--base` alone. The default merge-base-with-upstream matches GitHub's PR diff; passing `--base origin/main` inverts every commit landed on main since branch divergence and buries your changes. See [REFERENCE.md](REFERENCE.md) for fallback rules.

**End with `tour serve "$TOUR_ID" --reply-agent <name> &`**. The background server prints a Cmd/Ctrl-clickable URL; don't pass `--open` — the agent's job ends with the URL. Same-cwd re-runs reuse the running server.

Pass `--reply-agent <name>` only when you can self-identify as one of the shipped CLIs (Claude Code → `claude`, Codex → `codex`, etc.). If you can't, **drop the flag**: in v2.0.0+, Tour auto-detects shipped CLIs on the user's PATH and prints a one-line tip naming the right value. See [REFERENCE.md](REFERENCE.md#reply-agent-selection) for the registry and the skip-when-uncertain rule.

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

Most human comments have no reply-agent child — they're directives for you. Comments with a reply-agent child already had one agent turn; you may need to follow up (code change, further reply, etc.).

For each thread, decide: code change | reply | close | defer. Reply by writing an annotation with `replies_to` set:

```sh
echo '{"file":"src/foo.ts","side":"additions","line_start":40,"replies_to":"ann_xxx","body":"..."}' \
  | tour annotate "$TOUR_ID" --batch -
```

Reply annotations inherit their parent's anchor, but the schema still requires `file`/`side`/`line_start` for write-time validation. See [EXAMPLES.md](EXAMPLES.md) for full pickup → action flows.

## Lookup — quick start

```sh
tour list --json                  # find existing tours in this repo
tour show "$TOUR_ID" --json       # agent-facing read of pinned diff + annotations (no TUI)
tour serve "$TOUR_ID" --reply-agent claude &   # reopen the webapp; server prints the deep URL the user clicks
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
