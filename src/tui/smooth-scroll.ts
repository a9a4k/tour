import type { ScrollBoxRenderable } from "@opentui/core";
import {
  createTimeline as defaultCreateTimeline,
  type EasingFunctions,
  type Timeline,
} from "@opentui/core";
import {
  computeCenterChildScrollTop,
  computeScrollChildIntoViewDelta,
} from "./scroll-into-view.js";

/**
 * Animated smooth scroll for in-flight TUI cursor navigation (`n`/`p`,
 * `j`/`k`, click-to-position, keyboard `select-file`) — issue #294
 * shipped the implementation, issue #299 promoted it to the only path
 * for `nearest` placement.
 *
 * The animation runs through OpenTUI's `createTimeline` engine, which
 * is already attached to the renderer's frame callback and manages live
 * mode automatically. The tween mutates a small holder object's `value`
 * field; `onUpdate` mirrors that into `ScrollBox.scrollTop` (rounded to
 * an integer cell), which relays out and re-renders.
 *
 * Interruption: a per-scrollbox `WeakMap` tracks the in-flight timeline.
 * A second motion arriving while a tween is in flight pauses the prior
 * tween and starts a fresh one from the current (mid-animation)
 * `scrollTop` toward the new target — mashing `n n n n n` produces
 * continuous downward motion, not five concurrent fights over the same
 * property.
 */

export const SMOOTH_SCROLL_DEFAULT_DURATION_MS = 200;
export const SMOOTH_SCROLL_DEFAULT_EASE: EasingFunctions = "outQuad";

export interface SmoothScrollOptions {
  duration?: number;
  ease?: EasingFunctions;
  // `false` forces the instant write path — used by callers that have a
  // standing reason to skip the tween (e.g. the post-submit retry-budget
  // loop) without forcing the smooth path on every other caller.
  animate?: boolean;
  // Injection seam for tests. Defaults to `@opentui/core`'s
  // `createTimeline`. The real engine attaches to the renderer's frame
  // callback automatically; tests pass a fake that records calls and
  // exposes a manual `tick()`.
  createTimeline?: (opts?: { autoplay?: boolean }) => Timeline;
}

// Per-scrollbox in-flight tween. `WeakMap` so the entry is GC'd with
// the scrollbox itself (no manual cleanup at unmount).
const inFlight = new WeakMap<object, Timeline>();

/**
 * Animate `sb.scrollTop` from its current value to `targetTop` using
 * OpenTUI's Timeline engine. No-ops when already at target. Cancels any
 * prior in-flight tween on this scrollbox. With `animate: false`,
 * writes the target instantly (caller-level escape hatch).
 */
export function animatedScrollTo(
  sb: ScrollBoxRenderable,
  targetTop: number,
  opts: SmoothScrollOptions = {},
): void {
  const current = sb.scrollTop;
  if (current === targetTop) return;

  // Cancel any in-flight tween — the new motion starts from the current
  // (mid-animation) scrollTop, which is already captured above.
  const prev = inFlight.get(sb);
  if (prev) {
    prev.pause();
    inFlight.delete(sb);
  }

  if (opts.animate === false) {
    sb.scrollTop = targetTop;
    return;
  }

  const factory = opts.createTimeline ?? defaultCreateTimeline;
  const duration = opts.duration ?? SMOOTH_SCROLL_DEFAULT_DURATION_MS;
  const ease = opts.ease ?? SMOOTH_SCROLL_DEFAULT_EASE;

  const holder = { value: current };
  const timeline = factory({ autoplay: true });
  timeline.add(holder, {
    duration,
    ease,
    value: targetTop,
    onUpdate: () => {
      // Integer cells — sub-cell smoothing isn't a thing in terminals.
      sb.scrollTop = Math.round(holder.value);
    },
    onComplete: () => {
      sb.scrollTop = targetTop;
      if (inFlight.get(sb) === timeline) inFlight.delete(sb);
    },
  });
  inFlight.set(sb, timeline);
}

/**
 * Animated mirror of `scrollChildIntoView` (block:"nearest" semantics).
 * Returns `true` if a scroll occurred. Falls back to the instant path
 * when `opts.animate === false`.
 */
export function animatedScrollChildIntoView(
  sb: ScrollBoxRenderable,
  childId: string,
  opts: SmoothScrollOptions = {},
): boolean {
  const delta = computeScrollChildIntoViewDelta(sb, childId);
  if (!delta) return false;
  if (delta.dx === 0 && delta.dy === 0) return false;
  // X-axis motion is essentially nil for the diff stream; preserve the
  // existing semantics by applying any X delta instantly and animating Y.
  if (delta.dx !== 0) {
    sb.scrollBy({ x: delta.dx, y: 0 });
  }
  const targetTop = sb.scrollTop + delta.dy;
  animatedScrollTo(sb, targetTop, opts);
  return true;
}

/**
 * Animated mirror of `centerChildInView`. Returns `true` if a scroll
 * occurred. Falls back to the instant path when `opts.animate === false`.
 */
export function animatedCenterChildInView(
  sb: ScrollBoxRenderable,
  childId: string,
  opts: SmoothScrollOptions = {},
): boolean {
  const desired = computeCenterChildScrollTop(sb, childId);
  if (desired === null) return false;
  if (desired === sb.scrollTop) return false;
  animatedScrollTo(sb, desired, opts);
  return true;
}
