import type { ScrollBoxRenderable } from "@opentui/core";
import { center as centerScrollTarget } from "../core/scroll-target.js";

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
  if ((startOutside && elementSize < viewportSize) || (endOutside && elementSize > viewportSize)) {
    return es - vs;
  }
  if ((startOutside && elementSize > viewportSize) || (endOutside && elementSize < viewportSize)) {
    return ee - ve;
  }
  return 0;
}
