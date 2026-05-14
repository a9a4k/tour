import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// @opentui/core eagerly loads tree-sitter highlights `.scm` assets at
// module-init, which esbuild can't transform under vitest. The smooth-
// scroll module only needs `createTimeline` (as a default — tests inject
// their own factory), so stub the module here.
vi.mock("@opentui/core", () => ({
  createTimeline: () => ({ add: () => ({}), pause: () => ({}), play: () => ({}) }),
}));

import type { ScrollBoxRenderable } from "@opentui/core";
import {
  isSmoothScrollEnabled,
  animatedScrollTo,
  animatedScrollChildIntoView,
  animatedCenterChildInView,
  SMOOTH_SCROLL_DEFAULT_DURATION_MS,
  SMOOTH_SCROLL_DEFAULT_EASE,
  type SmoothScrollOptions,
} from "../../src/tui/smooth-scroll.js";

// A fake Timeline that records `add` calls and tracks pause/play state.
// `tick(deltaTime)` advances the holder's value by linear interpolation so
// tests can observe the in-flight onUpdate stream.
interface RecordedAdd {
  target: { value: number };
  duration: number;
  ease: string;
  fromValue: number;
  toValue: number;
  onUpdate: () => void;
  onComplete?: () => void;
}

interface FakeTimeline {
  added: RecordedAdd[];
  paused: boolean;
  pauseCalls: number;
  add: (target: { value: number }, props: Record<string, unknown>) => FakeTimeline;
  pause: () => FakeTimeline;
  play: () => FakeTimeline;
  // tick deltaTime ms forward — drives the most recent animation.
  tick: (deltaMs: number) => void;
  isPlaying: boolean;
  isComplete: boolean;
  currentTime: number;
  duration: number;
}

function makeFakeTimelineFactory(): {
  factory: (opts?: { autoplay?: boolean }) => FakeTimeline;
  timelines: FakeTimeline[];
} {
  const timelines: FakeTimeline[] = [];
  const factory = (_opts?: { autoplay?: boolean }): FakeTimeline => {
    const tl: FakeTimeline = {
      added: [],
      paused: false,
      pauseCalls: 0,
      isPlaying: true,
      isComplete: false,
      currentTime: 0,
      duration: 0,
      add(target, props) {
        const duration = props.duration as number;
        const ease = (props.ease as string) ?? "linear";
        const onUpdate = props.onUpdate as () => void;
        const onComplete = props.onComplete as (() => void) | undefined;
        // Extract the to-value from the named property (any key besides
        // the well-known animation options is treated as a property to tween).
        let toValue = 0;
        for (const k of Object.keys(props)) {
          if (
            k === "duration" ||
            k === "ease" ||
            k === "onUpdate" ||
            k === "onComplete" ||
            k === "onStart" ||
            k === "onLoop" ||
            k === "loop" ||
            k === "loopDelay" ||
            k === "alternate" ||
            k === "once"
          ) {
            continue;
          }
          if (typeof props[k] === "number") {
            toValue = props[k] as number;
          }
        }
        this.added.push({
          target,
          duration,
          ease,
          fromValue: target.value,
          toValue,
          onUpdate,
          onComplete,
        });
        this.duration = duration;
        return this;
      },
      pause() {
        this.paused = true;
        this.pauseCalls += 1;
        this.isPlaying = false;
        return this;
      },
      play() {
        this.paused = false;
        this.isPlaying = true;
        return this;
      },
      tick(deltaMs) {
        for (const a of this.added) {
          this.currentTime += deltaMs;
          const t = Math.min(1, this.currentTime / a.duration);
          a.target.value = a.fromValue + (a.toValue - a.fromValue) * t;
          a.onUpdate();
          if (t >= 1 && !this.isComplete) {
            this.isComplete = true;
            a.onComplete?.();
          }
        }
      },
    };
    timelines.push(tl);
    return tl;
  };
  return { factory, timelines };
}

interface FakeScrollBox {
  scrollTop: number;
  scrollHeight: number;
  viewport: { x: number; y: number; width: number; height: number };
  scrollTopWrites: number[];
  content: { findDescendantById: (id: string) => FakeNode | null };
}

interface FakeNode {
  id?: string;
  y?: number;
  x?: number;
  height?: number;
  width?: number;
  parent?: FakeNode | null;
  updateFromLayout?: () => void;
}

