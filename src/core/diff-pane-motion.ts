import type { Cursor } from "./cursor-state.js";
import { cursorFromRow, moveCursor, resolveCursorRowIdx } from "./cursor-state.js";
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
  /** Total scrollable content height in the same units as `rowY`. Used by
   *  `pageMove` to clamp scrollTop and detect the doc-fits-viewport
   *  no-op. `step()` ignores this. */
  contentHeight: number;
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

/**
 * Page-motion: pane scrolls by one full viewport AND the cursor moves with
 * it so its screen-relative offset is preserved (PRD #126 / issue #129).
 * Doc-fits-viewport is a no-op. When the pane bumps a document bound (no
 * full viewport of room left), the cursor snaps to the last/first cursor-
 * eligible row instead of stranding mid-pane.
 *
 * The cursor lands on the cursor-eligible row in `flatRows` whose `rowY` is
 * nearest to the screen-y-preserving target — not every screen position
 * has an eligible row (file cards / annotation cards consume vertical
 * space without contributing flatRows entries), so the snap may differ
 * from the precise target by ±1 row.
 */
export function pageMove(state: PaneState, direction: "up" | "down"): MotionResult {
  if (!state.cursor) {
    return { cursor: null, scrollTop: state.scrollTop };
  }
  if (state.contentHeight <= state.viewportHeight) {
    return { cursor: state.cursor, scrollTop: state.scrollTop };
  }
  const oldIdx = resolveCursorRowIdx(state.cursor, state.flatRows);
  if (oldIdx === -1) {
    return { cursor: state.cursor, scrollTop: state.scrollTop };
  }
  const sign = direction === "down" ? 1 : -1;
  const desiredScrollTop = state.scrollTop + sign * state.viewportHeight;
  const maxScrollTop = Math.max(0, state.contentHeight - state.viewportHeight);
  const newScrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));
  let snapIdx: number;
  if (desiredScrollTop !== newScrollTop) {
    // Pane bumped a document bound — cursor lands on the last/first
    // cursor-eligible row to honour "Space at end of doc still moves you".
    snapIdx = direction === "down" ? state.flatRows.length - 1 : 0;
  } else {
    // Preserve screen-relative offset: targetY = newScrollTop + (oldY - oldScrollTop).
    const screenY = state.rowY(oldIdx) - state.scrollTop;
    const targetY = newScrollTop + screenY;
    snapIdx = nearestRowIdx(state.flatRows, state.rowY, targetY);
  }
  const next = cursorFromRow(state.flatRows[snapIdx], state.cursor.preferredSide);
  return { cursor: next, scrollTop: newScrollTop };
}

function nearestRowIdx(
  flatRows: FlatRow[],
  rowY: (idx: number) => number,
  targetY: number,
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < flatRows.length; i++) {
    const d = Math.abs(rowY(i) - targetY);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
