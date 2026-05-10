import type { ScrollBoxRenderable } from "@opentui/core";

/**
 * Replacement for `ScrollBoxRenderable.scrollChildIntoView` that is
 * safe under `viewportCulling={true}`.
 *
 * Why: under culling, opentui's render loop only cascades
 * `updateLayout` (which calls `updateFromLayout` internally) into the
 * direct children of `ContentRenderable` that are visible. Descendants
 * inside a culled (off-screen) child keep last-frame `_y` / `_height`
 * values until that subtree becomes visible again. Yoga itself has
 * fresh positions for every node every frame — `updateFromLayout`
 * exists precisely to mirror Yoga's positions into JS state, and it is
 * per-frame guarded so calling it again on already-fresh nodes is a
 * cheap no-op.
 *
 * This helper walks the target's ancestor chain bottom-up to the
 * scrollbox content and forces a JS-side refresh per node, then
 * applies the same `block:"nearest"` math opentui uses, scrolling the
 * box only when the child is actually outside the viewport.
 *
 * Returns true if a scroll occurred.
 */
export function scrollChildIntoView(sb: ScrollBoxRenderable, childId: string): boolean {
  const target = sb.content.findDescendantById(childId);
  if (!target) return false;

  // Walk up to (but not past) sb.content, collecting the chain. Refresh
  // top-down: each node's `_y` reads independently from Yoga but the
  // public `y` getter recurses through `parent.y`, so we want every
  // ancestor refreshed before the leaf reads its position.
  const chain: Array<{ updateFromLayout?: () => void }> = [];
  let cur: (typeof target & { parent?: typeof target | null }) | null = target;
  const content = sb.content as unknown as { num?: unknown };
  while (cur && (cur as unknown) !== (content as unknown)) {
    chain.push(cur);
    cur = (cur as typeof target & { parent?: typeof target | null }).parent ?? null;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateFromLayout?.();
  }

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