function makeFakeScrollBox(opts: {
  scrollTop: number;
  scrollHeight: number;
  viewportY?: number;
  viewportHeight: number;
  child?: { y: number; height: number; id?: string };
}): FakeScrollBox {
  const child: FakeNode | null = opts.child
    ? {
        id: opts.child.id ?? "target",
        y: opts.child.y,
        x: 0,
        height: opts.child.height,
        width: 80,
        parent: null,
        updateFromLayout: (): void => {},
      }
    : null;
  const writes: number[] = [];
  const sb: FakeScrollBox = {
    scrollHeight: opts.scrollHeight,
    viewport: { x: 0, y: opts.viewportY ?? 0, width: 80, height: opts.viewportHeight },
    scrollTopWrites: writes,
    content: {
      findDescendantById: (id) => (child && id === (opts.child?.id ?? "target") ? child : null),
    },
    get scrollTop(): number {
      return writes.length > 0 ? writes[writes.length - 1] : opts.scrollTop;
    },
    set scrollTop(v: number) {
      writes.push(v);
    },
  };
  return sb;
}

const originalEnv = process.env.TOUR_TUI_SMOOTH_SCROLL;
beforeEach(() => {
  delete process.env.TOUR_TUI_SMOOTH_SCROLL;
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.TOUR_TUI_SMOOTH_SCROLL;
  else process.env.TOUR_TUI_SMOOTH_SCROLL = originalEnv;
});

describe("isSmoothScrollEnabled", () => {
  it("returns false when TOUR_TUI_SMOOTH_SCROLL is unset", () => {
    expect(isSmoothScrollEnabled({})).toBe(false);
  });
  it("returns true when TOUR_TUI_SMOOTH_SCROLL=1", () => {
    expect(isSmoothScrollEnabled({ TOUR_TUI_SMOOTH_SCROLL: "1" })).toBe(true);
  });
  it("returns true when TOUR_TUI_SMOOTH_SCROLL=true", () => {
    expect(isSmoothScrollEnabled({ TOUR_TUI_SMOOTH_SCROLL: "true" })).toBe(true);
  });
  it("returns false on other values", () => {
    expect(isSmoothScrollEnabled({ TOUR_TUI_SMOOTH_SCROLL: "0" })).toBe(false);
    expect(isSmoothScrollEnabled({ TOUR_TUI_SMOOTH_SCROLL: "off" })).toBe(false);
    expect(isSmoothScrollEnabled({ TOUR_TUI_SMOOTH_SCROLL: "" })).toBe(false);
  });
  it("reads from process.env by default", () => {
    process.env.TOUR_TUI_SMOOTH_SCROLL = "1";
    expect(isSmoothScrollEnabled()).toBe(true);
    delete process.env.TOUR_TUI_SMOOTH_SCROLL;
    expect(isSmoothScrollEnabled()).toBe(false);
  });
});

describe("animatedScrollTo", () => {
  it("no-ops when target equals current scrollTop", () => {
    const sb = makeFakeScrollBox({ scrollTop: 100, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 100, { createTimeline: factory });
    expect(timelines).toHaveLength(0);
    expect(sb.scrollTopWrites).toEqual([]);
  });

  it("starts a timeline that tweens scrollTop toward the target with default duration + easing", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, { createTimeline: factory });
    expect(timelines).toHaveLength(1);
    expect(timelines[0].added).toHaveLength(1);
    expect(timelines[0].added[0].fromValue).toBe(0);
    expect(timelines[0].added[0].toValue).toBe(200);
    expect(timelines[0].added[0].duration).toBe(SMOOTH_SCROLL_DEFAULT_DURATION_MS);
    expect(timelines[0].added[0].ease).toBe(SMOOTH_SCROLL_DEFAULT_EASE);
  });

  it("onUpdate writes integer scrollTop on each tween frame", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, {
      createTimeline: factory,
      duration: 100,
    });
    timelines[0].tick(25); // 25% in linear terms
    expect(sb.scrollTopWrites.length).toBeGreaterThan(0);
    const v = sb.scrollTopWrites[sb.scrollTopWrites.length - 1];
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(200);
  });

  it("on completion, scrollTop lands exactly on the target", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, {
      createTimeline: factory,
      duration: 100,
    });
    timelines[0].tick(100); // full duration
    expect(sb.scrollTop).toBe(200);
  });

  it("a second call cancels the prior tween (pause) before starting a new one", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, {
      createTimeline: factory,
      duration: 100,
    });
    timelines[0].tick(50); // halfway
    const midScrollTop = sb.scrollTop;
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 400, {
      createTimeline: factory,
      duration: 100,
    });
    expect(timelines[0].pauseCalls).toBe(1);
    expect(timelines).toHaveLength(2);
    // The new tween starts from the current (mid-animation) scrollTop, not 0.
    expect(timelines[1].added[0].fromValue).toBe(midScrollTop);
    expect(timelines[1].added[0].toValue).toBe(400);
  });

  it("respects the custom duration and easing", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, {
      createTimeline: factory,
      duration: 350,
      ease: "inOutSine",
    });
    expect(timelines[0].added[0].duration).toBe(350);
    expect(timelines[0].added[0].ease).toBe("inOutSine");
  });
});

