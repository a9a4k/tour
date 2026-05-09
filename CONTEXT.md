# Tour

A code-review tool that pairs an ephemeral, GitHub-style diff (split or unified) with persisted AI annotations. Drives the same data from a TUI and a webapp, both consuming local files written by agents through a CLI.

## Language

**Tour**:
A single guided traversal of a pinned git diff, with zero or more annotations attached. Lives in `.tour/<id>/`.
_Avoid_: review, PR, pull request, code review session, changeset

**Diff**:
The set of file changes shown in a Tour, recomputed from git on every open. Never persisted.
_Avoid_: patch, changes, delta

**Head**:
The git ref the Tour's diff ends at. Resolved to a SHA at create time. May be a real commit or a synthetic snapshot of the working tree.
_Avoid_: tip, target

**Base**:
The git ref the Tour's diff starts from. Resolved to a SHA at create time. Defaults to `head^` for single-commit tours.
_Avoid_: parent, ancestor

**Annotation**:
A note anchored to `(file, side, line_start, line_end)` inside a Tour's diff. `side` is `additions` or `deletions` (matching Pierre's vocabulary); line numbers are file-line-numbers in the file as it exists on that side at the pinned SHA. Authored only by agents in v1 (via CLI). Persisted in the Tour's folder. The body is free-form text — no `kind` enum.
_Avoid_: comment, review comment, note

**Side**:
The diff-half an Annotation belongs to: `deletions` for the base-file half, `additions` for the head-file half. Required, not derived. View-mode independent: in split view, `deletions` renders on the left column and `additions` on the right; in unified view, `deletions` attaches to the `-` row and `additions` to the `+` row. Annotations on unchanged context lines pick `additions` by convention. Naming matches Pierre's `AnnotationSide` so `core/` ↔ Pierre is a no-op.
_Avoid_: LEFT/RIGHT, before/after, old/new, column

**Working-tree snapshot**:
A synthetic commit object capturing uncommitted changes at the moment a Tour is created, so the Diff stays pinned even as the working tree keeps moving.
_Avoid_: stash, WIP commit

## Relationships

- A **Tour** has exactly one **Head** and one **Base**, both stored as SHAs.
- A **Tour** has zero or more **Annotations**.
- An **Annotation** belongs to exactly one **Tour** and anchors to one file + line-range inside that Tour's **Diff**.
- A **Working-tree snapshot** acts as a synthetic **Head** when an agent creates a Tour of uncommitted work.

## Example dialogue

> **Dev:** "If the agent amends the commit after creating a **Tour**, do the **Annotations** still line up?"
> **User:** "The **Tour** is pinned to the original SHA. Amending creates a new SHA — the old one is still in git's object store, so the **Diff** and **Annotations** still resolve. If the agent wants to tour the amended version, they create a new **Tour**."

## Flagged ambiguities

- _none yet_

## Resolved decisions

