---
name: release
description: Cut a new Tour release end-to-end — sync with origin, review what's shipping, suggest the semver bump from commit titles, run the release script, handle preflight failures (flaky tests, stale tests, ahead-of-remote), and watch CI. Use when the user says "release", "ship a new version", "cut a release", "bump the version", or asks how to publish.
---

# Release

Tag-driven release: `bun run release X.Y.Z --push` bumps `package.json`+`bun.lock`, commits, tags `vX.Y.Z`, pushes both. CI does the rest (npm publish, GitHub Release, Homebrew formula bump in `a9a4k/homebrew-tap`). Full pipeline ~3 min. See `docs/releasing.md` for the underlying reference.

## Workflow

Run each step. Stop and surface to the user on anything unexpected.

### 1. Sync with remote

```sh
git fetch origin
git status                              # must be on main, up-to-date or ahead
```

If local `main` is **behind** `origin/main`: `git pull --rebase` first. The release script doesn't guard against this — pushing a tag against a stale base will fail or ship the wrong commit.

### 2. Review what's shipping

```sh
LAST=$(git describe --tags --abbrev=0)
git log "$LAST"..HEAD --oneline
```

Read every commit title. Flag anything you don't recognise or that looks like in-progress work — ask the user before tagging.

### 3. Suggest the semver bump

Classify each commit since `$LAST` by conventional-commit prefix:

- `BREAKING CHANGE` / `!:` anywhere → **major** (X+1.0.0)
- `feat:` present → **minor** (X.Y+1.0)
- `fix:` / `perf:` / `refactor:` only → **patch** (X.Y.Z+1)
- `docs:` / `test:` / `chore:` only → **patch** (still a release, but smallest bump)

State the proposed version with the reasoning, then ask the user to confirm or override.

### 4. Check working-tree dirt

```sh
git status --porcelain
```

The release script tolerates dirt outside `package.json`/`bun.lock` (it only stages those two), but unexpected modifications to source/docs/tests deserve a quick `git diff` and a question before shipping — they may belong in a pre-release commit.

### 5. Run the release

```sh
bun run release X.Y.Z --push
```

This runs typecheck + full test suite as preflight. On failure, see Failure modes below.

### 6. Confirm pipeline fired

```sh
gh run watch                            # or: gh run list --limit 3
```

Surface CI failures to the user. After CI succeeds, verify the user can install:

```sh
brew update && brew upgrade tour && tour --version
# or
npx -y tourdiff@latest --version
```

## Failure modes

**Flaky test in preflight.** Re-run the failing test file in isolation: `npx vitest run path/to/failing.test.ts`. If it passes 5× in isolation but failed under full-suite load, it's a parallel-load flake — note it, retry the release once. If the second preflight passes, ship. If it fails again or a different test fails, stop and treat as a real bug.

**Stale test fails preflight.** Test pins an old import / identity / snapshot. Fix the test, commit, retry. (Example: `tests/web/file-icon.test.ts` pinned old icon names after `src/web/client/icons.ts` swapped families.)

**`refuse to release: ... not greater than current`.** Version monotonic check tripped. Bump to a strictly greater version.

**`refuse to release: package.json has uncommitted changes`.** Commit, stash, or revert. The script will not bump on top of dirt in the two release files.

**Push rejected (non-fast-forward).** Remote has commits you don't. `git pull --rebase`, re-run preflight (`bun run test`), then push:

```sh
git push origin main
git push origin vX.Y.Z
```

Do **not** force-push tags. If the tag is on the wrong commit, follow the "Recovering from a broken tag" steps in `docs/releasing.md`.

**npm publish 403 in CI.** Usually a stale `NPM_TOKEN` or trying to re-publish an existing version. Check the GitHub Actions log; surface to the user with the specific error.

## Notes

- The script's `--skip-checks` flag exists; never use it without explicit user instruction.
- Untracked sibling dirs (`pierre/`, `lazygit/`, etc.) are expected — the script only stages release files.
- Homebrew formula update is automated via the `bump-formula` workflow; no manual edit of `Formula/tour.rb` needed.
