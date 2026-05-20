# ADR 0039: Tour storage lives in Tour home, not repos

## Status

Accepted.

## Context

Tour used to create `<repo>/.tour/` and add `.tour/` to `.gitignore` on first
create. That kept the user's working tree dirty after a read-mostly operation,
and it left Tour metadata inside the blast radius of repo-scoped agent
auto-commit flows.

Linked worktrees also had separate `.tour/` folders even though Tours are pinned
to SHAs reachable from the clone's shared object database.

## Decision

Store Tours at `<tour-home>/<repo-key>/<id>/`.

- `tour-home` is `$TOUR_HOME`, defaulting to `~/.tour`.
- `repo-key` is `<slug>-<short-hash>`, where the hash is the first 12 chars of
  `sha1(realpath(git rev-parse --git-common-dir))`; outside git the hash input
  is `realpath(cwd)`.
- `created_in_worktree` records `realpath(git rev-parse --git-dir)` for new
  Tours, falling back to `realpath(cwd)` outside git.
- `tour create` does not create `<repo>/.tour/` and does not edit `.gitignore`.
- A legacy `<repo>/.tour/` directory is reported with a one-line stderr nudge;
  migration remains an explicit follow-up.

The on-disk format inside each Tour directory is unchanged: `tour.toml`,
`tour-events.jsonl`, `logs/`, and `.reply-lock.json`.

## Consequences

The user's repo stays clean after creating a Tour. Linked worktrees share one
storage namespace by Repo key, while the Worktree stamp preserves enough data
for later per-worktree filtering.
