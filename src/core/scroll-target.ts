/**
 * Pure scroll-target math for the missing `block:*` modes that OpenTUI's
 * `ScrollBox.scrollChildIntoView` doesn't ship — its built-in is hardcoded
 * to `block:nearest`. The TUI's annotation-jump effect (`n`/`p`) needs
 * `block:center` so it matches the webapp's existing
 * `scrollIntoView({ block: 'center' })` behaviour (PRDs #126 / #128,
 * ADR 0011).
 *
 * Coordinate system: every input is in *content* coordinates (origin at
 * the top of the scrollable content, y growing downward). The runtime
 * wiring in `tui/app.tsx` translates from OpenTUI's screen-relative
 * `child.y` / `viewport.y` to this content frame; tests use synthetic
 * numbers directly.
 */

export interface ScrollChild {
  y: number;
  height: number;
}

export interface ScrollViewport {
  scrollTop: number;
  height: number;
  contentHeight: number;
}

function maxScrollTop(viewport: ScrollViewport): number {
  return Math.max(0, viewport.contentHeight - viewport.height);
}

function clamp(value: number, viewport: ScrollViewport): number {
  const max = maxScrollTop(viewport);
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/** Align the child's top edge with the viewport's top edge. */
export function start(child: ScrollChild, viewport: ScrollViewport): number {
  return clamp(child.y, viewport);
}

/**
 * Centre the child in the viewport. Falls back to `start()` when the child
 * is taller than (or equal to) the viewport so the title row lands at the
 * top instead of the middle of the card sitting off-screen.
 */
export function center(child: ScrollChild, viewport: ScrollViewport): number {
  if (child.height >= viewport.height) return start(child, viewport);
  const target = child.y - (viewport.height - child.height) / 2;
  return clamp(target, viewport);
}

/**
 * Minimal-motion alignment: returns the current `scrollTop` when the child
 * is already fully visible (or, for an oversized child, already covers the
 * viewport). Otherwise scrolls just enough to bring the nearer edge into
 * view, matching OpenTUI's built-in `scrollChildIntoView` semantics.
 */
export function nearest(child: ScrollChild, viewport: ScrollViewport): number {
  const childTop = child.y;
  const childBottom = child.y + child.height;
  const viewportTop = viewport.scrollTop;
  const viewportBottom = viewport.scrollTop + viewport.height;

  const startOutside = childTop < viewportTop;
  const endOutside = childBottom > viewportBottom;

  // Fully inside — no change.
  if (!startOutside && !endOutside) return clamp(viewport.scrollTop, viewport);

  // Oversized child that already encloses the viewport — no change.
  if (startOutside && endOutside) return clamp(viewport.scrollTop, viewport);

  // Otherwise scroll the minimal amount: bring the outside edge to the
  // matching viewport edge.
  if (startOutside) return clamp(childTop, viewport);
  return clamp(childBottom - viewport.height, viewport);
}
