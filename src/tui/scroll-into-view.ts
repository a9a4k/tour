import type { ScrollBoxRenderable } from "@opentui/core";
import {
  center as centerScrollTarget,
  preserveScreenY,
} from "../core/scroll-target.js";

/**
 * Walk `target`'s ancestor chain up to (but not past) `contentRoot`,
 * calling `updateFromLayout()` top-down. Under
 * `viewportCulling={true}`, opentui's render loop only cascades
 * `updateFromLayout` into the direct children of `ContentRenderable`,
 * so descendants inside a culled subtree keep last-frame `_y` /
 * `_height` values until that subtree becomes visible again. Yoga
 * itself has fresh positions for every node every frame —
 * `updateFromLayout` mirrors those into JS state, and it is per-frame
 * guarded so re-calling it on already-fresh nodes is a cheap no-op.
 *
 * Top-down because the public `y` getter recurses through `parent.y`;
 * every ancestor must be fresh before the leaf reads its position.
 */
function refreshLayoutChain(target: unknown, contentRoot: unknown): void {
  const chain: Array<{ updateFromLayout?: () => void }> = [];
  let cur: unknown = target;
  while (cur && cur !== contentRoot) {
    chain.push(cur as { updateFromLayout?: () => void });
    cur = (cur as { parent?: unknown }).parent ?? null;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateFromLayout?.();
  }
}

/**
 * Compute the {dx, dy} scroll delta that brings child `childId` into
 * the scrollbox's viewport with `block:"nearest"` semantics. Returns
 * `null` when the descendant is missing. Refreshes the ancestor chain
 * top-down before reading positions so culled subtrees report fresh
 * Yoga values.
 *
 * Shared by `scrollChildIntoView` (instant) and
 * `animatedScrollChildIntoView` (tweened) so both paths compute the
 * same target.
 */
export function computeScrollChildIntoViewDelta(
  sb: ScrollBoxRenderable,
  childId: string,
): { dx: number; dy: number } | null {
  const target = sb.content.findDescendantById(childId);
  if (!target) return null;
  refreshLayoutChain(target, sb.content);

  const childY = target.y;
  const childHeight = target.height;
  const childX = target.x;
  const childWidth = target.width;
  const viewport = sb.viewport;

  const dy = nearestDelta(childY, childY + childHeight, viewport.y, viewport.y + viewport.height);
  const dx = nearestDelta(childX, childX + childWidth, viewport.x, viewport.x + viewport.width);
  return { dx, dy };
}

/**
 * Compute the absolute `scrollTop` that centers child `childId` in the
 * scrollbox's viewport. Returns `null` when the descendant is missing.
 * Refreshes the ancestor chain top-down before reading positions.
 *
 * Shared by `centerChildInView` (instant) and `animatedCenterChildInView`
 * (tweened).
 */
export function computeCenterChildScrollTop(
  sb: ScrollBoxRenderable,
  childId: string,
): number | null {
  const target = sb.content.findDescendantById(childId);
  if (!target) return null;
  refreshLayoutChain(target, sb.content);

  // OpenTUI exposes `target.y` and `viewport.y` in absolute screen
  // coordinates; convert to the content frame `centerScrollTarget`
  // expects: contentY = child.y - viewport.y + scrollTop.
  const contentY = target.y - sb.viewport.y + sb.scrollTop;
  return centerScrollTarget(
    { y: contentY, height: target.height },
    {
      scrollTop: sb.scrollTop,
      height: sb.viewport.height,
      contentHeight: sb.scrollHeight,
    },
  );
}

/**
 * Pixel-position probe for the footer-hint "is the card in view" check
 * (issue #302). Resolves the child's rendered Y range and intersects
 * it with the scrollbox's viewport rect. Returns:
 *
 *   `"in"`    — the child's box intersects the viewport rect (including
 *               partial overlap at either edge).
 *   `"above"` — the child's bottom is at or above the viewport top.
 *   `"below"` — the child's top is at or below the viewport bottom.
 *   `null`    — the descendant isn't in the tree (pre-mount, or under
 *               viewport culling the subtree is detached). The caller
 *               should omit any direction-hint suffix in that case.
 *
 * Uses the same `refreshLayoutChain` path as the scroll-into-view
 * helpers, so it's safe under `viewportCulling={true}`.
 */
export function computeCardViewportPosition(
  sb: ScrollBoxRenderable,
  childId: string,
): "in" | "above" | "below" | null {
  const target = sb.content.findDescendantById(childId);
  if (!target) return null;
  refreshLayoutChain(target, sb.content);
  const childTop = target.y;
  const childBottom = target.y + target.height;
  const viewportTop = sb.viewport.y;
  const viewportBottom = sb.viewport.y + sb.viewport.height;
  if (childBottom <= viewportTop) return "above";
  if (childTop >= viewportBottom) return "below";
  return "in";
}

/**
 * Replacement for `ScrollBoxRenderable.scrollChildIntoView` that is
 * safe under `viewportCulling={true}` — refreshes the target's
 * ancestor chain before applying opentui's `block:"nearest"` math.
 *
 * Returns true if a scroll occurred.
 */
