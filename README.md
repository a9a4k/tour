# tour

[![npm](https://img.shields.io/npm/v/tourdiff.svg)](https://www.npmjs.com/package/tourdiff) [![license](https://img.shields.io/github/license/a9a4k/tour.svg)](./LICENSE)

Local code review at AI speed.

Tour lets your AI leave a walkthrough on its diff as PR-style comments. Reply to the agent's comments, add your own, and jump to your editor in one keystroke.

<!-- demo: ./.github/assets/demo.gif (6s inline loop) + ./.github/assets/demo.mp4 (45s linked) — added in Step 4 of the marketing campaign -->

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

Tours live in `$TOUR_HOME/<repo-key>/<id>/` (default `~/.tour/`, out of your repo per ADR 0039 — coding agents with auto-commit can't sweep Tour internals into your commits). Each holds a `tour.toml` and an append-only `tour-events.jsonl` (event log per ADR 0036).

## For agents

Teach your AI agent to leave a Tour every time you ask for a review:

```sh
npx skills add a9a4k/tour -g
```

Works across Claude Code, Codex, Cursor, Gemini CLI, OpenCode, and other agents in the [skills.sh](https://skills.sh) ecosystem. Once installed, asking your agent to "review my branch" or "walk me through this diff" produces a Tour rather than a wall of chat: comments anchored to specific lines, written so a teammate with no context can follow along, opened in your browser at a clickable URL.

For direct CLI use without the skill — e.g., in foreign repos with no global install:

```sh
bunx tourdiff create --head HEAD --json
bunx tourdiff comment <id> --file src/foo.ts --side additions --line 12 --body "..."
```

Or via npm:

```sh
npx -y tourdiff create --head HEAD --json
```

## Commands

```
tour create --head <ref> [--base <ref>] [--title <s>] [--json]
tour comment <id> --file <f> --side additions|deletions --line <n[-m]> --body <b> [--author <a>] [--json]
tour comment <id> --batch -                          # read JSONL comments from stdin   (alias: annotate)
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
