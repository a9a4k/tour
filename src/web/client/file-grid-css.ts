import { theme } from "../../core/theme.js";

/**
 * Layout + visual-cue CSS for the Tour-owned web row renderer (ADR 0024).
 *
 * Two structural ideas:
 *
 *   1. **File-level grid**: a per-file `<div data-layout="split|unified">`
 *      with `display: grid` and a column template baked from layout —
 *      `auto auto 1fr auto auto 1fr` (split: gutter-L, symbol-L, code-L,
 *      gutter-R, symbol-R, code-R) or `auto auto 1fr` (unified: gutter,
 *      symbol, code).
 *
 *   2. **Row subgrid**: each row is a `<div class="tour-row">` declaring
 *      `grid-template-columns: subgrid` + `grid-column: 1 / -1`. Rows
 *      inherit the file's column widths by structure rather than by
 *      hand-maintained CSS variables, so split-layout columns stay
 *      pixel-aligned as line-number digit counts cross thresholds.
 *
 * Decorations:
 *
 *   - `.is-cursor`: 2px accent outline around the cursored row. Driven
 *     by a React prop on `<DiffRow>` / `<InteractiveRow>`.
 *
 *   - `.in-range` (on `.tour-row-gutter` / `.tour-row-symbol` /
 *     `.tour-row-cell`): subtle blue tint painted per-side so split
 *     layout scopes the cue to the annotated half. Paired with
 *     `.in-range-stripe` on the leftmost tinted gutter — the 3px accent
 *     inset stripe (ADR 0008's two-cue range treatment).
 *
 *   - `[data-line-type]` two-tone tinting: the gutter + symbol cells
 *     carry a lighter range tint
 *     (`bg.successRange.web` / `bg.dangerRange.web`); the code cell
 *     carries a darker fill (`bg.successCell.web` / `bg.dangerCell.web`).
 *     Context rows inherit the canvas background (no rule).
 *
 *   - `.tour-card[data-side]`: side-anchored under the matching column
 *     triple in split layout (deletions cols 1-3, additions cols 4-6),
 *     full-width otherwise.
 */
