import { theme } from "../../core/theme.js";

/* GitHub's web monospace stack, byte-for-byte. Three diff-row rules
   (.tour-row-gutter, .tour-row-symbol, .tour-row-code) share this so the
   gutter, +/- symbol, and code text resolve to the same monospace face
   on every platform. Interpolated as a literal string into the emitted
   CSS — keeping it a TS constant (rather than a CSS custom property)
   preserves the "monospace" substring the typography tests pattern-match
   against. .tour-file-stats carries its own narrower stack (no
   "SF Mono", no "Liberation Mono") and stays inline — out of scope
   for issue #241. */
const MONO_STACK =
  `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

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
 *     carry the brighter range tint
 *     (`bg.successRange.web` / `bg.dangerRange.web`, alpha .30); the
 *     code cell carries a softer wash (`bg.successCell.web` /
 *     `bg.dangerCell.web`, alpha .15 / .10). Empirically matches
 *     GitHub's direction (bright gutter rail, soft code, issue #247);
 *     the rail anchors the vertical scan and the softer code cell
 *     keeps syntax-highlighted tokens readable. Context rows inherit
 *     the canvas background (no rule).
 *
 *   - `.tour-card[data-side]`: side-anchored under the matching column
 *     triple in split layout (deletions cols 1-3, additions cols 4-6),
 *     full-width otherwise.
 */
export const FILE_GRID_CSS = `
  /* Per-file card container (issue 249). GitHub wraps each file in a
     bordered, rounded card with vertical spacing between cards — the
     single biggest navigation cue in a multi-file PR review. The card
     contains the sticky file header and the diff body. Rounded-corner
     clipping uses \`clip-path: inset(0 round 6px)\` instead of
     \`overflow: hidden\` — the latter creates a scroll-container ancestor
     for the sticky file-header, which makes sticky resolve against
     this non-scrolling box and therefore never stick. \`clip-path\` is
     a visual clip only (no scroll container), so the sticky header
     resolves against \`.app-main\` (the real scroll container) and
     pins at viewport top during scroll, matching GitHub. Last card's
     \`margin-bottom\` is absorbed by the parent container's
     \`padding-bottom\`. */
  .tour-file-outer {
    border: 1px solid ${theme.border.default};
    border-radius: 6px;
    margin-bottom: 16px;
    clip-path: inset(0 round 6px);
    background-color: ${theme.canvas.default};
  }

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

  /* Filename shrink behaviour (issue 317): with the copy-path button now
     in the left region after the filename, a very long path needs to be
     the thing that gives way — not the button, not the right region. The
     left region is already flex; min-width: 0 lets the filename shrink
     below its intrinsic content width, and the overflow / ellipsis rules
     keep the truncation visible. The button stays flex-shrink: 0 so it
     remains visible adjacent to the (truncated) filename. */
  .tour-file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Per-file diff-stats indicator: a 5-segment proportion bar followed by
     +N -M count text. Sits in the header's right region after the
     classification reason tag (issue 228 / issue 317 — the copy-path
     button moved to the left region next to the filename). Non-
     interactive — purely a display surface. */
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

  /* Issue 319: min-width pins the button's bounding box so swapping the
     CopyIcon for a CheckIcon (on a successful clipboard write) doesn't
     reflow the adjacent filename or right region. 24px = 16px icon + 4px
     padding × 2 — matches the button's intrinsic width with the copy icon
     today and absorbs any future icon-size drift between the two glyphs. */
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
    min-width: 24px;
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

  /* Per-file Expand-all-hidden button (PRD 270 / issue 274 Slice 4).
     Sits in the file-header right region between the diff-stats indicator
     and the copy-path button. Click dispatches the new expand-file-all
     reducer action; stopPropagation in the handler defends against the
     header-level collapse-toggle (same pattern as the copy-path button
     from issue 225). Visual treatment mirrors the copy-path button so
     the two header-right buttons read as a single chrome family. v1
     uses the up/down-arrow ASCII glyph (no Octicons per PRD scope). */
  .tour-file-expand-all-button {
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
    line-height: 1;
  }

  .tour-file-expand-all-button:hover {
    background-color: ${theme.bg.neutralSubtle.web};
    color: ${theme.fg.default};
  }

  .tour-file-expand-all-button:focus-visible {
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
    font-family: ${MONO_STACK};
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
    font-family: ${MONO_STACK};
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
    font-family: ${MONO_STACK};
    white-space: pre-wrap;
    word-break: break-all;
    tab-size: 2;
    font-size: 12px;
    line-height: 20px;
  }

  .tour-row-cell {
    min-width: 0;
  }

  /* Two-tone line-type backgrounds (issue 247): the gutter + symbol
     cells carry the brighter range tint (alpha .30); the code cell
     carries a softer wash (alpha .15 / .10). Bright rail anchors the
     vertical scan; the soft wash behind code keeps syntax-highlighted
     tokens readable. Context rows inherit canvas (no rule). */
  .tour-row[data-line-type="addition"] .tour-row-gutter,
  .tour-row[data-line-type="addition"] .tour-row-symbol,
  .tour-row[data-line-type="change-addition"] .tour-row-gutter[data-side="additions"],
  .tour-row[data-line-type="change-addition"] .tour-row-symbol[data-side="additions"] {
    background-color: ${theme.bg.successRange.web};
  }

  .tour-row[data-line-type="addition"] .tour-row-cell,
  .tour-row[data-line-type="change-addition"] .tour-row-cell[data-side="additions"] {
    background-color: ${theme.bg.successCell.web};
  }

  .tour-row[data-line-type="deletion"] .tour-row-gutter,
  .tour-row[data-line-type="deletion"] .tour-row-symbol,
  .tour-row[data-line-type="change-addition"] .tour-row-gutter[data-side="deletions"],
  .tour-row[data-line-type="change-addition"] .tour-row-symbol[data-side="deletions"],
  .tour-row[data-line-type="change-deletion"] .tour-row-gutter,
  .tour-row[data-line-type="change-deletion"] .tour-row-symbol {
    background-color: ${theme.bg.dangerRange.web};
  }

  .tour-row[data-line-type="deletion"] .tour-row-cell,
  .tour-row[data-line-type="change-addition"] .tour-row-cell[data-side="deletions"],
  .tour-row[data-line-type="change-deletion"] .tour-row-cell {
    background-color: ${theme.bg.dangerCell.web};
  }

  /* Tinted-row foreground (issue 248): on rows whose gutter+symbol
     wear the bright range tint, the line-number digits and +/- glyph
     promote from fg.muted to fg.default so the text stays legible
     against the saturated rail. Context rows have no [data-line-type]
     background rule, so this selector also doesn't match — they keep
     the base muted color. Mirrors GitHub's pattern (white text on
     tinted rows, muted on context). */
  .tour-row[data-line-type="addition"] .tour-row-gutter,
  .tour-row[data-line-type="addition"] .tour-row-symbol,
  .tour-row[data-line-type="change-addition"] .tour-row-gutter,
  .tour-row[data-line-type="change-addition"] .tour-row-symbol,
  .tour-row[data-line-type="deletion"] .tour-row-gutter,
  .tour-row[data-line-type="deletion"] .tour-row-symbol,
  .tour-row[data-line-type="change-deletion"] .tour-row-gutter,
  .tour-row[data-line-type="change-deletion"] .tour-row-symbol {
    color: ${theme.fg.default};
  }

  /* Issue 320: the GitHub-style `+` button is now the only "click me" cue
     on a diff row. The historical row-level cursor:pointer rule has been
     removed — a hover hint on the whole row competed with the per-row
     `+` button affordance and over-advertised the row-click behaviour
     (row click only seeds the cursor; no Composer opens until the user
     clicks the `+`). */

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

  /* Split-layout vertical rule (issue 251): GitHub paints a 1px translucent
     border-left on the additions-side line-number gutter cell, producing a
     continuous vertical rule down the column boundary between the deletions
     and additions halves. Without it, the two halves blend visually on
     context blocks. Solid theme.border.muted is close enough to GitHub's
     rgba(61, 68, 77, 0.7) blended over canvas.default; reuses the existing
     muted-border token. Scoped to [data-layout="split"] so unified-layout
     rows do not paint a phantom line; clipped to the file-card's rounded
     corners by the .tour-file-outer overflow:hidden (issue 249). Banner
     rows (hunk-header, interactive-row) and annotation cards span the full
     width without an additions-side gutter, so the rule naturally breaks at
     each banner — matches GitHub. */
  .tour-file-block[data-layout="split"] .tour-row-gutter[data-side="additions"] {
    border-left: 1px solid ${theme.border.muted};
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

  /* Hunk-header banner (issue 280): two-cell layout matching GitHub's
     @@ row — saturated leftmost button cell (~44px) carrying the
     primary expand affordance + accent-subtle right cell carrying the
     range + function-context text. The outer row uses display: flex to
     escape .tour-row's display: grid + subgrid template; the cells own
     their own insets so padding on the outer rule is 0.

     Typography (issue 253): banner inherits MONO_STACK / 12px / 20px so
     the text reads as part of the diff stream rather than as UI chrome.
     Child spans (.tour-hunk-header-range, .tour-hunk-header-context)
     inherit these declarations naturally. */
  .tour-hunk-header {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    background-color: ${theme.bg.accentSubtle.web};
    font-family: ${MONO_STACK};
    font-size: 12px;
    line-height: 20px;
    padding: 0;
  }

  .tour-hunk-header-button {
    /* Saturated leftmost cell, matches GitHub's blob-num-expandable
       block. The cell is interactive when primaryExpand is non-null and
       paints an inert ellipsis placeholder otherwise. */
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: ${theme.bg.accentEmphasis};
    color: ${theme.fg.onEmphasis};
    user-select: none;
  }

  .tour-hunk-header-button[role="button"] {
    cursor: pointer;
  }

  .tour-hunk-header-button[role="button"]:focus-visible {
    outline: 2px solid ${theme.fg.accent};
    outline-offset: -2px;
  }

  .tour-hunk-header-text {
    /* Right cell. Inherits the row's accent-subtle wash; matches GitHub's
       blob-code-hunk inset. */
    flex: 1 1 auto;
    padding: 6px 16px;
    min-width: 0;
  }

  .tour-hunk-header-range {
    color: ${theme.fg.muted};
  }

  .tour-hunk-header-context {
    /* Both range and context render in fg.muted to match GitHub's
       continuous-grey treatment. The hunk header is metadata, not code —
       muting the whole banner signals "you can skip reading this
       carefully" and keeps reviewer attention on the diff rows below. */
    color: ${theme.fg.muted};
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

  /* GitHub-style annotate + button (issue 320). The gutter cell hosts a
     positioned button that overlays the gutter/cell boundary: ~85% of the
     button sits over the row's highlight rail, ~15% nests back into the
     gutter. Visibility is CSS-driven so no per-row React re-render fires
     on hover. The gutter's position:relative is supplied here (not on
     the base rule) so it's scoped to rows that actually carry the button. */
  .tour-row-gutter:has(.tour-row-annotate-btn) {
    position: relative;
  }

  .tour-row-annotate-btn {
    /* Square chip floating over the gutter/cell boundary. */
    position: absolute;
    right: 0;
    top: 50%;
    transform: translate(85%, -50%);
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background-color: ${theme.fg.accent};
    color: ${theme.fg.onEmphasis};
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    user-select: none;
    z-index: 2;
  }

  /* Reveal on row hover OR when the gutter's matching cell carries the
     cursor outline. The :has() selector lets us match "this row has a
     cursored cell on the same side as this gutter" without per-row React
     state; the .tour-row-cell.is-cursor selector keyed by data-side is
     the ground-truth visual signal. */
  .tour-row:hover .tour-row-annotate-btn,
  .tour-row:has(.tour-row-cell[data-side="additions"].is-cursor)
    .tour-row-gutter[data-side="additions"]
    .tour-row-annotate-btn,
  .tour-row:has(.tour-row-cell[data-side="deletions"].is-cursor)
    .tour-row-gutter[data-side="deletions"]
    .tour-row-annotate-btn {
    display: inline-flex;
  }

  /* Ghost state: when a Composer is open anywhere on the page, every +
     button reads as muted. Clicking still works (auto-recall) but the
     visual transition advertises the one-Composer-at-a-time rule. The
     [data-composer-open] attribute is set on the html element by App.tsx
     whenever composer.kind is non-closed. */
  [data-composer-open] .tour-row-annotate-btn {
    background-color: ${theme.fg.muted};
    opacity: 0.4;
    box-shadow: none;
  }
`;
