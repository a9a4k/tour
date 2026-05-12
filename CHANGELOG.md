# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — Unreleased

### Breaking changes

- **Bare `tour` picks the best surface for your environment.** Previously,
  `tour` (no subcommand) always launched the TUI. It now starts the
  webapp and prints its URL when a browser is reachable (desktop
  linux/darwin with a TTY, `open` or `xdg-open` on PATH, no SSH session)
  and falls back to the TUI otherwise (ssh, piped/non-TTY stdout,
  windows, no opener). The URL is Cmd/Ctrl-clickable in modern
  terminals — bare `tour` does **not** auto-open the browser, so
  re-running the command does not stack tabs. Users who want the
  browser launched automatically run `tour serve --open` explicitly,
  which is unchanged. `tour tui` is also unchanged. The first-run
  banner (no tours present) still prints unchanged.

  The deciding criterion is annotation fidelity: the webapp renders
  markdown + mermaid, the TUI shows raw source. New users on a desktop
  now get the higher-fidelity surface by default.

  Issue: #175 · PRD: #174

### Added

- `tour serve` prints a one-line tip when exactly one shipped agent CLI
  (`claude`, `codex`, `gemini`, `opencode`, `pi`) is reachable on PATH
  and `--reply-agent` is not passed, suggesting the flag. Zero or
  multiple matches stay silent. The tip is informational only — the
  reply watcher remains inert unless `--reply-agent` is explicitly
  given (ADR 0010 inert-by-default invariant). (#176)

### Changed

- **`tour serve` reuses a running server when one already exists for the
  same working directory.** Before binding, the entry point probes the
  preferred port (`GET /__alive`) and, if it finds a Tour server whose
  `cwd` matches, prints `Tour already running at http://127.0.0.1:<port>`
  and exits 0 — no second server is started. Different-cwd Tour or
  non-Tour processes on the port behave as before (fall back to the
  next port, or surface `port N is in use` when `--port` was explicit).
  Stable URLs across re-runs; no process / watcher proliferation. (#178)
- **`tour serve <id>` prints a deep URL.** When a positional tour-id is
  passed, the startup line now includes `/<id>` as a path component
  (e.g. `Tour server running at http://127.0.0.1:8687/<id>`) so the
  user can Cmd-click straight to that tour in a modern terminal.
  `tour serve` without a tour-id is unchanged (bare base URL). The
  port-collision fallback path also includes `/<id>` and reflects the
  actually-bound port. `--open` opens the deep URL too. (#179)
- **SPA reads tour-id from the URL path and annotation-id from the URL
  fragment.** Precedence is path → query → baked global for tour-id,
  fragment → query for annotation-id. Loading `/<tour-id>` always
  displays that tour regardless of what id the server's HTML carries —
  the probe-reuse case (Issue #178) no longer mis-routes the printed
  deep URL. Loading `/<tour-id>#<ann-id>` scrolls to the named
  annotation. Internal navigation (tour-picker, n/p cursor) now writes
  the new path + fragment shape; legacy `?tour=&ann=` URLs remain
  readable as a back-compat fallback. (#179)
- **TUI footer hint labels the `a` action as `comment`** (was
  `annotate`), aligning Tour's vocabulary with the universal
  convention used by every collaborative code-review tool. The webapp
  composer's affordance already read "Comment" / "Leave a comment".
  The `a` keybinding, the `tour annotate` CLI verb, the "Annotation"
  domain noun, the schema, and the Pierre `AnnotationSide` coupling
  are all unchanged. (#183)

### Fixed

- **Address bar updates when the SPA is entered at bare `/`.** The
  URL-writer effect's "URL contradicts state" gate previously read the
  URL with a `null` fallback, so a bare `/` resolved to `null` and the
  writer treated it as a contradiction with the auto-selected tour-id
  in state — skipping the write on every cursor move and freezing the
  address bar at `/`. The gate now uses the state's tour-id as the
  fallback: a bare URL is no contradiction (the writer migrates `/`
  to `/<tour-id>#<ann-id>` on first cursor anchor), while a URL that
  asserts a *different* tour-id (the in-flight tour-switch window)
  still skips. (#180)