export const FILE_GRID_CSS = `
  /* File-level grid container. data-layout flips column count. */
  .tour-file-block {
    display: grid;
    width: 100%;
  }

  .tour-file-block[data-layout="split"] {
    grid-template-columns: auto auto 1fr auto auto 1fr;
  }

  .tour-file-block[data-layout="unified"] {
    grid-template-columns: auto auto 1fr;
  }

  /* Sticky file header: GitHub-style flex row with a left disclosure /
     identity region and a right actions / metadata region. */
  .tour-file-header {
    position: sticky;
    top: 0;
    z-index: 10;
    cursor: pointer;
    background-color: ${theme.canvas.subtle};
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
  }

  .tour-file-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .tour-file-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }

  .tour-file-chevron {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: ${theme.fg.muted};
  }

  .tour-file-status-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: ${theme.fg.muted};
  }

  .tour-file-status-icon.added {
    color: ${theme.fg.success};
  }

  .tour-file-status-icon.deleted {
    color: ${theme.fg.danger};
  }

  /* Per-file diff-stats indicator: a 5-segment proportion bar followed by
     +N -M count text. Sits in the header's right region between the
     classification reason tag and the copy-path button (issue 228).
     Non-interactive — purely a display surface. */
  .tour-file-stats {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    flex-shrink: 0;
  }

  .tour-file-stats-bar {
    display: inline-flex;
    gap: 2px;
  }

  .tour-file-stats-segment {
    display: inline-block;
    width: 8px;
    height: 8px;
    background-color: ${theme.border.muted};
  }

  .tour-file-stats-segment.added {
    background-color: ${theme.fg.success};
  }

  .tour-file-stats-segment.deleted {
    background-color: ${theme.fg.danger};
  }

  .tour-file-stats-count.added {
    color: ${theme.fg.success};
  }

  .tour-file-stats-count.deleted {
    color: ${theme.fg.danger};
  }

  .tour-file-copy-button {
    background: transparent;
    border: none;
    cursor: pointer;
    color: ${theme.fg.muted};
    padding: 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font: inherit;
  }

  .tour-file-copy-button:hover {
    background-color: ${theme.bg.neutralSubtle.web};
    color: ${theme.fg.default};
  }

  .tour-file-copy-button:focus-visible {
    outline: 1px solid ${theme.border.accent};
    outline-offset: 1px;
  }

  /* Row subgrid: inherits the file's column tracks; spans the full width. */
  .tour-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }

  /* Line-number gutter: right-aligned, muted color, breathing room.
     font-family / font-size / line-height (issue 241) match the
     symbol + code cells so the row reads with one consistent vertical
     rhythm. Pre-241 the gutter inherited the body's sans-serif font at
     16px with browser-computed line-height — proportional-width digits
     broke visual rhythm and the content-dependent line-height drifted
     out of sync with the code cell on wrapped rows. GitHub's empirical
     default is monospace 12px / line-height 20px on both. */
  .tour-row-gutter {
    text-align: right;
    color: ${theme.fg.muted};
    padding: 0 8px;
    user-select: none;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    line-height: 20px;
  }

  /* Symbol column: single +/-/blank glyph, monospace, centered.
     Same font / size / line-height as the gutter + code (issue 241) so
     the plus / minus glyph aligns with the row's text baseline and the
     column widths stay digit-rhythmic. */
  .tour-row-symbol {
    text-align: center;
    padding: 0 4px;
    user-select: none;
    color: ${theme.fg.muted};
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    line-height: 20px;
  }

  /* Diff-row code cell: monospace text rendering. Pre-Pierre-cutover the
     enclosing <pre> wrapper supplied font-family + white-space; the
     Tour-owned <span class="tour-row-code"> wrapper introduced by the
     cutover (issue 220) inherited the body's sans-serif font and
     white-space: normal, collapsing indentation and word-wrapping inside
     the cell (issue 239). Path B (issue 240, replacing the original
     Path A from issue 239): soft-wrap long lines via white-space: pre-wrap +
     word-break: break-all — long lines flow onto additional physical
     rows under the same logical line number rather than producing a
     per-cell horizontal scrollbar. Matches GitHub's actual default
     (empirical DOM inspection of a live PR diff cell). pre-wrap
     preserves leading + internal whitespace identically to pre;
     break-all wraps a single unbroken token (URL, base64, generated
     hash, minified line) at a character boundary so nothing visually
     overflows the cell. */
  .tour-row-code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
    font-size: 12px;
    line-height: 20px;
  }

  .tour-row-cell {
    min-width: 0;
  }

  /* Two-tone line-type backgrounds: the gutter + symbol cells carry the
     lighter range tint; the code cell carries the darker fill. Context
     rows inherit canvas (no rule). */
  .tour-row[data-line-type="addition"] .tour-row-gutter,
  .tour-row[data-line-type="addition"] .tour-row-symbol,
  .tour-row[data-line-type="change-addition"] .tour-row-gutter,
  .tour-row[data-line-type="change-addition"] .tour-row-symbol {
    background-color: ${theme.bg.successRange.web};
  }

  .tour-row[data-line-type="addition"] .tour-row-cell,
  .tour-row[data-line-type="change-addition"] .tour-row-cell {
    background-color: ${theme.bg.successCell.web};
  }

  .tour-row[data-line-type="deletion"] .tour-row-gutter,
  .tour-row[data-line-type="deletion"] .tour-row-symbol,
  .tour-row[data-line-type="change-deletion"] .tour-row-gutter,
  .tour-row[data-line-type="change-deletion"] .tour-row-symbol {
    background-color: ${theme.bg.dangerRange.web};
  }

  .tour-row[data-line-type="deletion"] .tour-row-cell,
  .tour-row[data-line-type="change-deletion"] .tour-row-cell {
    background-color: ${theme.bg.dangerCell.web};
  }

  /* Comment-affordance pointer on annotatable diff lines. */
  .tour-row[data-line-type="addition"],
  .tour-row[data-line-type="deletion"],
  .tour-row[data-line-type="change-addition"],
  .tour-row[data-line-type="change-deletion"] {
    cursor: pointer;
  }

  /* Empty-side neutral fill: in split layout, the three cells of a
     single-side diff row recede behind canvas.inset so each row reads
     as "one side intentionally blank" rather than "content on one
     side, void on the other". Keys on the empty gutter's
     data-line-number="" signal (the attribute drops to "" when there
     is no line number); the adjacent-sibling chain extends the cue onto the
     matching symbol and code cell. :not(.in-range) lets the per-cell
     range tint win on the rare empty-side-in-range cell. */
  .tour-file-block[data-layout="split"] .tour-row-gutter[data-line-number=""]:not(.in-range),
  .tour-file-block[data-layout="split"] .tour-row-gutter[data-line-number=""] + .tour-row-symbol:not(.in-range),
  .tour-file-block[data-layout="split"] .tour-row-gutter[data-line-number=""] + .tour-row-symbol + .tour-row-cell:not(.in-range) {
    background-color: ${theme.canvas.inset};
  }

  /* Range tint: subtle accent fill painted per-side so split-layout rows
     scope the cue to the annotated half. The 3px accent inset stripe sits
     on the leftmost tinted gutter (.in-range-stripe). ADR 0008. */
  .tour-row-gutter.in-range,
  .tour-row-symbol.in-range,
  .tour-row-cell.in-range {
    background-color: ${theme.bg.accentRange.web};
  }

  .tour-row-gutter.in-range-stripe {
    box-shadow: inset 3px 0 0 ${theme.fg.accent};
  }

  /* Cursor outline — prop-driven (.is-cursor className). InteractiveRow
     paints the class on the row (full-width); DiffRow paints it on the
     cursored .tour-row-cell so split layout outlines only the cursored
     half instead of spanning both sides. */
  .tour-row.is-cursor,
  .tour-row-cell.is-cursor {
    outline: 2px solid ${theme.fg.accent};
    outline-offset: -1px;
    border-radius: 4px;
  }

  /* Hunk-header banner: GitHub-style full-width section divider with a
     subtle accent tint. The row spans 1 / -1 via grid-column (no subgrid
     here — the two text segments flow inline). Range segment renders
     muted; context segment renders in the default fg. */
  .tour-hunk-header {
    /* Override .tour-row's display:grid + subgrid template so the two
       text segments flow inline as block content instead of slotting
       into the gutter/symbol tracks (which would force-wrap the text). */
    display: block;
    background-color: ${theme.bg.accentSubtle.web};
    padding: 6px 16px;
    cursor: pointer;
  }

  .tour-hunk-header-range {
    color: ${theme.fg.muted};
  }

  .tour-hunk-header-context {
    color: ${theme.fg.default};
    margin-left: 1ch;
  }

  /* Interactive-row banner: gap / boundary / collapsed-file expansion
     affordances render as a quiet full-width section divider with a
     neutral subtle tint — visually distinct from the hunk-header's
     accent tint so the two banner families differentiate at a glance
     (hunk header = navigation marker; interactive row = expansion
     control). The row spans 1 / -1 via grid-column; this rule overrides
     .tour-row's display:grid + subgrid template so the glyph centers
     as block content instead of auto-placing into the narrow leftmost
     gutter track. */
  .tour-row-interactive {
    display: block;
    background-color: ${theme.bg.neutralSubtle.web};
    padding: 6px 16px;
    cursor: pointer;
    text-align: center;
    color: ${theme.fg.muted};
  }

  /* Cards: full-width by default; side-anchored in split layout
     (deletions cols 1-3, additions cols 4-end after the new symbol track). */
  .tour-card {
    grid-column: 1 / -1;
  }

  .tour-file-block[data-layout="split"] .tour-card[data-side="deletions"] {
    grid-column: 1 / 4;
  }

  .tour-file-block[data-layout="split"] .tour-card[data-side="additions"] {
    grid-column: 4 / -1;
  }
`;
