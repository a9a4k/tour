# Pierre + Hunk for diff parsing and rendering

We use `@pierre/diffs` to parse git diffs and render the web view (its built-in annotation framework saves us from inventing one), and `hunkdiff/opentui` (`HunkDiffView`) to render the TUI on top of Pierre's parsed model. Both surfaces consume the same Pierre model; `core/` only knows about it through a thin adapter so a renderer swap is bounded to that surface.

## Considered Options

- **Pierre + `react-diff-view` + custom OpenTUI** — most mature individually, but Pierre's annotation framework is a real positioning/layout win we'd have to recreate. Rejected because v1 budget doesn't justify the rebuild.
- **Hand-rolled parser + custom React + custom OpenTUI** — maximum maturity floor, no upstream coupling, ~1.5–2k more LOC. Rejected for v1; reasonable destination if Pierre churns badly.
- **Pierre web + hand-rolled OpenTUI on Pierre's parser** — middle path, drops `hunkdiff/opentui` coupling. Rejected because we'd be reimplementing what `hunkdiff/opentui` already does, for marginal isolation gain.

## Consequences

- We accept that both packages are young (Pierre 1.1.x; `hunkdiff` similarly recent) and could churn or stall. The `core/` data model is decoupled from Pierre, so a future migration is renderer-scoped, not data-scoped.
- Pierre's annotation slots are anchored by `(side, lineNumber)` only — multi-line range annotations anchor at `line_start` and let `body` describe the range, or use Pierre's `selectedLines` for visual range highlighting later.
- Our `Side` vocabulary (`additions | deletions`) is chosen to match Pierre's `AnnotationSide` so no translation is needed at the boundary.
