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

function makeAdapter(sb: FakeScrollBox | null) {
  return createTuiTourSessionAdapter({
    cwd: "/tmp",
    store: stubStore,
    loadTour: async () => {
      throw new Error("unused");
    },
    loadReplyLock: async () => null,
    writeAnnotation: async () => {
      throw new Error("unused");
    },
    diffScrollBoxRef: { current: sb as unknown as ScrollBoxRenderable | null },
    pickerScrollBoxRef: { current: null },
    setSelectedRowIdx: () => {},
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
// landings — materialize / URL restore / send-to-agent recall). The migration
// moves the choice from anchor kind to `placement`, anchor-kind-agnostic
// across both surfaces.
//
// Issue #299 retired the `TOUR_TUI_SMOOTH_SCROLL` env var: the `nearest`
// branch now always animates via `animatedScrollChildIntoView` (which
// instantiates a `createTimeline` via `@opentui/core`). These tests pin
// the adapter's placement → scroll-helper mapping: `center` →
// `sb.scrollTo` (instant); `nearest` → animated path (timeline created).

describe("createTuiTourSessionAdapter.scrollToCard — placement-driven helper choice", () => {
  it("placement: 'center' calls centerChildInView (sb.scrollTo) on the card", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "annotation-ann1", y: 100, height: 4 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToCard("ann1", "center");
    await flushMacrotask();
    expect(sb.scrollTo).toHaveBeenCalledTimes(1);
    expect(sb.scrollBy).not.toHaveBeenCalled();
    expect(createTimelineSpy).not.toHaveBeenCalled();
  });

  it("placement: 'nearest' takes the animated path (timeline instantiated) on the off-viewport card", async () => {
    const sb = makeScrollBox({
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      child: { id: "annotation-ann1", y: 100, height: 4 },
    });
    const adapter = makeAdapter(sb);
    adapter.scrollToCard("ann1", "nearest");
    await flushMacrotask();
    expect(createTimelineSpy).toHaveBeenCalledTimes(1);
    expect(sb.scrollTo).not.toHaveBeenCalled();
    expect(sb.scrollBy).not.toHaveBeenCalled();
  });
});

describe("createTuiTourSessionAdapter.scrollToRow — placement-driven helper choice", () => {
  it("placement: 'center' centers the row (sb.scrollTo) — matches the webapp's center semantics", async () => {
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
    );
    await flushMacrotask();
    expect(sb.scrollTo).toHaveBeenCalledTimes(1);
    expect(sb.scrollBy).not.toHaveBeenCalled();
    expect(createTimelineSpy).not.toHaveBeenCalled();
  });

  it("placement: 'nearest' takes the animated path (timeline instantiated) on an off-viewport row", async () => {
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
    );
    await flushMacrotask();
    // No throw, no scroll — the absent ref is the pre-mount guard.
  });
});