export function scrollChildIntoView(sb: ScrollBoxRenderable, childId: string): boolean {
  const delta = computeScrollChildIntoViewDelta(sb, childId);
  if (!delta) return false;
  if (delta.dx === 0 && delta.dy === 0) return false;
  sb.scrollBy({ x: delta.dx, y: delta.dy });
  return true;
}

/**
 * Centre the child of id `childId` in the scrollbox's viewport. Under
 * `viewportCulling={true}` the descendant's JS-side `_y` / `_height`
 * may be stale; the chain refresh syncs them from Yoga before the
 * centering math runs. Oversized children (taller than the viewport)
 * fall back to start-alignment via `centerScrollTarget` so the title
 * row lands at the top.
 *
 * Returns true if a scroll occurred.
 */
export function centerChildInView(sb: ScrollBoxRenderable, childId: string): boolean {
  const desired = computeCenterChildScrollTop(sb, childId);
  if (desired === null) return false;
  if (desired === sb.scrollTop) return false;
  sb.scrollTo(desired);
  return true;
}

/**
 * Pre-reflow snapshot of a child's position used by
 * {@link applyPreserveScreenY}. Captured before a content reflow (e.g.
 * the `shift+L` layout toggle, PRD / issue #303); replayed after the
 * reflow to pick a scrollTop that pins the child at the same on-screen
 * y-coordinate.
 */
export interface ScreenYSnapshot {
  /** Child's content-y at snapshot time (`target.y - viewport.y + scrollTop`). */
  contentY: number;
  /** Child's height at snapshot time. */
  height: number;
  /** Scrollbox's scrollTop at snapshot time. */
  scrollTop: number;
}

/**
 * Read `childId`'s pre-reflow content-y, height, and the scrollbox's
 * scrollTop. Refreshes the ancestor chain so the read is fresh under
 * `viewportCulling={true}`. Returns `null` when the descendant is missing
 * (caller should skip preserve and use a fallback).
 */
export function captureScreenYSnapshot(
  sb: ScrollBoxRenderable,
  childId: string,
): ScreenYSnapshot | null {
  const target = sb.content.findDescendantById(childId);
  if (!target) return null;
  refreshLayoutChain(target, sb.content);
  return {
    contentY: target.y - sb.viewport.y + sb.scrollTop,
    height: target.height,
    scrollTop: sb.scrollTop,
  };
}

/**
 * Apply a {@link ScreenYSnapshot} to `sb` after a content reflow: scrolls
 * so `childId` (same DOM id, post-reflow) sits at the same screen-y as it
 * occupied at capture time. Falls back to `center(newChild, viewport)`
 * when the preserved scrollTop would push the row outside the viewport
 * (the reflow shrank / grew the content past a document bound).
 *
 * Returns `true` when a scrollTo was issued, `false` when the row isn't
 * in the post-reflow tree (caller should run a `scrollIntoView`-style
 * fallback).
 */
export function applyPreserveScreenY(
  sb: ScrollBoxRenderable,
  childId: string,
  snap: ScreenYSnapshot,
): boolean {
  const target = sb.content.findDescendantById(childId);
  if (!target) return false;
  refreshLayoutChain(target, sb.content);
  const newContentY = target.y - sb.viewport.y + sb.scrollTop;
  const desired = preserveScreenY(
    { y: snap.contentY, height: snap.height },
    { y: newContentY, height: target.height },
    snap.scrollTop,
    {
      scrollTop: sb.scrollTop,
      height: sb.viewport.height,
      contentHeight: sb.scrollHeight,
    },
  );
  sb.scrollTo(desired);
  return true;
}

/**
 * Mirror of opentui's internal `getNearestDelta`: returns the smallest
 * scroll delta that brings `[es, ee]` inside `[vs, ve]`, matching
 * `scrollIntoView({ block: "nearest" })` semantics. Already-inside
 * elements return 0.
 */
function nearestDelta(es: number, ee: number, vs: number, ve: number): number {
  const elementSize = ee - es;
  const viewportSize = ve - vs;
  const startOutside = es < vs;
  const endOutside = ee > ve;
  if (startOutside && endOutside) return 0;
  // `<=` (not `<`) handles the equal-size case: when the element is
  // exactly the height of the viewport AND sits entirely outside (top
  // above viewport, or bottom below viewport), nearestDelta must still
  // return a non-zero scroll delta — otherwise an n/p jump to a card
  // whose card-height matches viewport-height becomes a silent no-op.
  // Both deltas (`es - vs` and `ee - ve`) are equal in the equality
  // case, so either branch is correct; the placement of `<=` is purely
  // to make a branch match.
  if ((startOutside && elementSize <= viewportSize) || (endOutside && elementSize > viewportSize)) {
    return es - vs;
  }
  if ((startOutside && elementSize > viewportSize) || (endOutside && elementSize <= viewportSize)) {
    return ee - ve;
  }
  return 0;
}
