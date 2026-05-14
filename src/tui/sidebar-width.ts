import type { DiffFile } from "../core/diff-model.js";
import type { VisibleRow } from "../core/file-tree.js";
import {
  folderRowFixedCost,
  fileRowFixedCost,
  type FileRowStats,
} from "./sidebar-row-label.js";

// Sidebar auto-fit width (issue #312). Three composable knobs let
// deep trees render readable filenames without forcing the user to
// guess a fixed column count:
//
//   * `computeAutoFitWidth(rows, statsFor, terminalWidth)` runs on
//     every tour-id change. Walks the visible rows, takes the widest
//     row's `fixedCost + displayName.length`, adds the box border,
//     and clamps to `[SIDEBAR_MIN_WIDTH, floor(terminalWidth *
//     SIDEBAR_MAX_FRAC)]`.
//
//   * `clampSidebarWidth(width, terminalWidth)` is the same clamp,
//     reused by the `[`/`]` resize keys so manual adjustment can't
//     escape the auto-fit range.
//
//   * `INDENT_PER_DEPTH` in `sidebar-row-label.ts` dropped from 2 to
//     1 — the only knob that helps when the 40% cap binds (narrow
//     terminals + deep trees, e.g. tmux split at 100 cols on a
//     depth-7 monorepo). `[`/`]` cannot push past the cap, so indent
//     is the load-bearing fix for that cohort.
//
// MIN floor wins over the cap when they collide (degenerate narrow-
// terminal case). Empty row lists fall back to
// SIDEBAR_DEFAULT_WIDTH (still clamped).

export const SIDEBAR_MIN_WIDTH = 24;
export const SIDEBAR_BORDER = 2;
export const SIDEBAR_MAX_FRAC = 0.4;
export const SIDEBAR_RESIZE_STEP = 2;
export const SIDEBAR_DEFAULT_WIDTH = 30;

export function clampSidebarWidth(width: number, terminalWidth: number): number {
  const cap = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.floor(terminalWidth * SIDEBAR_MAX_FRAC),
  );
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
