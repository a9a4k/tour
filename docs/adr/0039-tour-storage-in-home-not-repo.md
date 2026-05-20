# Tour storage lives in `~/.tour/`, not `<repo>/.tour/`

> **Status:** Accepted — 2026-05-20.

Per-Tour on-disk storage moves out of the user's repo. The new location is `<tour-home>/<repo-key>/<id>/`, where `tour-home` defaults to `~/.tour/` (override: `$TOUR_HOME`) and `repo-key` is `<basename>-<short-hash>` derived from `realpath(git rev-parse --git-common-dir)`. `ensureTourIgnored` is retired with this move. Every Tour now carries a `created_in_worktree` stamp so per-worktree filtering survives the storage collapse.

## Why

Two pains drove the move; both are repo-pollution in different costumes.

1. **Eager gitignore write modifies the repo on first use.** `tour create` wrote `.tour/` into `.gitignore` so coding agents (Claude Code, Cursor) with auto-commit wouldn't sweep tour internals into the user's commits. This put a tracked-file change in front of every Tour beginner — cosmetic friction, but real.
2. **The gitignore is a race, not a guarantee.** If `tour create` runs after the agent has already staged changes, the gitignore write is too late: `.tour/` files land in the commit. The fix-in-place is structurally weak — a coding agent's natural rhythm is "edit, stage, commit," and any tour data dropped in the middle of that rhythm is at risk.

The decisive observation: **the storage location is the wrong knob.** As long as `.tour/` sits inside the repo, every repo-scoped tool (git, agents, `find`, `rg`) sees it. Moving the storage out of the repo makes it *structurally* invisible — no gitignore needed, no race possible.

A secondary win falls out for free: worktrees of one clone today get independent `.tour/` folders even though tours anchor on SHAs reachable from every worktree. Collapsing worktrees onto a single repo-key restores the obvious semantics (one repo → one tour store).

## Considered Options

- **Keep `<repo>/.tour/`, delete `ensureTourIgnored`.** Solves first-run friction but leaves the auto-commit race open. Rejected because B is the dominant pain.
- **Key the new location by `git config remote.origin.url`.** Breaks for local-only repos and forks; two clones of the same fork collide. Rejected.
- **Key by `realpath(repo-root)`.** Doesn't survive `mv`; splits worktrees back apart. Rejected.
- **Key by `realpath(git rev-parse --git-common-dir)` (selected).** For a regular checkout and every linked worktree of one clone, this resolves to the same path (the main `.git/`). Survives `mv` of the working tree. No remote-URL dependency. Distinct clones at different paths get distinct keys.
- **XDG_DATA_HOME (`~/.local/share/tour/`).** More correct on Linux. Rejected for default; `$TOUR_HOME` covers it.
- **F1 filter: list tours by SHA reachability from current HEAD.** "Tours about the code I'm looking at right now." Discarded in favour of F2 — F1 still needs a stamp for WIP tours (whose synthetic SHA is reachable from nothing), so the "no schema change" argument for F1 collapses; F2 is one rule, F1 is two.
- **F2 filter: list tours by worktree stamp (selected).** Every Tour carries `created_in_worktree = realpath(git rev-parse --git-dir)`. `tour list` filters to the current worktree's stamp by default; `--all` bypasses.
- **Stamp the worktree *path* instead of *gitdir*.** Rejected — breaks on `git worktree move`. The gitdir reference is stable across moves and dies on `git worktree remove`, which gives the right default-filter behaviour for free.

## Decisions

### Location

- `tour-home` = `$TOUR_HOME` if set, else `~/.tour/`.
- `repo-key` = `<basename>-<short-hash>` where `basename` is the last segment of the repo's working tree path and `short-hash` is the first 12 chars of `sha1(realpath(git rev-parse --git-common-dir))`. Outside a git repo, the hash is over `realpath(cwd)`.
- On-disk shape: `<tour-home>/<repo-key>/<tour-id>/{tour.toml, tour-events.jsonl, logs/, .reply-lock.json}`.

### Worktree stamp

- New required field on `Tour`: `created_in_worktree: string` = `realpath(git rev-parse --git-dir)` at create time. For the main worktree this is `/path/to/repo/.git`; for a linked worktree, `/path/to/repo/.git/worktrees/<name>`.
- Outside a git repo, the stamp is `realpath(cwd)`.

### Filtering

- `tour list` filters to `created_in_worktree === <current worktree stamp>` by default.
- `tour list --all` bypasses the filter and shows every Tour in the `repo-key`.
- Bare `tour` and `tour tui`'s smart-default consume the same filter when picking the "most recent" Tour.
- Explicit `tour tui <id>` / `tour show <id>` / `tour delete <id>` ignore the filter — an explicit id always wins.

### `ensureTourIgnored` retired

Deleted. The repo is never touched on `tour create`. Tours sit in `~/.tour/` from the first invocation.

### Migration

A new `tour migrate` subcommand moves a legacy `<repo>/.tour/` into `<tour-home>/<repo-key>/`. It:

1. Resolves the current `tour-home` and `repo-key`.
2. For each tour folder under `<repo>/.tour/`, moves it to `<tour-home>/<repo-key>/<id>/`.
3. Stamps `created_in_worktree` on each migrated Tour's TOML using the worktree the migrate command ran from — the only worktree the legacy tour *could* have lived in, given the old per-worktree resolver behaviour.
4. Removes `.tour/` from the repo's `.gitignore` iff that's the only entry on that line.
5. Removes the now-empty `<repo>/.tour/` directory.

The resolver detects a legacy `<repo>/.tour/` and emits a one-line stderr nudge on every command until migration runs or the directory is removed. No silent moves.

## Consequences

- (+) Repos are never touched by Tour. Agents with auto-commit cannot capture tour internals.
- (+) `git status` stays clean in every repo Tour has been used in.
- (+) Worktrees of one clone share a tour store. The shared store matches the SHA-anchored data model; the `created_in_worktree` stamp keeps the per-worktree query semantic.
- (+) The default filter ("this worktree") is stable when the user switches branches in a worktree mid-pass; F1 would have hidden tours whose SHA fell off the current branch.
- (−) Tours are invisible to `ls` in the repo. Discoverability moves to `tour list` and the first-run banner; the banner names the on-disk path so a curious user can find their data.
- (−) Moving a clone to a new path orphans its tours (different `git-common-dir`). Acceptable: tours are per-pass ephemera (Resolved Decision: "Comment lifetime").
- (−) Two clones of the same repo at different paths cannot see each other's tours. Out of scope; consistent with the per-pass model.
- (−) `tour migrate` exists as a one-shot for users on pre-0.x stores. It carries the only schema-write to a legacy `.gitignore`; that write is gated on "the line is the only entry" so we never mangle a hand-curated file.
