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
 * Replacement for `ScrollBoxRenderable.scrollChildIntoView` that is
 * safe under `viewportCulling={true}` — refreshes the target's
 * ancestor chain before applying opentui's `block:"nearest"` math.
 *
 * Returns true if a scroll occurred.
 */
export function scrollChildIntoView(sb: ScrollBoxRenderable, childId: string): boolean {
  const target = sb.content.findDescendantById(childId);
  if (!target) return false;
  refreshLayoutChain(target, sb.content);

  const childY = target.y;
  const childHeight = target.height;
  const childX = target.x;
  const childWidth = target.width;
  const viewport = sb.viewport;

  const dy = nearestDelta(childY, childY + childHeight, viewport.y, viewport.y + viewport.height);
  const dx = nearestDelta(childX, childX + childWidth, viewport.x, viewport.x + viewport.width);
  if (dx === 0 && dy === 0) return false;
  sb.scrollBy({ x: dx, y: dy });
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
  const target = sb.content.findDescendantById(childId);
  if (!target) return false;
  refreshLayoutChain(target, sb.content);

  // OpenTUI exposes `target.y` and `viewport.y` in absolute screen
  // coordinates; convert to the content frame `centerScrollTarget`
  // expects: contentY = child.y - viewport.y + scrollTop.
  const contentY = target.y - sb.viewport.y + sb.scrollTop;
  const desired = centerScrollTarget(
    { y: contentY, height: target.height },
    {
      scrollTop: sb.scrollTop,
      height: sb.viewport.height,
      contentHeight: sb.scrollHeight,
    },
  );
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
