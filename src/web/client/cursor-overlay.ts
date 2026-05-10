import type { Cursor } from "../../core/cursor-state.js";
import { queryAllAcrossShadow, shadowRootsDeep } from "./dom-walk.js";

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
 *   3. Installs a MutationObserver on every shadow root inside the
 *      cursor's file block. Pierre re-renders its shadow tree
 *      asynchronously when the syntax-highlight worker returns tokens —
 *      that re-render replaces the cell DOM node, dropping our
 *      attribute. The observer re-applies the attribute on the
 *      successor cell so the outline survives across worker-driven
 *      re-renders.
 *
 * Performance: the previous implementation walked every file's shadow
 * subtree to clear attributes and to find the file block. Now the file
 * block is found via a direct light-DOM `[data-file="..."]` selector
 * (data-file is owned by Tour's own light-DOM wrapper, not Pierre's
 * shadow), so we never enumerate other files' content.
 *
 * Returns a cleanup function that strips the attributes and disconnects
 * the observer — call it on effect teardown so a remount doesn't leave
 * orphan attributes or live observers on the previous render's DOM.
 *
 * Idempotent — calling with the same `(root, cursor)` pair twice produces
 * the same DOM state.
 */
export function syncCursorOverlay(
  root: ParentNode,
  cursor: Cursor | null,
): () => void {
  clearOverlayEverywhere(root);
  if (!cursor) return () => clearOverlayEverywhere(root);

  const block = findFileBlock(root, cursor.file);
  if (!block) return () => clearOverlayEverywhere(root);

  applyCursorAttrs(block, cursor, true /* scroll on first apply */);

  // Re-apply on Pierre's shadow-root mutations. Pierre's worker pool
  // delivers highlighted tokens after a re-render boundary; when those
  // tokens arrive Pierre swaps the cell DOM and our attribute disappears
  // with the discarded node. The observer notices the swap and re-marks
  // the successor. `applyCursorAttrs(scroll=false)` because we don't
  // want a re-highlight to scroll the user back to the cursor — the
  // intent of `block:nearest` is to follow the cursor's keyboard moves,
  // not to fight ambient re-renders.
  const observers: MutationObserver[] = [];
  const observe = (target: Node): void => {
    const observer = new MutationObserver(() => {
      if (block.isConnected === false) return;
      applyCursorAttrs(block, cursor, false);
    });
    observer.observe(target, { childList: true, subtree: true });
    observers.push(observer);
  };
  // MutationObservers don't cross shadow boundaries — observe each one
  // reachable from the block. Pierre attaches one per file plus inner
  // shadows for hunks, so `shadowRootsDeep` is the right reach.
  for (const sr of shadowRootsDeep(block)) observe(sr);

  return (): void => {
    for (const o of observers) o.disconnect();
    clearOverlayEverywhere(root);
  };
}

function applyCursorAttrs(block: Element, cursor: Cursor, scroll: boolean): void {
  const cell = findCursorCell(block, cursor);
  if (!cell) return;
  // No-op if the right cell already carries the right attrs. Cheap guard
  // so the MutationObserver doesn't churn during unrelated mutations
  // (Pierre's tokens swap inside the cell, attribute on the cell itself
  // survives) — without this we'd setAttribute on every keystroke into
  // the composer if it shared a shadow root, etc.
  if (
    cell.getAttribute("data-tour-cursor") === "true" &&
    cell.getAttribute("data-tour-cursor-side") === cursor.side
  ) {
    return;
  }
  // Strip any stale mark on a different cell in the same block before
  // setting the new one. Covers the case where Pierre re-rendered and
  // both the old marked cell AND a new candidate cell briefly coexist
  // (the old one will be removed by Pierre, but until then it confuses
  // the CSS rule).
  for (const stale of queryAllAcrossShadow(block, "[data-tour-cursor]")) {
    if (stale !== cell) {
      stale.removeAttribute("data-tour-cursor");
      stale.removeAttribute("data-tour-cursor-side");
    }
  }
  cell.setAttribute("data-tour-cursor", "true");
  cell.setAttribute("data-tour-cursor-side", cursor.side);
  if (scroll) cell.scrollIntoView({ block: "nearest" });
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
