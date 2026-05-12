import type { Cursor } from "./cursor-state.js";
import { cursorFromRow, moveCursor, preferredSideOf, resolveCursorRowIdx } from "./cursor-state.js";
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
 * Page-motion: pane scrolls by `step` AND the cursor moves with it so its
 * screen-relative offset is preserved (PRD #126 / issue #129; PRD #138 /
 * issue #139 added the `step` parameter). `step: "full"` advances by one
 * full viewport (hardware PageUp / PageDown); `step: "half"` advances by
 * half a viewport, clamped to a 1-row minimum so 1-row terminals still
 * move (Space / `b` / Shift+Space). Doc-fits-viewport is a no-op. When
 * the pane bumps a document bound (no full step of room left), the
 * cursor snaps to the last/first cursor-eligible row instead of stranding
 * mid-pane.
 *
 * The cursor lands on the cursor-eligible row in `flatRows` whose `rowY` is
 * nearest to the screen-y-preserving target — not every screen position
 * has an eligible row (file cards / annotation cards consume vertical
 * space without contributing flatRows entries), so the snap may differ
 * from the precise target by ±1 row.
 */
export function pageMove(
  state: PaneState,
  direction: "up" | "down",
  step: "half" | "full",
): MotionResult {
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
  const stepSize =
    step === "full"
      ? state.viewportHeight
      : Math.max(1, Math.floor(state.viewportHeight / 2));
  const sign = direction === "down" ? 1 : -1;
  const desiredScrollTop = state.scrollTop + sign * stepSize;
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
  const next = cursorFromRow(state.flatRows[snapIdx], preferredSideOf(state.cursor));
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

/**
 * Home / End: snap the cursor to the first / last cursor-eligible row in
 * `flatRows` (PRD #126 / issue #130) and scroll the pane so the cursor
 * lands at the `scrolloff`-row top / bottom margin (matching `step()`'s
 * edge-margin invariant). Folded files contribute zero entries to
 * flatRows, so the snap automatically lands on the first / last *visible*
 * file's bound row.
 *
 * No-op when flatRows is empty (all folded, empty Tour, snapshot lost).
 * No-op when the cursor is already at the target row AND scrollTop is
 * already at the desired position (reference equality preserved so the
 * caller can short-circuit re-renders).
 */
export function jump(
  state: PaneState,
  target: "home" | "end",
  scrolloff = 3,
): MotionResult {
  if (state.flatRows.length === 0) {
    return { cursor: state.cursor, scrollTop: state.scrollTop };
  }
  const targetIdx = target === "home" ? 0 : state.flatRows.length - 1;
  const targetRow = state.flatRows[targetIdx];

  const y = state.rowY(targetIdx);
  const maxScrollTop = Math.max(0, state.contentHeight - state.viewportHeight);
  // Home: cursor csy = scrolloff (3 rows above). End: cursor csy =
  // viewportHeight - scrolloff - 1 (3 rows below). Clamped at doc bounds.
  const desiredScrollTop =
    target === "home" ? y - scrolloff : y - state.viewportHeight + scrolloff + 1;
  const newScrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));

  const currentIdx = resolveCursorRowIdx(state.cursor, state.flatRows);
  if (currentIdx === targetIdx && newScrollTop === state.scrollTop) {
    return { cursor: state.cursor, scrollTop: state.scrollTop };
  }

  // CardAnchor now carries preferredSide (ADR 0023 / issue #200) so the
  // cursor-bearing branch collapses to preferredSideOf(state.cursor);
  // the null-cursor branch still derives from the target row's natural
  // side when it's a diff row (Home/End from null cursor).
  const preferredSide: "additions" | "deletions" =
    state.cursor
      ? state.cursor.preferredSide
      : targetRow.kind === "diff"
        ? targetRow.side
        : "additions";
  const next = cursorFromRow(targetRow, preferredSide);
  return { cursor: next, scrollTop: newScrollTop };
}
