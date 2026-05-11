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

  // Latch: schedule the placement-scroll IO exactly once per
  // `syncCursorOverlay` call. Pierre's worker swaps cell DOM after the
  // first paint and the MutationObserver below re-runs `apply` to
  // re-mark the successor cell — that re-mark must NOT trigger another
  // scroll, otherwise Pierre's async re-renders feel like the cursor
  // is dragging the page around.
  let placementScrollScheduled = false;
  const apply = (): void => {
    const cell = findCursorCell(block, cursor);
    if (!cell) return;
    const alreadyMarked =
      cell.getAttribute("data-tour-cursor") === "true" &&
      cell.getAttribute("data-tour-cursor-side") === cursor.side;
    if (!alreadyMarked) {
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
    }
    if (!placementScrollScheduled) {
      placementScrollScheduled = true;
      schedulePlacementScroll(cell);
    }
  };

  apply();

  // Re-apply on Pierre's shadow-root mutations. Pierre's worker pool
  // delivers highlighted tokens after a re-render boundary; when those
  // tokens arrive Pierre swaps the cell DOM and our attribute disappears
  // with the discarded node. The observer notices the swap and re-marks
  // the successor — without re-scheduling the placement scroll.
  const observers: MutationObserver[] = [];
  const observe = (target: Node): void => {
    const observer = new MutationObserver(() => {
      if (block.isConnected === false) return;
      apply();
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
    disconnectPendingPlacement();
    clearOverlayEverywhere(root);
  };
}

// One-shot placement-scroll observer. The cursor placement check is
// deferred off the synchronous hot path (a profile on a large diff
// showed `scrollIntoView` + `getBoundingClientRect` accounting for
// ~26% of main-thread time on every `j`/`k` — ~200 ms per call from
// forced layout). The IO computes intersection asynchronously after
// the layout the browser was going to do anyway; if the just-placed
// cursor cell is offscreen the callback fires one `scrollIntoView`
// and then disconnects.
//
// Why one-shot and NOT a persistent watcher: a persistent IO would
// snap the page back to the cursor on every user-initiated scroll
// (sidebar file click, wheel, PgDn, scrollbar drag) — fighting the
// user instead of helping. The observer's purpose is "scroll the
// just-placed cursor into view once," not "leash the viewport to
// the cursor forever." Subsequent cursor moves re-engage by way of
// `syncCursorOverlay` running again.
let pendingPlacementIO: IntersectionObserver | null = null;

function disconnectPendingPlacement(): void {
  pendingPlacementIO?.disconnect();
  pendingPlacementIO = null;
}

function schedulePlacementScroll(cell: Element): void {
  if (typeof IntersectionObserver === "undefined") return;
  disconnectPendingPlacement();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          (entry.target as Element).scrollIntoView({ block: "nearest" });
        }
      }
      // One-shot: disconnect after the first delivery (which carries the
      // initial intersection state for the observed cell).
      if (pendingPlacementIO === io) disconnectPendingPlacement();
      else io.disconnect();
    },
    // threshold 0 means "any part visible counts as intersecting". Matches
    // `scrollIntoView({ block: "nearest" })`'s own no-op condition.
    { root: null, threshold: 0 },
  );
  pendingPlacementIO = io;
  io.observe(cell);
}

/**
 * Synchronous scroll-into-view fallback for environments without
 * `IntersectionObserver` (e.g., older browsers, some test runners). In
 * a working browser this is a no-op — `syncCursorOverlay`'s one-shot
 * IO handles placement scroll without the synchronous layout flush.
 * Kept as a back-compat call from the keyboard handler so the fallback
 * path still scrolls on first interaction even without IO.
 */
export function scrollCursorIntoView(root: ParentNode, cursor: Cursor | null): void {
  if (typeof IntersectionObserver !== "undefined") return; // IO path handles it.
  if (!cursor) return;
  const block = findFileBlock(root, cursor.file);
  if (!block) return;
  const cell = findCursorCell(block, cursor);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (rect.top >= 0 && rect.bottom <= viewportHeight) return;
  cell.scrollIntoView({ block: "nearest" });
}

function clearOverlayEverywhere(root: ParentNode): void {
  disconnectPendingPlacement();
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
  // Interactive cursors (gap-row family — PRD #151 / ADR 0018, ADR 0013)
  // resolve against the Tour-injected `[data-tour-interactive]` overlay
  // node by `(subKind, boundaryRef)`. The outline spans the whole row
  // (sideless), which the cursor-css rule already handles via the
  // attribute selector — no side filter applies here.
  if (cursor.interactive) {
    const { subKind, boundaryRef } = cursor.interactive;
    let dataSubkind: string | null = null;
    let hunkIndexFilter: string | null = null;
    if (subKind === "boundary-top") {
      dataSubkind = "hunk-header";
      hunkIndexFilter = "0";
    } else if (subKind === "hunk-separator" && typeof boundaryRef === "number") {
      dataSubkind = "hunk-header";
      hunkIndexFilter = String(boundaryRef);
    } else if (subKind === "gap-mid-top" && typeof boundaryRef === "number") {
      dataSubkind = "gap-mid-top";
      hunkIndexFilter = String(boundaryRef);
    } else if (subKind === "boundary-bottom") {
      dataSubkind = "boundary-bottom";
    }
    if (dataSubkind === null) return null;
    const selector =
      `[data-tour-interactive="gap-row"][data-subkind="${dataSubkind}"]` +
      (hunkIndexFilter !== null ? `[data-hunk-index="${hunkIndexFilter}"]` : "");
    for (const node of queryAllAcrossShadow(block, selector)) {
      return node;
    }
    return null;
  }
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
