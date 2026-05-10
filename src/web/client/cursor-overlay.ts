import type { Cursor } from "../../core/cursor-state.js";
import { queryAllAcrossShadow } from "./dom-walk.js";

/**
 * Mark the DOM cell that the line cursor is anchored on with
 * `data-tour-cursor="true"` and `data-tour-cursor-side="additions" |
 * "deletions"`. The cursor-outline CSS rule keys off these attributes so
 * Pierre's per-file shadow root is the natural scope (same scope its own
 * `[data-line]` selectors live in) without DOM-walking the shadow tree at
 * paint time.
 *
 * The setter walks every `[data-file]` block under `root` (descending
 * across shadow boundaries) and:
 *   1. Strips `data-tour-cursor` / `data-tour-cursor-side` from any cell
 *      that previously carried them — covers the common "cursor moved
 *      from cell A to cell B" case.
 *   2. If `cursor` is non-null, finds the file's matching cell on the
 *      cursor's side at the cursor's line number and sets the attributes.
 *
 * Returns a cleanup function that strips the attributes — call it on
 * effect teardown so a remount doesn't leave orphan attributes on the
 * previous render's DOM.
 *
 * Idempotent — calling with the same `(root, cursor)` pair twice produces
 * the same DOM state.
 */
export function syncCursorOverlay(
  root: ParentNode,
  cursor: Cursor | null,
): () => void {
  clearOverlay(root);
  const cleanup = (): void => clearOverlay(root);
  if (!cursor) return cleanup;
  const block = findFileBlock(root, cursor.file);
  if (!block) return cleanup;
  const cell = findCursorCell(block, cursor);
  if (!cell) return cleanup;
  cell.setAttribute("data-tour-cursor", "true");
  cell.setAttribute("data-tour-cursor-side", cursor.side);
  return cleanup;
}

function clearOverlay(root: ParentNode): void {
  for (const el of queryAllAcrossShadow(root, "[data-tour-cursor]")) {
    el.removeAttribute("data-tour-cursor");
    el.removeAttribute("data-tour-cursor-side");
  }
}

function findFileBlock(root: ParentNode, file: string): Element | null {
  for (const block of queryAllAcrossShadow(root, "[data-file]")) {
    if ((block as HTMLElement).dataset.file === file) return block;
  }
  return null;
}

function findCursorCell(block: ParentNode, cursor: Cursor): Element | null {
  // Active-side type filter: the outline must paint on the column the
  // cursor's side selects (split layout's two paired cells share a line
  // number; we want the addition-side or deletion-side cell, not both).
  // Context rows are annotatable on both sides per ADR 0012 and accept
  // either cursor side.
  const types =
    cursor.side === "additions"
      ? new Set(["addition", "change-addition", "context"])
      : new Set(["deletion", "change-deletion", "context"]);
  for (const cell of queryAllAcrossShadow(block, `[data-line="${cursor.lineNumber}"]`)) {
    const type = (cell as HTMLElement).dataset.lineType;
    if (type && types.has(type)) return cell;
  }
  return null;
}

