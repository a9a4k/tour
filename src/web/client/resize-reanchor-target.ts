import type { Cursor } from "../../core/cursor-state.js";
import { resolveCursorRowIdx } from "../../core/cursor-state.js";
import type { FlatRow } from "../../core/flat-rows.js";

/**
 * Issue #327 (follow-up to #323): preserveScreenY target priority for
 * sidebar-resize reflow on the web. Mirrors the TUI's
 * `resizeReanchorTargetId` (#318) — same priority, different substrate
 * (HTMLElement vs OpenTUI id).
 *
 * Priority:
 *   1. Cursor — when the cursor exists AND (for row cursors) resolves
 *      in `flatRows`. Card cursors return the descriptor unconditionally
 *      since the runtime `commentRefs` lookup is the cheaper check;
 *      the capture path no-ops when the ref is missing.
 *   2. Active file — `selectedFile` (the value the sidebar's row-
 *      highlight tracks). No cursor, or a stale row cursor pointing at
 *      an unrendered row, falls through here.
 *   3. null — caller no-ops.
 */
export type ResizeReanchorTarget =
  | { kind: "cursor"; cursor: Cursor }
  | { kind: "file"; path: string };

export function resizeReanchorTarget(args: {
  cursor: Cursor | null;
  flatRows: ReadonlyArray<FlatRow>;
  activeFile: string | null;
}): ResizeReanchorTarget | null {
  const { cursor, flatRows, activeFile } = args;
  if (cursor) {
    if (cursor.kind === "card" || resolveCursorRowIdx(cursor, flatRows) !== -1) {
      return { kind: "cursor", cursor };
    }
  }
  if (activeFile !== null) return { kind: "file", path: activeFile };
  return null;
}
