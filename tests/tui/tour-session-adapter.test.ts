import { describe, it, expect, vi, beforeEach } from "vitest";

// `@opentui/core` eagerly loads tree-sitter grammar `.scm` assets at
// module-init, which esbuild can't transform under vitest. The adapter
// only needs the renderable's interface; the smooth-scroll module's
// `createTimeline` is the only concrete dependency on `@opentui/core`.
// The `createTimelineSpy` hoisted spy lets nearest-placement tests assert
// the animated path was taken (timeline was instantiated) without
// driving the tween — the stub `add` is a no-op so `sb.scrollTop` is
// never written under the stub.
const { createTimelineSpy } = vi.hoisted(() => ({
  createTimelineSpy: vi.fn(),
}));
vi.mock("@opentui/core", () => ({
  createTimeline: (opts?: { autoplay?: boolean }) => {
    createTimelineSpy(opts);
    return { add: () => ({}), pause: () => ({}), play: () => ({}) };
  },
}));

import type { ScrollBoxRenderable } from "@opentui/core";
import { createTuiTourSessionAdapter } from "../../src/tui/tour-session-adapter.js";
import type { TourSessionStore } from "../../src/core/tour-session.js";

// Fake ScrollBoxRenderable: the adapter only reads `content.findDescendantById`,
// `viewport`, `scrollTop`, `scrollHeight`, `scrollTo`, and `scrollBy`. The
// scroll helpers (`scrollChildIntoView` → `scrollBy`, `centerChildInView` →
// `scrollTo`) write distinguishable call records so the tests can verify which
// helper the adapter selected by `placement`.
interface FakeNode {
  id?: string;
  y?: number;
  x?: number;
  height?: number;
  width?: number;
  parent?: FakeNode | null;
  updateFromLayout?: () => void;
}
interface FakeScrollBox {
  content: { findDescendantById: (id: string) => FakeNode | null };
  viewport: { x: number; y: number; width: number; height: number };
  scrollTop: number;
  scrollHeight: number;
  scrollTo: ReturnType<typeof vi.fn>;
  scrollBy: ReturnType<typeof vi.fn>;
}

function makeScrollBox(opts: {
  viewportHeight: number;
  scrollTop: number;
  scrollHeight: number;
  child: { id: string; y: number; height: number };
}): FakeScrollBox {
  const content: FakeNode & {
    findDescendantById: (id: string) => FakeNode | null;
  } = {
    id: "__content",
    updateFromLayout: (): void => {},
    findDescendantById: (id) => (id === opts.child.id ? child : null),
  };
  const child: FakeNode = {
    id: opts.child.id,
    y: opts.child.y,
    x: 0,
    height: opts.child.height,
    width: 80,
    parent: content,
    updateFromLayout: (): void => {},
  };
  return {
    content,
    viewport: { x: 0, y: 0, width: 80, height: opts.viewportHeight },
    scrollTop: opts.scrollTop,
    scrollHeight: opts.scrollHeight,
    scrollTo: vi.fn(),
    scrollBy: vi.fn(),
  };
}

const stubStore = {
  getState: () => ({ currentTourId: null }),
} as unknown as TourSessionStore;

function makeAdapter(sb: FakeScrollBox | null, opts: { setScrollPending?: (pending: boolean) => void } = {}) {
  return createTuiTourSessionAdapter({
    cwd: "/tmp",
    store: stubStore,
    loadTour: async () => {
      throw new Error("unused");
    },
    loadReplyLock: async () => null,
    writeComment: async () => {
      throw new Error("unused");
    },
    deleteComment: async () => {},
    diffScrollBoxRef: { current: sb as unknown as ScrollBoxRenderable | null },
    pickerScrollBoxRef: { current: null },
    setSelectedRowIdx: () => {},
    setScrollPending: opts.setScrollPending ?? (() => {}),
    replyAgent: undefined,
  });
}

// `scheduleScroll` uses `setTimeout(0)` so the test must flush macrotasks
// before asserting.
async function flushMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  createTimelineSpy.mockClear();
});

// Issue #296: the TUI cursor-scroll path used to live in a surface-side
// `[cursor, layout]` useEffect that picked the scroll helper by anchor kind
// (CardAnchor → center, RowAnchor → nearest). The reducer's
// `scrollCursorTarget` intent already carries a `placement` discriminator
// (`"nearest"` for in-flight `n`/`p`/`j`/`k`/click, `"center"` for fresh
// landings — materialize / URL restore / send-to-agent recall).
//
// Issue #348: `placement` and `behavior` are now independent axes. The
// adapter dispatches to the matching helper for each (placement,
// behavior) combination:
//   center  + instant → centerChildInView          (sb.scrollTo, no timeline)
//   center  + smooth  → animatedCenterChildInView  (timeline)
//   nearest + smooth  → animatedScrollChildIntoView (timeline)
//   nearest + instant → animatedScrollChildIntoView with animate:false
//                       (instant write via sb.scrollTop = …, no timeline)
//
// `nearest + instant` is the post-submit retry-budget escape hatch
// (issue #301); other combinations are dispatched by the reducer
// (center/instant = fresh landing; center/smooth = n/p; nearest/smooth
// = j/k + click).

