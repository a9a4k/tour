# tour

Local code review tool with AI annotations: a TUI and a webapp over a pinned git diff. Agents author annotations through a CLI; humans read them.

## Install

```sh
npm i -g tourdiff
# or
bun add -g tourdiff
```

Verify:

```sh
tour --version
```

## Quickstart

```sh
cd your-repo
tour create --head HEAD              # tour the latest commit
tour                                  # open the TUI
tour serve --open                     # or open the webapp at http://127.0.0.1:7777
```

Tours live in `.tour/<id>/` (auto-gitignored on first create). Each holds a `tour.toml` and an append-only `annotations.jsonl`.

## For agents

No global install needed in foreign repos:

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
tour serve [--port 7777] [--open] [<id>]              # webapp
```

`--head WIP` snapshots uncommitted work to a synthetic commit so the diff stays pinned.

## License

MIT — see [LICENSE](./LICENSE).
