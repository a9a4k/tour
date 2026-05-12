import type { Annotation } from "./types.js";
import type { RowAnchor } from "../../core/cursor-state.js";

/**
 * Compute the next state after pressing `n` (delta = +1) or `p` (delta = -1)
 * in the webapp. Returns the navigation target Annotation and the coupled
 * cursor anchor (β-coupling per ADR 0012; mirrors ADR 0011 / TUI). Returns
 * null when the move is a no-op — no current selection or already at the
 * boundary; the caller leaves both `currentAnnotationId` and the cursor
 * untouched (preserves the lazy-materialization rule when the cursor is null
 * and n/p has no target).
 *
 * The webapp continues to use a synthesized RowAnchor at `line_end` for
 * the cursor (PRD #192 slice-2 will migrate the webapp to a CardAnchor;
 * the TUI is already migrated). preferredSide updates to the target's
 * side so a follow-up j/k follows the column the user was just steered
 * toward.
 *
 * The reverse direction stays decoupled: j/k/h/l/arrow line motion does
 * NOT change `currentAnnotationId` (the asymmetric β-rule).
 */
export function nextAnnotationNavStep(args: {
  topLevel: ReadonlyArray<Annotation>;
  currentIdx: number;
  delta: -1 | 1;
}): { target: Annotation; cursor: RowAnchor } | null {
  if (args.currentIdx === -1) return null;
  const last = args.topLevel.length - 1;
  const newIdx = Math.max(0, Math.min(last, args.currentIdx + args.delta));
  if (newIdx === args.currentIdx) return null;
  const target = args.topLevel[newIdx];
  return {
    target,
    cursor: {
      kind: "row",
      file: target.file,
      lineNumber: target.line_end,
      side: target.side,
      preferredSide: target.side,
    },
  };
}
