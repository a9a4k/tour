# TUI uses a Tour-owned row renderer on Pierre's parser

ADR 0001 named `hunkdiff/opentui` (`HunkDiffView`) as the TUI renderer, but the published `hunkdiff@0.10.0` ships only a CLI binary — `HunkDiffView` is upstream-internal-only, and even when consumed it doesn't expose inline annotation slots (its `annotated` flag is hardcoded `false`). The TUI silently fell back to OpenTUI's built-in `<diff>`, which has no per-row insertion point either. Both renderers are therefore dead-ends for matching the webapp's "annotation card directly below the highlighted range" pattern.

We render the diff ourselves by walking `@pierre/diffs`'s `FileDiffMetadata` row-by-row through a Tour-owned row planner in `core/`. Each diff row becomes one OpenTUI element; annotations interleave as `<box>` cards directly under their `line_end` row. Pierre stays the parser in both surfaces; only the rendering strategy diverges.

## Considered Options

- **`@opentui/core`'s `<diff>` + `highlightLines` API.** Rejected: `<diff>` is monolithic — no slot for content between rows. Annotations would have to live in a separate panel, which is exactly the bug we're fixing.
- **Switch to `hunkdiff/opentui`'s published `HunkDiffView`.** Rejected: same constraint — the public component hardcodes `annotated={false}` and exposes no `visibleAgentNotes` slot. Switching would close the doc/code gap from ADR 0001 but wouldn't solve the annotation-positioning problem.
- **Vendor Hunk's internal `PierreDiffView` + `reviewRenderPlan` + `AgentInlineNote`.** Rejected: ~600 LOC of upstream-internal code; Hunk is young and churning; we'd be forking ahead of upstream with no upgrade path.
- **Wait for Hunk to publish `PierreDiffView` with annotation slots.** Rejected: blocks shipping; no committed upstream timeline.
- **Build a smaller row-based renderer on `@pierre/diffs`'s parser.** Chosen. We already depend on Pierre for the webapp; reusing the parser keeps `core/` insulated and the renderer narrow.

## Consequences

- The row planner lives in `core/` (likely `core/diff-rows.ts`) so both TUI and any future renderer can share it. The webapp continues to use Pierre's `FileDiff` directly — only the TUI consumes the row planner.
- ~~Loss of `<diff>`'s built-in syntax highlighting in v1. Recoverable later by integrating shiki or tree-sitter at the row level.~~ Recovered in ADR 0009 by rendering each row's content cell through OpenTUI's `<code>` renderable (per-line `tree-sitter`).
- Maintenance burden moves from "track upstream Hunk" to "own a small renderer". The renderer's scope is intentionally narrow (line text, line numbers, +/- bg, gutter mark, range tint, annotation card insertion).
- ADR 0001's "renderer swap is bounded to that surface" property is preserved: `core/` still depends only on Pierre's parsed model.