- **Annotation lifetime**: per-tour-pass. Annotations are not re-anchored across rebases or amendments. Stale Tours are abandoned, not migrated.
- **Diff source**: commit-pinned only. Working-tree tours are supported by snapshotting to a synthetic commit at create time, so the rest of the system only ever sees SHAs.
- **Multiplicity**: many Tours coexist, ordered by creation time. Default open behavior surfaces the most recent unfinished one.
- **Tool surface**: CLI-first. Agents drive the system by shelling out (`tour create`, `tour annotate`, …) with `--json` output. MCP is deferred and would be a thin wrapper if added later.
- **Annotation anchor**: `(file, side, line_start, line_end)` with `side ∈ {additions, deletions}` (matching Pierre's `AnnotationSide`) and line numbers being file-line-numbers at the pinned SHA. View-mode independent; both split and unified consume the same shape. No `kind` enum in v1 — the body is plain text.
- **Authoring (v1)**: agents only. The UI is read-only — humans view annotations and read the diff. No human-authored annotations, no resolution state, no threads. Adding human authoring is additive and deferred.
- **Sidebar (tree)**: folder tree of changed files. Path compression folds any non-leaf node with exactly one folder child into its child (lazygit-style), so sparse tours don't waste rows on empty intermediate folders. Folders sort before files at each level; alphabetical within each group. File rows keep their existing file-status icon, classification reason tag, and per-file annotation count badge. Folder rows show a caret + compressed path + an annotation-count rollup over their descendants. Default state on first render: every folder expanded. Clicking a folder toggles its expand/collapse; clicking a file selects it and scrolls the diff stream to it. `n`/`p` annotation navigation reveals (expands) the ancestor folder chain of the target file. Expand/collapse state is React state, in-memory only, per renderer instance, per tour — page reload resets to "all expanded" (no localStorage, no on-disk state). The tree algorithm lives in the pure shared module `core/file-tree.ts`; both the webapp and TUI consume `VisibleRow[]` from `flatten`. Originally deferred from v1 ("Real folder-tree rendering is deferred until file counts justify it") to ship the smallest viable Tour; reinstated now that the v1 surface is shipped and real tours expose the flat list's limitations on deeply-nested paths. Main pane is unchanged: a single top-to-bottom stream of all file diffs; clicking a sidebar file entry scrolls to that file.
- **Watch behavior**: TUI and webapp watch the open Tour's `.tour/<id>/` folder for changes (annotations appearing/disappearing) and re-render. They do not watch git refs or working-tree files — the diff is pinned to `head_sha`.
- **Handoff**: agent prints the tour ID to stdout (and a one-line "Open with: …" hint). No auto-open. Humans open the UI explicitly via `tour` (TUI) or `tour serve` (webapp). `tour create --open` opt-in for users who do want auto-launch.
- **Tour ID**: `YYYY-MM-DD-HHMMSS-xxxx` (UTC timestamp + 4-char random suffix). Sortable by creation time; collision-safe under parallel creates; prefix-matchable (`tour show 2026-05-08-1`).
- **CLI surface**: `tour create --head <ref> [--base <ref>] [--title <s>]` resolves both ends to SHAs at create time. `--head WIP` snapshots uncommitted changes. `--base` default is context-sensitive: `<head>^` for commit tours, `HEAD` for `WIP` tours. Verbs: `create`, `annotate`, `list`, `show`, `close`, `delete`, `prune`, `tui`, `serve`. Bare `tour` opens TUI on the most recent open Tour.
- **On-disk schema**: `tour.toml` holds `id`, `title?`, `status`, `created_at`, `closed_at?`, `head_sha`, `base_sha`, `head_source`, `base_source`, `wip_snapshot`. `annotations.jsonl` is one annotation per line: `{id, file, side, line_start, line_end, body, author, created_at}`. `author` is a free-form string (e.g. `"agent"`, `"claude-code"`).
- **Webapp lifecycle**: `tour serve` is long-running, single-user, binds to `127.0.0.1:7777` (configurable), no auth. `Ctrl-C` to stop. Browser auto-open only with `--open`.
- **Snapshot loss**: if a Tour's `head_sha` no longer resolves (e.g. user manually ran `git update-ref -d refs/tour/<id>`), the UI shows a banner "Snapshot lost — annotations preserved but diff cannot be displayed." Read-only, can be deleted.
- **Packaging**: single binary, multi-subcommand (same shape as Backlog.md). One `tour` package containing a shared `core/` (git, tour IO, annotations, watcher) and two renderers (`tui/`, `web/`). Stack: Bun + TypeScript + OpenTUI for TUI; Bun HTTP server + React for web.
- **Diff engine (v1)**: all-in on Pierre + Hunk. `@pierre/diffs` parses git diffs and renders the web view (uses its built-in annotation framework). `hunkdiff/opentui` (`HunkDiffView`) renders the TUI on top of Pierre's parsed model. Accepted coupling: both are young packages from small teams; if either churns or stalls, we eat migration cost on that surface only — `core/` stays insulated.
- **Lifecycle**: two states, `open` and `closed`. Human transitions via `tour close` or UI button. Closed tours stay in `.tour/<id>/` with `status = "closed"`. Cleanup is explicit (`tour prune --older-than 30d`).
- **Folder layout**: `.tour/<id>/` flat at top level; each contains `tour.toml` (front-matter) and `annotations.jsonl` (append-only annotation log). `.tour/` is gitignored by default (auto-added on first `tour create`); teams can opt-in to commit by removing the line.
- **Working-tree snapshot mechanics**: `git stash create` produces a synthetic commit SHA without touching the working tree; `git update-ref refs/tour/<id> <sha>` keeps it alive past gc. Stored as `head_sha` in `tour.toml`. Released on `tour delete` / `tour prune` via `git update-ref -d refs/tour/<id>`.
- **Layout (v1)**: per-session, in-memory toggle between `split` and `unified`. Both surfaces default to `split` on first paint, matching the project's GitHub-style identity. Pressing `l` flips the layout in either surface (the webapp also exposes a segmented `[ Split | Unified ]` control in the top bar). State lives in `useState` on each renderer's `App`; not persisted (no localStorage, no `tour.toml` field, no on-disk state) and not synced across surfaces — page reload (webapp) or relaunch (TUI) returns to `split`. A single layout value applies to every Tour switched to in the same webapp session; layout is not stored on the Tour. Pierre's `diffStyle` and OpenTUI's `view` props consume the same `"split" | "unified"` vocabulary, so no translation layer.
