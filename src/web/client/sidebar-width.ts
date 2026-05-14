import type { VisibleRow } from "../../core/file-tree.js";
import type { BundleFile } from "./types.js";

// Web sidebar width math (issue #323). Pixel-based mirror of
// `src/tui/sidebar-width.ts`. The TUI works in columns and uses
// `FileRowStats` from `src/tui/sidebar-row-label.ts`; the web works in
// pixels and computes per-row width from chevron / icon / displayName
// (measured in chars at the sidebar's font-size) / annotation badge.
//
//   * `clampSidebarWidthPx(width, viewportWidth)` is the AUTO-FIT clamp.
//     Range is `[SIDEBAR_MIN_PX, max(SIDEBAR_MIN_PX, viewportWidth -
//     DIFF_PANE_MIN_PX)]` — the cap reserves a defensible diff-pane
//     minimum (600 px: line numbers + gutter + indent + readable code
//     width). Auto-fit cannot squeeze the diff below this floor.
//
//   * `clampSidebarWidthManualPx(width, viewportWidth)` is the wider
//     clamp used by the user-explicit drag handle. Range is
//     `[SIDEBAR_MIN_PX, max(SIDEBAR_MIN_PX, viewportWidth -
//     SIDEBAR_MIN_PX)]` — an explicit user gesture honors only the
//     hard floor on the diff side (symmetric with the sidebar's floor).
//     Manual drag can squeeze the diff below `DIFF_PANE_MIN_PX`;
//     auto-fit cannot. Same semantics as the TUI's `[`/`]` keys.
//
//   * `computeAutoFitWidthPx(rows, opts)` walks the visible rows, takes
//     the widest row's total fixed cost + character-measured displayName
//     width, and clamps via `clampSidebarWidthPx`.
//
// Tour-switch reset semantics: manual drag width is session-local. The
// next tour switch re-runs auto-fit and the manual override does not
// carry over. Mirrors the TUI.
//
// Why pixel-based rather than a shared core helper? The TUI's
// `fileRowFixedCost` couples to `sidebar-row-label`'s indent + caret +
// badge constants (cols); the web's equivalent couples to padding-left
// + icon-size + gap (px). Lifting both into a single parameterised
// helper would require threading a units-aware indent spec through
// either surface — more invasive than the duplication. The math is
// documented in parallel.

export const SIDEBAR_MIN_PX = 240;
export const SIDEBAR_DEFAULT_PX = 280;
export const DIFF_PANE_MIN_PX = 600;

// Char-width approximation for the sidebar's 13px sans-serif font.
// happy-dom does not implement layout, so we cannot measure with a
// canvas at test time and need a deterministic constant for both the
// fit math and the unit tests. 7.2 px / char is a defensible average
// for 13-px -apple-system / Segoe UI proportional text; we err slightly
// wide to avoid trailing-character clipping at the cap.
export const SIDEBAR_CHAR_PX = 7.2;

// Per-row fixed-cost constants (pixels). Pulled from the CSS in spa.ts
// so the fit math stays consistent with the rendered DOM:
//   .file-entry / .folder-entry: padding 16 px right + flex `gap: 8 px`
//   between siblings; tree-icon / status-icon: 16 px width.
// File rows render `<status-icon> · <name> · ?badge`; folders render
// `<chevron> · <folder-icon> · <name>`. The folder fixed cost is two
// icons + two gaps; the file fixed cost is one icon + one gap, plus a
// badge tail when the row carries annotations.
export const SIDEBAR_INDENT_BASE_PX = 16;
export const SIDEBAR_INDENT_PER_DEPTH_PX = 16;
export const SIDEBAR_ICON_PX = 16;
export const SIDEBAR_GAP_PX = 8;
export const SIDEBAR_PADDING_RIGHT_PX = 16;
// `.badge` is `padding: 1px 6px; margin-left: auto;` — measured at
// ~28 px for a single-digit count, ~36 px for double-digits. Bias
// wide; the goal is "no ellipsis" not "exact fit."
export const SIDEBAR_BADGE_PX = 36;

export function clampSidebarWidthPx(
  width: number,
  viewportWidth: number,
): number {
  const cap = Math.max(SIDEBAR_MIN_PX, viewportWidth - DIFF_PANE_MIN_PX);
  return Math.max(SIDEBAR_MIN_PX, Math.min(cap, width));
}

export function clampSidebarWidthManualPx(
  width: number,
  viewportWidth: number,
): number {
  const cap = Math.max(SIDEBAR_MIN_PX, viewportWidth - SIDEBAR_MIN_PX);
  return Math.max(SIDEBAR_MIN_PX, Math.min(cap, width));
}

// Fixed pixel cost of a row's decorations (everything but the
// displayName text). File rows: indent + status icon + gap + (optional
// badge + gap) + right padding. Folder rows: indent + chevron + gap +
// folder icon + gap + right padding.
export function fileRowFixedPx(depth: number, annotationCount: number): number {
  const indent = SIDEBAR_INDENT_BASE_PX + depth * SIDEBAR_INDENT_PER_DEPTH_PX;
  const badgeTail =
    annotationCount > 0 ? SIDEBAR_BADGE_PX + SIDEBAR_GAP_PX : 0;
  return (
    indent +
    SIDEBAR_ICON_PX +
    SIDEBAR_GAP_PX +
    badgeTail +
    SIDEBAR_PADDING_RIGHT_PX
  );
}

export function folderRowFixedPx(depth: number): number {
  const indent = SIDEBAR_INDENT_BASE_PX + depth * SIDEBAR_INDENT_PER_DEPTH_PX;
  return (
    indent +
    SIDEBAR_ICON_PX + // chevron
    SIDEBAR_GAP_PX +
    SIDEBAR_ICON_PX + // folder icon
    SIDEBAR_GAP_PX +
    SIDEBAR_PADDING_RIGHT_PX
  );
}

// Minimum sidebar width (px) that lets every visible row render without
// CSS ellipsis clipping. Clamped to the auto-fit cap. Empty row lists
// fall back to SIDEBAR_DEFAULT_PX (still clamped).
export function computeAutoFitWidthPx(
  rows: ReadonlyArray<VisibleRow<BundleFile>>,
  viewportWidth: number,
): number {
  if (rows.length === 0) {
    return clampSidebarWidthPx(SIDEBAR_DEFAULT_PX, viewportWidth);
  }
  let maxContent = 0;
  for (const row of rows) {
    const fixed =
      row.kind === "folder"
        ? folderRowFixedPx(row.depth)
        : fileRowFixedPx(row.depth, row.annotationCount);
    const nameWidth = Math.ceil(row.displayName.length * SIDEBAR_CHAR_PX);
    const cost = fixed + nameWidth;
    if (cost > maxContent) maxContent = cost;
  }
  return clampSidebarWidthPx(maxContent, viewportWidth);
}
