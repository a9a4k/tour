import type { Cursor } from "../core/cursor-state.js";
import type { FlatRow } from "../core/flat-rows.js";
import { cursorRowDomId } from "./row-y-resolver.js";

/**
 * Issue #318: after `[`/`]` resize, annotation cards (markdown blocks)
 * reflow to the new diff-pane width, so any card above the viewport
 * shifts everything below it by its delta. The scrollbox keeps its
 * `scrollTop` (row offset) across the resize but the user's visual
 * position drifts.
 *
 * After the resize, re-anchor the scrollbox to "where the user was
 * looking" by picking a target DOM id and replaying it through the
 * existing culling-safe `scrollChildIntoView` primitive. Priority:
 *
 *   1. Cursor row — `cursorRowDomId` resolves a card / row / interactive
 *      anchor to the same layout-invariant id the cursor-tracking
 *      effect already targets. Brings the cursor back into view if it
 *      drifted off-screen during the reflow.
 *   2. Active file's card — `file-card-${activeFile}` is the id the
 *      sticky FileHeader (issue #307) is keyed on. No cursor +
 *      mid-file scroll: keeps the user inside the same file even
 *      though row counts above shifted.
 *   3. null — neither cursor nor active file. Caller no-ops.
 *
 * Pure / dependency-injected so a unit test can pin the priority order
 * without spinning up OpenTUI.
 */
export function resizeReanchorTargetId(args: {
  cursor: Cursor | null;
  flatRows: ReadonlyArray<FlatRow>;
  activeFile: string | null;
}): string | null {
  const { cursor, flatRows, activeFile } = args;
  if (cursor) {
    const id = cursorRowDomId(cursor, flatRows);
    if (id !== null) return id;
  }
  if (activeFile !== null) return `file-card-${activeFile}`;
  return null;
}
