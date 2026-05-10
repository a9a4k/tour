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
 * The setter:
 *   1. Strips `data-tour-cursor` / `data-tour-cursor-side` from any cell
 *      that previously carried them — covers the common "cursor moved
 *      from cell A to cell B" case.
 *   2. If `cursor` is non-null, finds the cursor's file's matching cell
 *      on the cursor's side at the cursor's line number and sets the
 *      attributes.
 *
 * Performance: the previous implementation walked every file's shadow
 * subtree to clear attributes and to find the file block. Now the file
 * block is found via a direct light-DOM `[data-file="..."]` selector
 * (data-file is owned by Tour's own light-DOM wrapper, not Pierre's
 * shadow), so we never enumerate other files' content. The cleanup
 * walks only the previously-tagged cell via a stored reference.
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
  // Defensive: if a previous remount left attributes behind on cells we
  // don't track via state, sweep them. This is the only walker that
  // crosses every shadow root, and only because we may not have a
  // per-cell reference after a remount.
  clearOverlayEverywhere(root);
  const cleanup = (): void => clearOverlayEverywhere(root);
  if (!cursor) return cleanup;
  const block = findFileBlock(root, cursor.file);
  if (!block) return cleanup;
  const cell = findCursorCell(block, cursor);
  if (!cell) return cleanup;
  cell.setAttribute("data-tour-cursor", "true");
  cell.setAttribute("data-tour-cursor-side", cursor.side);
  // block:"nearest" — already-visible rows don't jump; off-screen rows
  // pull into view at the closest edge. Mirrors the sidebar follow effect.
  cell.scrollIntoView({ block: "nearest" });
  return cleanup;
}

function clearOverlayEverywhere(root: ParentNode): void {
  for (const el of queryAllAcrossShadow(root, "[data-tour-cursor]")) {
    el.removeAttribute("data-tour-cursor");
    el.removeAttribute("data-tour-cursor-side");
  }
}

function findFileBlock(root: ParentNode, file: string): Element | null {
  // `data-file` lives on Tour's own light-DOM wrapper (App.tsx FileBlock),
  // not inside Pierre's shadow root, so a single light-tree query suffices.
  const escaped = cssEscape(file);
  if (root instanceof Document || root instanceof Element || root instanceof DocumentFragment) {
    return root.querySelector(`[data-file="${escaped}"]`);
  }
  return null;
}

function cssEscape(value: string): string {
  // Use the platform's CSS.escape when available; fall back to a minimal
  // escaper for the few characters that legitimately appear in file
  // paths (`"` is unlikely but cheap to handle).
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, (c) => `\\${c}`);
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
  // Pierre's split layout renders deletions and additions in two sibling
  // <code> blocks under the file's shadow root, so the same `data-line`
  // value can appear on both columns. The type filter alone can't tell
  // paired context cells apart (both are "context"), so we additionally
  // prefer the cell whose ancestor matches the cursor's column. Cells
  // without a column ancestor (unified layout) fall back to the first
  // type-matching cell.
  const columnSelector = cursor.side === "additions" ? "[data-additions]" : "[data-deletions]";
  let fallback: Element | null = null;
  for (const cell of queryAllAcrossShadow(block, `[data-line="${cursor.lineNumber}"]`)) {
    const type = (cell as HTMLElement).dataset.lineType;
    if (!type || !types.has(type)) continue;
    if (cell.closest(columnSelector)) return cell;
    fallback ??= cell;
  }
  return fallback;
}
