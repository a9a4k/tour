import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import {
  folderRowFixedCost,
  fileRowFixedCost,
  type FileRowStats,
} from "./sidebar-row-label.js";

// Sidebar auto-fit width (issue #312; cap formula retuned in issue
// #315). Four composable knobs let deep trees render readable
// filenames without forcing the user to guess a fixed column count:
//
//   * `computeAutoFitWidth(rows, statsFor, terminalWidth)` runs on
//     every tour-id change. Walks the visible rows, takes the widest
//     row's `fixedCost + displayName.length`, adds the box border,
//     and clamps via `clampSidebarWidth`.
//
//   * `clampSidebarWidth(width, terminalWidth)` is the auto-fit
//     clamp. Range is `[SIDEBAR_MIN_WIDTH, max(SIDEBAR_MIN_WIDTH,
//     terminalWidth - DIFF_PANE_MIN_WIDTH)]` — the cap reserves a
//     defensible diff-pane minimum rather than an arbitrary fraction
//     of the terminal width. Replaced the pre-#315 percentage cap
//     (`floor(terminalWidth * 0.4)`) which made the reproduction
//     case from issue #315 (117-col terminal, depth-5 row needing 54
//     cols) impossible to satisfy: auto-fit topped out at 46 cols
//     and `]` could not push past the same percentage ceiling.
//
//   * `clampSidebarWidthManual(width, terminalWidth)` is the wider
//     clamp used by the `[`/`]` keypress handler. Range is
//     `[SIDEBAR_MIN_WIDTH, max(SIDEBAR_MIN_WIDTH, terminalWidth -
//     SIDEBAR_MIN_WIDTH)]` — an explicit user gesture honors only
//     the hard floor on the diff side (24 cols guaranteed for the
//     diff pane, symmetric with the sidebar's floor). Manual resize
//     can squeeze the diff below `DIFF_PANE_MIN_WIDTH`; auto-fit
//     cannot.
//
//   * `INDENT_PER_DEPTH` in `sidebar-row-label.ts` dropped from 2 to
//     1 in #312 — orthogonal to the cap fix, still load-bearing for
//     narrow-terminal degenerate cases where the diff-floor cap
//     collapses to MIN.
//
// `DIFF_PANE_MIN_WIDTH = 60` is the bare-minimum diff readability
// budget for typical code: line numbers, gutter, indent, and enough
// content to recognise a statement. Static rather than derived from
// actual diff content — a per-bundle derivation adds complexity for
// marginal gain; 60 cols is defensible across the cohort.
//
// MIN floor wins over either cap when they collide (degenerate
// narrow-terminal case). Empty row lists fall back to
// SIDEBAR_DEFAULT_WIDTH (still clamped).

export const SIDEBAR_MIN_WIDTH = 24;
export const SIDEBAR_BORDER = 2;
export const DIFF_PANE_MIN_WIDTH = 60;
export const SIDEBAR_RESIZE_STEP = 2;
export const SIDEBAR_DEFAULT_WIDTH = 30;

export function clampSidebarWidth(width: number, terminalWidth: number): number {
  const cap = Math.max(SIDEBAR_MIN_WIDTH, terminalWidth - DIFF_PANE_MIN_WIDTH);
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(cap, width));
}

export function clampSidebarWidthManual(
  width: number,
  terminalWidth: number,
): number {
  const cap = Math.max(SIDEBAR_MIN_WIDTH, terminalWidth - SIDEBAR_MIN_WIDTH);
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(cap, width));
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
