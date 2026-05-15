import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import {
  clampPaneWidth,
  clampPaneWidthManual,
} from "../core/sidebar-width-clamp.js";
import {
  folderRowFixedCost,
  fileRowFixedCost,
  type FileRowStats,
} from "./sidebar-row-label.js";

// Sidebar auto-fit width (issue #312; cap formula retuned in issue
// #315). The scalar clamps lifted to `src/core/sidebar-width-clamp.ts`
// in #328 so the TUI and web share the formula; this module keeps the
// col-unit constants and the row-cost-coupled fit computation.
//
//   * `computeAutoFitWidth(rows, statsFor, terminalWidth)` runs on
//     every tour-id change. Walks the visible rows, takes the widest
//     row's `fixedCost + displayName.length`, adds the box border,
//     and clamps via `clampSidebarWidth`.
//
//   * `clampSidebarWidth` / `clampSidebarWidthManual` thin-wrap the
//     core helpers with the TUI's col constants. Auto-fit reserves
//     `DIFF_PANE_MIN_WIDTH` for the diff pane; manual resize (`[` /
//     `]`) only the symmetric hard floor `SIDEBAR_MIN_WIDTH`.
//
//   * `INDENT_PER_DEPTH` in `sidebar-row-label.ts` dropped from 2 to
//     1 in #312 — load-bearing for narrow-terminal degenerate cases
//     where the diff-floor cap collapses to MIN.
//
// `DIFF_PANE_MIN_WIDTH = 60` is the bare-minimum diff readability
// budget for typical code: line numbers, gutter, indent, and enough
// content to recognise a statement. Static rather than derived from
// actual diff content — a per-bundle derivation adds complexity for
// marginal gain; 60 cols is defensible across the cohort.

export const SIDEBAR_MIN_WIDTH = 24;
export const SIDEBAR_BORDER = 2;
export const DIFF_PANE_MIN_WIDTH = 60;
export const SIDEBAR_RESIZE_STEP = 2;
export const SIDEBAR_DEFAULT_WIDTH = 30;

export function clampSidebarWidth(width: number, terminalWidth: number): number {
  return clampPaneWidth(
    width,
    terminalWidth,
    DIFF_PANE_MIN_WIDTH,
    SIDEBAR_MIN_WIDTH,
  );
}

export function clampSidebarWidthManual(
  width: number,
  terminalWidth: number,
): number {
  return clampPaneWidthManual(width, terminalWidth, SIDEBAR_MIN_WIDTH);
}

export function computeAutoFitWidth(
  rows: ReadonlyArray<VisibleRow<DiffFile>>,
  statsFor: (filePath: string) => FileRowStats,
  terminalWidth: number,
): number {
  if (rows.length === 0) {
    return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, terminalWidth);
  }
  let maxContent = 0;
  for (const row of rows) {
    const cost =
      row.kind === "folder"
        ? folderRowFixedCost(row) + row.displayName.length
        : fileRowFixedCost(row, statsFor(row.path)) + row.displayName.length;
    if (cost > maxContent) maxContent = cost;
  }
  return clampSidebarWidth(maxContent + SIDEBAR_BORDER, terminalWidth);
}
