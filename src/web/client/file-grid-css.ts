import { theme } from "../../core/theme.js";

/**
 * Layout + visual-cue CSS for the Tour-owned web row renderer (PRD #212
 * slice 3, ADR 0024). Replaces the seven CSS-string blobs `App.tsx`
 * accumulated around Pierre's grid: sticky header, comment affordance,
 * column template, gap-row layout, cursor outline, plus-button placement,
 * range tint.
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
 *     by a React prop (PRD #212 "Cursor outline is a prop") — no
 *     `useEffect` mutates a data-attribute anymore.
 *
 *   - `.in-range`: subtle blue tint + a 3px accent inset stripe at the
 *     row's left edge — the same two-cue treatment `annotations.ts`
 *     paints on Pierre rows today (ADR 0008).
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

  /* Sticky file header — retargeted from Pierre's [data-diffs-header]. */
  .tour-file-header {
    position: sticky;
    top: 0;
    z-index: 10;
    cursor: pointer;
    background-color: ${theme.canvas.subtle};
  }

  /* Row subgrid: inherits the file's column tracks; spans the full width. */
  .tour-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }

  /* Line-number gutter: right-aligned, muted color, breathing room. */
  .tour-row-gutter {
    text-align: right;
    color: ${theme.fg.muted};
    padding: 0 8px;
    user-select: none;
  }

  /* Symbol column: single +/-/blank glyph, monospace, centered. */
  .tour-row-symbol {
    text-align: center;
    padding: 0 4px;
    user-select: none;
    color: ${theme.fg.muted};
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

  /* Range tint: subtle accent fill + 3px accent inset stripe at the
     left edge — same two-cue treatment annotations.ts paints today. */
  .tour-row.in-range {
    background-color: ${theme.bg.accentRange.web};
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