describe("animatedScrollChildIntoView", () => {
  it("returns false when the descendant is not found", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    const out = animatedScrollChildIntoView(sb as unknown as ScrollBoxRenderable, "missing", {
      createTimeline: factory,
    });
    expect(out).toBe(false);
    expect(timelines).toHaveLength(0);
  });

  it("returns false (no scroll) when the child is already inside the viewport", () => {
    // viewport [0,20]; child at y=5,h=4 → inside.
    const sb = makeFakeScrollBox({
      scrollTop: 0,
      scrollHeight: 500,
      viewportHeight: 20,
      child: { y: 5, height: 4 },
    });
    const { factory, timelines } = makeFakeTimelineFactory();
    const out = animatedScrollChildIntoView(sb as unknown as ScrollBoxRenderable, "target", {
      createTimeline: factory,
    });
    expect(out).toBe(false);
    expect(timelines).toHaveLength(0);
  });

  it("starts a tween that ends at the nearest-aligned scrollTop when child is off-viewport", () => {
    // viewport [0,20]; child at y=100,h=4 → below viewport; nearest delta
    // is (childY + childHeight) - viewportEnd = 104 - 20 = 84. So scrollTop
    // moves from 0 → 84.
    const sb = makeFakeScrollBox({
      scrollTop: 0,
      scrollHeight: 500,
      viewportHeight: 20,
      child: { y: 100, height: 4 },
    });
    const { factory, timelines } = makeFakeTimelineFactory();
    const out = animatedScrollChildIntoView(sb as unknown as ScrollBoxRenderable, "target", {
      createTimeline: factory,
    });
    expect(out).toBe(true);
    expect(timelines).toHaveLength(1);
    expect(timelines[0].added[0].toValue).toBe(84);
  });
});

describe("animatedCenterChildInView", () => {
  it("starts a tween that ends at the centered scrollTop", () => {
    // contentY = 90 - 0 + 100 = 190; height 4; viewport 20 →
    // center scrollTop = 190 - (20-4)/2 = 182. Tween from 100 → 182.
    const sb = makeFakeScrollBox({
      scrollTop: 100,
      scrollHeight: 500,
      viewportHeight: 20,
      viewportY: 0,
      child: { y: 90, height: 4 },
    });
    const { factory, timelines } = makeFakeTimelineFactory();
    const out = animatedCenterChildInView(sb as unknown as ScrollBoxRenderable, "target", {
      createTimeline: factory,
    });
    expect(out).toBe(true);
    expect(timelines[0].added[0].fromValue).toBe(100);
    expect(timelines[0].added[0].toValue).toBe(182);
  });

  it("returns false (no scroll) when the child is already centered", () => {
    // scrollTop already 182 — see fixture above.
    const sb = makeFakeScrollBox({
      scrollTop: 182,
      scrollHeight: 500,
      viewportHeight: 20,
      viewportY: 0,
      child: { y: 8, height: 4 }, // screen-y 8 → contentY 190 → centered
    });
    const { factory, timelines } = makeFakeTimelineFactory();
    const out = animatedCenterChildInView(sb as unknown as ScrollBoxRenderable, "target", {
      createTimeline: factory,
    });
    expect(out).toBe(false);
    expect(timelines).toHaveLength(0);
  });
});

describe("animatedScrollTo — feature-flag bypass", () => {
  it("when `animate: false` is passed, skips the timeline and writes the target instantly", () => {
    const sb = makeFakeScrollBox({ scrollTop: 0, scrollHeight: 500, viewportHeight: 20 });
    const { factory, timelines } = makeFakeTimelineFactory();
    animatedScrollTo(sb as unknown as ScrollBoxRenderable, 200, {
      createTimeline: factory,
      animate: false,
    } as SmoothScrollOptions);
    expect(timelines).toHaveLength(0);
    expect(sb.scrollTopWrites).toEqual([200]);
  });
});
