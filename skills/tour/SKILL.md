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

A Tour is a guided traversal of a pinned git diff. The agent authors line-anchored annotations via CLI; the human reads them in a TUI or webapp, comments freely, and may explicitly request a reply-agent response on any individual comment by pressing `s` / clicking "Send to {agent}"; the main-agent (you) closes the loop via `tour pickup`.

## Pick your phase

| Phase | When | Verbs |
|---|---|---|
| **Author** | User asks for review / feedback / a tour on a branch or diff | `tour create`, `tour annotate`, `tour serve --open` |
| **Continue** | Human commented (or replied) on an existing Tour; user wants you to act on it | `tour pickup`, `tour annotate` with `replies_to` |
| **Lookup** | User references an existing Tour | `tour list`, `tour show` |

## Default style: narrative walkthrough

**Scope and sizing.** Tour is for **architectural and high-level review** — the kind of thing a senior engineer flags in a 15-minute conversation walking through a PR. **Target ~10 minutes for the human to step through the whole tour.** That's roughly 5–15 annotations depending on density; bigger diffs do not mean more annotations, they mean picking the architectural beats and trusting the reader to read the rest.

**First beat is always motivation.** Before any code beat, open with one annotation answering *why does this PR exist?* — the problem or need it addresses, not what the diff shows. Anchor it to the most-representative line of the change, or the first changed file. A reviewer should understand the *why* before reading any code.

**What to annotate**: the shape of new dependencies, why a refactor moved boundaries this way, the non-obvious trade-off, the part the diff alone doesn't explain, the bug's root cause and why the fix lives where it does.

**What to skip**: variable renames, micro-formatting, "this method is now five lines instead of seven", anything a linter or a careful code-read catches on its own. If the diff itself is the explanation, don't annotate.

If you find yourself writing the 20th annotation, stop and ask whether the last ten earn their place — usually three or four collapse into one architectural beat and the rest can disappear.

The reader has zero context about the problem, the codebase, or prior discussion. Annotations should:

- Explain **why**, not just **what** — the diff already shows what changed.
- Be ordered by reading flow, not file alphabetical order.
- Each annotation is a beat in the walkthrough.
- **Plain language, concise.** Default to 2–4 sentences per annotation. If you can delete a sentence without losing the *why*, delete it. If an annotation runs past ~6 sentences, ask whether it's actually two beats.
- **Lean visual when it helps.** Before/after snippets, small tables, and Mermaid for control/data flow render in the webapp and pay off the audience constraint. Prose-only is the fallback, not the default.
- Shape varies by PR: a small refactor needs 2–3 beats; a bug fix often leads with root cause; a feature PR may need a context-setting opener. Use judgment; don't force a rigid skeleton onto small changes.

**Calibration** — same WHY, two lengths:

> ❌ *"This PR refactors the validation logic. The validation was previously inline in `process.ts`. We've extracted it into a separate module so we can unit-test it without dragging in the file-I/O of the parent..."*
>
> ✅ *"Extracted validation from `process.ts` into its own module. Now testable without `process.ts`'s file-I/O setup."*

Aim for the second. ~40% the length, same content.

**Non-negotiable**: if an annotation requires the reader to have read the linked issue, know a codebase convention, or remember a Slack thread, inline that context or drop the annotation.

**Findings variation**: when converting external findings (security scan, lint output, thorough-review results) into Tour annotations, drop the narrative arc — one annotation per finding. Mechanically identical to author phase, stylistically a peer.

## Author — quick start

```sh
TOUR_ID=$(tour create --head HEAD)

cat <<'JSONL' | tour annotate "$TOUR_ID" --batch -
{"file":"src/foo.ts","side":"additions","line_start":12,"line_end":14,"body":"..."}
{"file":"src/foo.ts","side":"additions","line_start":40,"body":"..."}
JSONL

tour serve "$TOUR_ID" --reply-agent claude &
```

**Diff scope (background)**: with no `--base`, Tour resolves to the merge-base of HEAD with its upstream — matching what GitHub uses for PR diffs. Falls back to `HEAD^` on single-commit branches, detached HEAD, or no upstream. Don't override with `--base origin/main`: `git diff origin/main..HEAD` includes the *inverse* of every commit that landed on main since the branch diverged, burying your actual changes under inverted deletions. The default already does the right thing.

Always end with `tour serve <id> --reply-agent <name> &` — the server starts in the background and prints a deep URL (`http://127.0.0.1:<port>/<id>`); modern terminals render it Cmd/Ctrl-clickable. Don't pass `--open`: the agent's job ends with the handoff, not by hijacking the user's browser. If a Tour server is already running for this repo's cwd, the second invocation reuses it and prints *"Tour already running at ..."* with the same deep URL — no port conflict, no duplicate server. The `--reply-agent` enables the per-card "Send to {agent}" affordance so the human can dispatch a reply-agent response on any individual comment they choose; without it, the Send affordance is hidden and the human's comments flow to you at `tour pickup` time instead. See [REFERENCE.md](REFERENCE.md#reply-agent-selection) for picking `<name>`.

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

A human comment may or may not have a reply-agent child Annotation — the human chooses per-comment whether to press `s` / click "Send to {agent}". Comments without a reply-agent child are the dominant case; they are directives or notes intended for you at pickup time. Comments with a reply-agent child have already had one agent turn and may need your follow-up (code change, further reply, etc.) on top of that exchange.

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