describe("createTuiTourSessionAdapter.scrollToCard — (placement, behavior) helper choice", () => {
  it("center + instant calls centerChildInView (sb.scrollTo) — fresh landing path", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "comment-ann1", y: 100, height: 4 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToCard("ann1", "center", "instant");
    await flushMacrotask();
    expect(sb.scrollTo).toHaveBeenCalledTimes(1);
    expect(sb.scrollBy).not.toHaveBeenCalled();
    expect(createTimelineSpy).not.toHaveBeenCalled();
  });

  it("center + smooth takes the animated path (timeline instantiated) — n/p comment-walking", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "comment-ann1", y: 100, height: 4 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToCard("ann1", "center", "smooth");
    await flushMacrotask();
    expect(createTimelineSpy).toHaveBeenCalledTimes(1);
    expect(sb.scrollTo).not.toHaveBeenCalled();
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });

  it("nearest + smooth takes the animated path (timeline instantiated) — j/k + click", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "comment-ann1", y: 100, height: 4 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToCard("ann1", "nearest", "smooth");
    await flushMacrotask();
    expect(createTimelineSpy).toHaveBeenCalledTimes(1);
    expect(sb.scrollTo).not.toHaveBeenCalled();
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });
});

describe("createTuiTourSessionAdapter.scrollToRow — (placement, behavior) helper choice", () => {
  it("center + instant centers the row instantly", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "diff-row-src/a.ts-additions-7", y: 100, height: 1 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "center",
      "instant",
    );
    await flushMacrotask();
    expect(sb.scrollTo).toHaveBeenCalledTimes(1);
    expect(sb.scrollBy).not.toHaveBeenCalled();
    expect(createTimelineSpy).not.toHaveBeenCalled();
  });

  it("center + smooth tweens the row to centre", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "diff-row-src/a.ts-additions-7", y: 100, height: 1 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "center",
      "smooth",
    );
    await flushMacrotask();
    expect(createTimelineSpy).toHaveBeenCalledTimes(1);
    expect(sb.scrollTo).not.toHaveBeenCalled();
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });

  it("nearest + smooth takes the animated path on an off-viewport row", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "diff-row-src/a.ts-additions-7", y: 100, height: 1 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "nearest",
      "smooth",
    );
    await flushMacrotask();
    expect(createTimelineSpy).toHaveBeenCalledTimes(1);
    expect(sb.scrollTo).not.toHaveBeenCalled();
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });
});

describe("createTuiTourSessionAdapter — null scrollbox ref", () => {
  it("scrollToRow is a strict no-op when the scrollbox ref is unmounted", async () => {
    const adapter = makeAdapter(null);
    adapter.scrollToRow(
      { kind: "row", file: "src/a.ts", side: "additions", lineNumber: 7 },
      "center",
      "instant",
    );
    await flushMacrotask();
    // No throw, no scroll — the absent ref is the pre-mount guard.
  });
});

