# tour

Local code walkthroughs for the code your AI agent wrote.

When your agent finishes, its last step is to leave a tour — a walkthrough of its own diff. You step through the annotations in a TUI or your browser. No GitHub round-trip.

## Install

Homebrew (macOS, Linux):

```sh
brew install a9a4k/tap/tour
```

npm:

```sh
npm i -g tourdiff
```

Or any other Node package manager: `pnpm add -g tourdiff` · `bun add -g tourdiff` · `yarn global add tourdiff`.

Verify:

```sh
tour --version
```

## Quickstart

```sh
cd your-repo
tour create --head HEAD              # tour the latest commit
tour                                  # open the tour (webapp on a desktop, TUI otherwise)
tour serve --open                     # force webapp + auto-open the browser
```

Tours live in `.tour/<id>/` (auto-gitignored on first create). Each holds a `tour.toml` and an append-only `annotations.jsonl`.

## For agents

Install the Tour skill so AI agents (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, …) automatically reach for Tour when the user asks to *"review this branch"*, *"walk me through this diff"*, *"leave feedback on these changes"*, or similar:

```sh
npx skills add a9a4k/tour -g
```

The skill teaches the canonical author flow (`tour create` → `tour annotate --batch -` → `tour serve --reply-agent <name> &`) and the narrative-walkthrough style: zero-context reader, *why* not *what*, concise (typically 2–4 sentences per annotation).

For direct CLI use without the skill — e.g., in foreign repos with no global install:

```sh
bunx tourdiff create --head HEAD --json
bunx tourdiff annotate <id> --file src/foo.ts --side additions --line 12 --body "..."
```

Or via npm:

```sh
npx -y tourdiff create --head HEAD --json
```

## Commands

```
tour create --head <ref> [--base <ref>] [--title <s>] [--json]
tour annotate <id> --file <f> --side additions|deletions --line <n[-m]> --body <b> [--author <a>] [--json]
tour annotate <id> --batch -                         # read JSONL annotations from stdin
tour list [--status open|closed|all] [--json]
tour show <id> [--json]
tour close <id>                                       # mark closed; keeps files
tour delete <id>                                      # remove the tour
tour prune --older-than 30d                           # bulk-delete by age
tour tui [<id>]                                       # explicit TUI launch
tour serve [--port 8687] [--open] [<id>]              # webapp (8687 = TOUR on T9, auto-falls-back on collision)
```

`--head WIP` snapshots uncommitted work to a synthetic commit so the diff stays pinned.

## License

MIT — see [LICENSE](./LICENSE).
