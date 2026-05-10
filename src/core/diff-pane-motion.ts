import type { Cursor } from "./cursor-state.js";
import { moveCursor, resolveCursorRowIdx } from "./cursor-state.js";
import type { FlatRow } from "./flat-rows.js";

/**
 * Diff-pane motion contract (ADR 0011 — Diff-pane motion contract). The
 * cursor floats in the document; the pane is a passive follower that scrolls
 * one row at a time iff the cursor would otherwise cross a `scrolloff`-row
 * edge margin (vim default = 3). This module owns the pure motion logic;
 * `tui/app.tsx` wires the result into setCursor + scrollTo.
 *
 * `rowY` is injected so the module stays surface-agnostic — tests pass a
 * synthetic `(idx) => idx` (cursor-eligible rows are 1-line tall per Tour's
 * row planner); runtime resolves it via OpenTUI's `child.y` query on the
 * scrollbox content tree.
 *
 * Off-viewport cursors (after a wheel-scroll) are NOT handled here: step()
 * computes scrollTop assuming the current cursor is in the viewport. The
 * fallback `[cursor, layout]` useEffect in app.tsx applies `block:nearest`
 * via `scrollChildIntoView`, which dominates when the cursor is off-screen
 * and is a no-op when it is already visible.
 */
export interface PaneState {
  cursor: Cursor | null;
  flatRows: FlatRow[];
  scrollTop: number;
  viewportHeight: number;
  rowY: (rowIdx: number) => number;
}

export interface MotionResult {
  cursor: Cursor | null;
  scrollTop: number;
}

export function step(
  state: PaneState,
  direction: "up" | "down",
  scrolloff = 3,
): MotionResult {
  if (!state.cursor) {
    return { cursor: null, scrollTop: state.scrollTop };
  }
  const next = moveCursor(state.cursor, direction, state.flatRows);
  if (next === state.cursor || next === null) {
    return { cursor: state.cursor, scrollTop: state.scrollTop };
  }
  const nextIdx = resolveCursorRowIdx(next, state.flatRows);
  if (nextIdx === -1) {
    return { cursor: next, scrollTop: state.scrollTop };
  }
  const nextY = state.rowY(nextIdx);
  let scrollTop = state.scrollTop;
  if (direction === "down") {
    if (nextY - scrollTop >= state.viewportHeight - scrolloff) {
      scrollTop += 1;
    }
  } else {
    if (nextY - scrollTop < scrolloff) {
      scrollTop -= 1;
    }
  }
  if (scrollTop < 0) scrollTop = 0;
  return { cursor: next, scrollTop };
}
