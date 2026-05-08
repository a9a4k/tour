# Review

A code-review tool that pairs an ephemeral, GitHub-style split-view diff with persisted AI annotations. Drives the same data from a TUI and a webapp, both consuming local files written by agents through a CLI.

## Language

**Review**:
A single review-pass over a pinned git diff, with zero or more annotations attached. Lives in `.review/<id>/`.
_Avoid_: PR, pull request, code review session, changeset

**Diff**:
The set of file changes shown in a Review, recomputed from git on every open. Never persisted.
_Avoid_: patch, changes, delta

**Head**:
The git ref the Review's diff ends at. Resolved to a SHA at create time. May be a real commit or a synthetic snapshot of the working tree.
_Avoid_: tip, target

**Base**:
The git ref the Review's diff starts from. Resolved to a SHA at create time. Defaults to `head^` for single-commit reviews.
_Avoid_: parent, ancestor

**Annotation**:
A note anchored to `(file, side, line_start, line_end)` inside a Review's diff. `side` is `additions` or `deletions` (matching Pierre's vocabulary); line numbers are file-line-numbers in the file as it exists on that side at the pinned SHA. Authored only by agents in v1 (via CLI). Persisted in the Review's folder. The body is free-form text — no `kind` enum.
_Avoid_: comment, review comment, note

**Side**:
The diff-half an Annotation belongs to: `deletions` for the base-file half, `additions` for the head-file half. Required, not derived. View-mode independent: in split view, `deletions` renders on the left column and `additions` on the right; in unified view, `deletions` attaches to the `-` row and `additions` to the `+` row. Annotations on unchanged context lines pick `additions` by convention. Naming matches Pierre's `AnnotationSide` so `core/` ↔ Pierre is a no-op.
_Avoid_: LEFT/RIGHT, before/after, old/new, column

**Working-tree snapshot**:
A synthetic commit object capturing uncommitted changes at the moment a Review is created, so the Diff stays pinned even as the working tree keeps moving.
_Avoid_: stash, WIP commit

## Relationships

- A **Review** has exactly one **Head** and one **Base**, both stored as SHAs.
- A **Review** has zero or more **Annotations**.
- An **Annotation** belongs to exactly one **Review** and anchors to one file + line-range inside that Review's **Diff**.
- A **Working-tree snapshot** acts as a synthetic **Head** when an agent creates a Review of uncommitted work.

## Example dialogue

> **Dev:** "If the agent amends the commit after creating a **Review**, do the **Annotations** still line up?"
> **User:** "The **Review** is pinned to the original SHA. Amending creates a new SHA — the old one is still in git's object store, so the **Diff** and **Annotations** still resolve. If the agent wants to review the amended version, they create a new **Review**."

## Flagged ambiguities

- _none yet_

## Resolved decisions

- **Annotation lifetime**: per-review-pass. Annotations are not re-anchored across rebases or amendments. Stale Reviews are abandoned, not migrated.
- **Diff source**: commit-pinned only. Working-tree reviews are supported by snapshotting to a synthetic commit at create time, so the rest of the system only ever sees SHAs.
- **Multiplicity**: many Reviews coexist, ordered by creation time. Default open behavior surfaces the most recent unfinished one.
- **Tool surface**: CLI-first. Agents drive the system by shelling out (`review create`, `review annotate`, …) with `--json` output. MCP is deferred and would be a thin wrapper if added later.
- **Annotation anchor**: `(file, side, line_start, line_end)` with `side ∈ {additions, deletions}` (matching Pierre's `AnnotationSide`) and line numbers being file-line-numbers at the pinned SHA. View-mode independent; both split and unified consume the same shape. No `kind` enum in v1 — the body is plain text.
- **Authoring (v1)**: agents only. The UI is read-only — humans view annotations and read the diff. No human-authored annotations, no resolution state, no threads. Adding human authoring is additive and deferred.
- **Sidebar (v1)**: flat list of changed files, alphabetical, with file-status icon and annotation count badge. Real folder-tree rendering is deferred until file counts justify it. Main pane is a single top-to-bottom stream of all file diffs; clicking a sidebar entry scrolls to that file.
- **Watch behavior**: TUI and webapp watch the open Review's `.review/<id>/` folder for changes (annotations appearing/disappearing) and re-render. They do not watch git refs or working-tree files — the diff is pinned to `head_sha`.
- **Handoff**: agent prints the review ID to stdout (and a one-line "Open with: …" hint). No auto-open. Humans open the UI explicitly via `review` (TUI) or `review serve` (webapp). `review create --open` opt-in for users who do want auto-launch.
- **Review ID**: `YYYY-MM-DD-HHMMSS-xxxx` (UTC timestamp + 4-char random suffix). Sortable by creation time; collision-safe under parallel creates; prefix-matchable (`review show 2026-05-08-1`).
- **CLI surface**: `review create --head <ref> [--base <ref>] [--title <s>]` resolves both ends to SHAs at create time. `--head WORKTREE` snapshots uncommitted changes. `--base` default is context-sensitive: `<head>^` for commit reviews, `HEAD` for `WORKTREE` reviews. Verbs: `create`, `annotate`, `list`, `show`, `close`, `delete`, `prune`, `tui`, `serve`. Bare `review` opens TUI on the most recent open Review.
- **On-disk schema**: `review.toml` holds `id`, `title?`, `status`, `created_at`, `closed_at?`, `head_sha`, `base_sha`, `head_source`, `base_source`, `worktree_snapshot`. `annotations.jsonl` is one annotation per line: `{id, file, side, line_start, line_end, body, author, created_at}`. `author` is a free-form string (e.g. `"agent"`, `"claude-code"`).
- **Webapp lifecycle**: `review serve` is long-running, single-user, binds to `127.0.0.1:7777` (configurable), no auth. `Ctrl-C` to stop. Browser auto-open only with `--open`.
- **Snapshot loss**: if a Review's `head_sha` no longer resolves (e.g. user manually ran `git update-ref -d refs/review/<id>`), the UI shows a banner "Snapshot lost — annotations preserved but diff cannot be displayed." Read-only, can be deleted.
- **Packaging**: single binary, multi-subcommand (same shape as Backlog.md). One `review` package containing a shared `core/` (git, review IO, annotations, watcher) and two renderers (`tui/`, `web/`). Stack: Bun + TypeScript + OpenTUI for TUI; Bun HTTP server + React for web.
- **Diff engine (v1)**: all-in on Pierre + Hunk. `@pierre/diffs` parses git diffs and renders the web view (uses its built-in annotation framework). `hunkdiff/opentui` (`HunkDiffView`) renders the TUI on top of Pierre's parsed model. Accepted coupling: both are young packages from small teams; if either churns or stalls, we eat migration cost on that surface only — `core/` stays insulated.
- **Lifecycle**: two states, `open` and `closed`. Human transitions via `review close` or UI button. Closed reviews stay in `.review/<id>/` with `status = "closed"`. Cleanup is explicit (`review prune --older-than 30d`).
- **Folder layout**: `.review/<id>/` flat at top level; each contains `review.toml` (front-matter) and `annotations.jsonl` (append-only annotation log). `.review/` is gitignored by default (auto-added on first `review create`); teams can opt-in to commit by removing the line.
- **Working-tree snapshot mechanics**: `git stash create` produces a synthetic commit SHA without touching the working tree; `git update-ref refs/review/<id> <sha>` keeps it alive past gc. Stored as `head_sha` in `review.toml`. Released on `review delete` / `review prune` via `git update-ref -d refs/review/<id>`.
