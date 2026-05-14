import type { ScrollBoxRenderable } from "@opentui/core";
import type { FlatRow } from "../core/flat-rows.js";
import type { Cursor } from "../core/cursor-state.js";
import { resolveCursorRowIdx } from "../core/cursor-state.js";

export function flatRowId(r: FlatRow): string {
  if (r.kind === "card") return `annotation-${r.annotationId}`;
  return r.kind === "diff"
    ? `diff-row-${r.file}-${r.side}-${r.lineNumber}`
    : `interactive-row-${r.file}-${r.subKind}-${r.boundaryRef}`;
}

/**
 * Layout-invariant DOM id for the cursor's row. Resolves the cursor anchor
 * against `flatRows` and projects via {@link flatRowId} — so a paired
 * context row addressed by either side returns the same id (the flat row's
 * canonical additions-side id), whereas the raw
 * `diff-row-${cursor.file}-${cursor.side}-${cursor.lineNumber}` would
 * sometimes miss the unified row when the cursor sits on the deletion side.
 *
 * The preserve-screen-y path on layout toggle relies on this invariance:
 * `sb.content.findDescendantById(cursorRowDomId(cursor, oldFlatRows))`
 * resolves to the row in BOTH split and unified, so the pre/post snapshot
 * can read positions through the same id. Returns `null` when the cursor
 * doesn't resolve in `flatRows`.
 */
export function cursorRowDomId(
  cursor: Cursor,
  flatRows: ReadonlyArray<FlatRow>,
): string | null {
  if (cursor.kind === "card") return `annotation-${cursor.annotationId}`;
  const idx = resolveCursorRowIdx(cursor, flatRows);
  if (idx === -1) return null;
  return flatRowId(flatRows[idx]);
}

/**
 * Build a `(rowIdx) => contentY` resolver for `flatRows` in a single pass
 * over the scrollbox's renderable tree.
 *
 * **Coordinate contract.** Opentui's `child.y` is screen-absolute (the
 * same space as `viewport.y`; see ScrollBox.scrollChildIntoView in
 * opentui/packages/core/src/renderables/ScrollBox.ts). The formulas in
 * `core/diff-pane-motion.ts` (`step`, `pageMove`, `jump`) all expect
 * content-y, so that `rowY - scrollTop` yields the row's screen offset
 * from the top of the viewport. This resolver translates by computing
 * `screenY - viewport.y + scrollTop`. Returning raw screen-y would
 * break `step("up")`'s scrolloff condition once the user has scrolled
 * (`nextY - scrollTop` becomes trivially negative), firing the edge-
 * margin scroll on every Arrow Up / `k`.
 *
 * **Layout refresh.** Each visited node has `updateFromLayout()` called
 * on it. Under `viewportCulling={true}` opentui only cascades that
 * refresh into the direct children of `ContentRenderable` (file-cards),
 * so descendants inside a culled file would otherwise carry stale `_y`
 * from the last frame the file was visible. The call is per-frame
 * guarded inside opentui, so visiting an already-fresh node is
 * essentially free. The DFS visits parents before children, so by the
 * time we read a row's `.y` (which recurses through `parent.y`) every
 * ancestor is fresh.
 */
export function buildRowYResolver(
  sb: ScrollBoxRenderable,
  flatRows: FlatRow[],
): (idx: number) => number {
  const viewportY = sb.viewport.y;
  const scrollTop = sb.scrollTop;
  const idAtIdx: string[] = new Array(flatRows.length);
  const targets = new Set<string>();
  for (let i = 0; i < flatRows.length; i++) {
    const id = flatRowId(flatRows[i]);
    idAtIdx[i] = id;
    targets.add(id);
  }
  const idToY = new Map<string, number>();
  type Node = {
    id?: string;
    y?: number;
    getChildren?: () => unknown[];
    updateFromLayout?: () => void;
  };
  const stack: Node[] = [sb.content as unknown as Node];
  while (stack.length > 0 && idToY.size < targets.size) {
    const node = stack.pop()!;
    node.updateFromLayout?.();
    const id = node.id;
    if (id && targets.has(id)) {
      const screenY = typeof node.y === "number" ? node.y : 0;
      idToY.set(id, screenY - viewportY + scrollTop);
    }
    const kids = node.getChildren?.() ?? [];
    for (const c of kids) stack.push(c as Node);
  }
  return (i: number) => idToY.get(idAtIdx[i]) ?? 0;
}