describe("createTuiTourSessionAdapter.captureAnchor/applyAnchor", () => {
  it("captures and reapplies the same row y across a reflow", async () => {
    const sb = makeScrollBox({
      viewportHeight: 50,
      scrollTop: 100,
      scrollHeight: 500,
      child: { id: "target", y: 110, height: 10 },
    });
    const adapter = makeAdapter(sb);
    const token = adapter.captureAnchor("target");
    expect(token).not.toBeNull();

    const target = sb.content.findDescendantById("target");
    if (!target) throw new Error("missing target");
    target.y = 140;
    adapter.applyAnchor(token!);
    await flushMacrotask();

    expect(sb.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("returns null when the row cannot be measured", () => {
    const sb = makeScrollBox({
      viewportHeight: 50,
      scrollTop: 100,
      scrollHeight: 500,
      child: { id: "target", y: 110, height: 10 },
    });
    const adapter = makeAdapter(sb);

    expect(adapter.captureAnchor("missing")).toBeNull();
  });
});

// Issue #301: the post-submit `scrollCursorTarget` retry-budget loop fires
// inside `composer.submitted`, before the watcher's `bundle.refreshed`
// delivers the freshly-written card to the DOM. Each retry waits one
// macrotask for the DOM to catch up. Without `animate: false`, every
// retry that lands a successful scroll spawns a Timeline that the next
// retry would immediately cancel — wasteful churn for a "wait for DOM"
// mechanism that isn't the user's in-flight motion gesture. The fix
// threads `animate: false` into retry attempts so the eventual successful
// write lands instantly. First attempt (n/p-to-existing-card path)
// keeps its animation; only the retry path is collapsed to instant.
describe("createTuiTourSessionAdapter.scrollToCard — post-submit retry path (issue #301)", () => {
  it("retries write instantly (animate: false) — no Timeline spawned when the target appears on a later attempt", async () => {
    const child: FakeNode = {
      id: "comment-ann1",
      y: 100,
      x: 0,
      height: 4,
      width: 80,
      parent: null,
      updateFromLayout: (): void => {},
    };
    let probeCount = 0;
    const content: FakeNode & {
      findDescendantById: (id: string) => FakeNode | null;
    } = {
      id: "__content",
      updateFromLayout: (): void => {},
      findDescendantById: (id: string): FakeNode | null => {
        if (id !== child.id) return null;
        probeCount += 1;
        // null on the first probe (first-attempt guard); child on the
        // retry probe + the helper's delta-compute probe.
        return probeCount >= 2 ? child : null;
      },
    };
    child.parent = content;
    const writes: number[] = [];
    const sb = {
      content,
      viewport: { x: 0, y: 0, width: 80, height: 20 },
      scrollHeight: 500,
      scrollTo: vi.fn(),
      scrollBy: vi.fn(),
      get scrollTop(): number {
        return writes.length > 0 ? writes[writes.length - 1] : 0;
      },
      set scrollTop(v: number) {
        writes.push(v);
      },
    };
    const adapter = makeAdapter(sb as unknown as FakeScrollBox);
    adapter.scrollToCard("ann1", "nearest", "smooth");
    // Flush twice — first attempt fires (target missing), then the retry.
    await flushMacrotask();
    await flushMacrotask();
    // The retry forced instant → no Timeline (issue #348 axis decoupling).
    expect(createTimelineSpy).not.toHaveBeenCalled();
    // The landing happened: nearest-aligned scrollTop is
    // (child.y + child.height) - viewport.height = 104 - 20 = 84.
    expect(writes).toEqual([84]);
    // animatedScrollTo's instant path writes scrollTop directly, not via scrollBy.
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });
});

// Issue #302 (second iteration): the scroll-into-view animation mutates
// `sb.scrollTop` imperatively without triggering a React re-render, so the
// footer-hint pixel probe — which reads `sb.scrollTop` at render time —
// sees pre-scroll state and reports a visible card as off-screen. The
// adapter signals `setScrollPending(true)` when it starts the scroll and
// `setScrollPending(false)` once the animation has settled, so the App
// can suppress the directional suffix during the window and force a
// re-render where the probe sees the settled scrollTop.

describe("createTuiTourSessionAdapter.scrollToCard — scroll-pending signal (issue #302)", () => {
  it("flips setScrollPending(true) synchronously when the card scroll is initiated", () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "comment-ann1", y: 100, height: 4 },
    });
    const events: boolean[] = [];
    const adapter = makeAdapter(sb, { setScrollPending: (p) => events.push(p) });
    adapter.scrollToCard("ann1", "nearest", "smooth");
    // The signal must land before the macrotask flushes — the probe runs
    // in the same React render cycle as the cursor change that triggered
    // the scroll, so suppression has to be live by then.
    expect(events).toEqual([true]);
  });

  it("flips setScrollPending(false) after the smooth-scroll settle window when the scroll succeeds", async () => {
    vi.useFakeTimers();
    try {
      const sb = makeScrollBox({
        viewportHeight: 20,
        scrollTop: 0,
        scrollHeight: 500,
        child: { id: "comment-ann1", y: 100, height: 4 },
      });
      const events: boolean[] = [];
      const adapter = makeAdapter(sb, { setScrollPending: (p) => events.push(p) });
      adapter.scrollToCard("ann1", "nearest", "smooth");
      expect(events).toEqual([true]);
      // Flush the scheduleScroll macrotask so the scroll fires.
      await vi.advanceTimersByTimeAsync(0);
      // Still pending — the settle timer is armed but not yet fired.
      expect(events).toEqual([true]);
      // Advance past the smooth-scroll duration + buffer (200 + 50 = 250ms).
      await vi.advanceTimersByTimeAsync(300);
      expect(events).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flips setScrollPending(false) when the retry budget is exhausted without a successful scroll", async () => {
    vi.useFakeTimers();
    try {
      // No descendant matching the card id → every attempt fails.
      const sb = makeScrollBox({
        viewportHeight: 20,
        scrollTop: 0,
        scrollHeight: 500,
        child: { id: "comment-other", y: 100, height: 4 },
      });
      const events: boolean[] = [];
      const adapter = makeAdapter(sb, { setScrollPending: (p) => events.push(p) });
      adapter.scrollToCard("ann1", "nearest", "smooth");
      expect(events).toEqual([true]);
      // Drain all 21 macrotasks (initial + 20 retries). Each retry
      // re-schedules via setTimeout(0); advanceTimersByTimeAsync(0)
      // doesn't fire newly-scheduled timers, so step explicitly.
      for (let i = 0; i < 22; i++) {
        await vi.advanceTimersByTimeAsync(1);
      }
      // The last attempt cleared the pending signal — no settle timer
      // since no scroll fired, so the false lands synchronously inside
      // the last scheduleScroll macrotask.
      expect(events.at(-1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
