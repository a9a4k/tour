# Releasing

Releases are tag-driven. Pushing a `vX.Y.Z` tag fires `.github/workflows/release.yml`, which builds binaries, publishes to npm, creates a GitHub Release, and updates the Homebrew formula in [`a9a4k/homebrew-tap`](https://github.com/a9a4k/homebrew-tap). Total CI time: ~3 minutes.

## The one command

```sh
bun run release 0.1.5 --push
```

Wraps `scripts/release.ts`. Runs guardrails, bumps `package.json` + `bun.lock`, commits, tags, pushes both the commit and the tag.

Without `--push`, the script stops after `git tag` and prints the next-step commands.

## What runs in CI on tag push

1. **build** matrix — 5 platforms (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-x64`).
2. **publish** — npm (`tourdiff` + 5 platform sub-packages, with provenance) and a GitHub Release with auto-generated notes.
3. **bump-formula** — computes SHA256 of each unix binary, rewrites `Formula/tour.rb` in `a9a4k/homebrew-tap`, pushes a `tour: bump to X.Y.Z` commit.

If any job fails, downstream jobs don't run. The most common failure is a forgotten version bump (npm rejects re-publishing the same version) — the helper's monotonic check guards against this.

## Pre-flight checks (in `scripts/release.ts`)

The helper refuses to bump if any of these are true:

- `package.json` or `bun.lock` have uncommitted changes
- Current branch isn't `main`
- Tag already exists
- New version is not greater than current (e.g., `release 0.1.3` after 0.1.4 has shipped)
- `bun run typecheck` fails
- `bun run test` fails

Other dirty state (untracked sibling dirs, modifications outside `package.json`/`bun.lock`) is allowed and prints a notice — the release commit only stages the two release files.

Pass `--skip-checks` to bypass typecheck + test. Use sparingly.

## Verifying after CI

```sh
brew update && brew install a9a4k/tap/tour
tour --version    # must match the new tag
```

Or via npm:

```sh
npx -y tourdiff@latest --version
```

## Recovering from a broken tag

If a tag was pushed against the wrong commit (e.g., `package.json` not bumped), the publish job fails on npm 403 and no GitHub Release is created. To recover:

1. Bump `package.json` + `bun.lock` properly (or rerun `bun run release X.Y.Z` without `--push`).
2. `git push --delete origin vX.Y.Z`
3. `git tag -d vX.Y.Z`
4. `git tag vX.Y.Z` at the new commit.
5. `git push origin main` and `git push origin vX.Y.Z`.

CI re-fires automatically on the new tag push.

## Maintenance

- **`HOMEBREW_TAP_TOKEN`** repo secret — fine-grained PAT scoped to `a9a4k/homebrew-tap` with `Contents: write`. Required by the `bump-formula` job. If brew installs stop reflecting new releases, check this token's expiry first.
- **`NPM_TOKEN`** repo secret — npm automation token. Required by the `publish` job.
- The Homebrew tap is a separate repo. Cloning it locally and editing `Formula/tour.rb` directly is supported but never necessary — the bump-formula job is the single writer.
