import { describe, it, expect } from "vitest";
import {
  centerChildInView,
  computeCardViewportPosition,
  scrollChildIntoView,
} from "../../src/tui/scroll-into-view.js";
import type { ScrollBoxRenderable } from "@opentui/core";

type FakeNode = {
  id?: string;
  y?: number;
  x?: number;
  height?: number;
  width?: number;
  parent?: FakeNode | null;
  updateFromLayout?: () => void;
};

interface FakeScrollBox {
  content: {
    findDescendantById: (id: string) => FakeNode | null;
  };
  viewport: { x: number; y: number; width: number; height: number };
  scrollTop: number;
  scrollHeight: number;
  scrollTo: (top: number | { x: number; y: number }) => void;
  scrollBy: (delta: { x: number; y: number }) => void;
}

/**
 * Build a fake scrollbox whose target sits inside a culled file card.
 * Tracks the order in which `updateFromLayout` is invoked, the
 * scroll destination handed to `scrollTo`, and exposes a "pre-refresh
 * stale value" vs "post-refresh fresh value" distinction for the
 * target's `y` / `height`.
 *
 * Coord system mirrors opentui: child.y / viewport.y are absolute
 * screen-y; content frame is reconstructed via
 * contentY = child.y - viewport.y + scrollTop.
 */
function makeFakeScrollbox(opts: {
  viewportY: number;
  viewportHeight: number;
  scrollTop: number;
  scrollHeight: number;
  staleChildY: number;
  staleChildHeight: number;
  freshChildY: number;
  freshChildHeight: number;
}): {
  sb: FakeScrollBox;
  refreshOrder: string[];
  scrollTarget: { type: "to" | "by"; value: number | { x: number; y: number } } | null;
} {
  const refreshOrder: string[] = [];
  let scrollTarget: { type: "to" | "by"; value: number | { x: number; y: number } } | null = null;

  // Simulate culling: until the chain refresh fires, the leaf reports
  // stale values. After parent → leaf is refreshed (top-down), the leaf
  // reports fresh values.
  const state = { refreshed: false };
  const refreshContent = (): void => {
    refreshOrder.push("content");
  };
  const refreshFile = (): void => {
    refreshOrder.push("file");
  };
  const refreshChild = (): void => {
    refreshOrder.push("child");
    state.refreshed = true;
  };

  const content: FakeNode & {
    findDescendantById: (id: string) => FakeNode | null;
  } = {
    id: "__content",
    updateFromLayout: refreshContent,
    findDescendantById: (id) => (id === "target" ? child : null),
  };
  const file: FakeNode = { id: "file", parent: content, updateFromLayout: refreshFile };
  const child: FakeNode = {
    id: "target",
    parent: file,
    updateFromLayout: refreshChild,
    get y(): number {
      return state.refreshed ? opts.freshChildY : opts.staleChildY;
    },
    get height(): number {
      return state.refreshed ? opts.freshChildHeight : opts.staleChildHeight;
    },
    x: 0,
    width: 80,
  };

  const sb: FakeScrollBox = {
    content: {
      findDescendantById: (id) => content.findDescendantById(id),
    },
    viewport: { x: 0, y: opts.viewportY, width: 80, height: opts.viewportHeight },
    scrollTop: opts.scrollTop,
    scrollHeight: opts.scrollHeight,
    scrollTo: (top) => {
      scrollTarget = { type: "to", value: top };
    },
    scrollBy: (delta) => {
      scrollTarget = { type: "by", value: delta };
    },
  };

  return {
    sb,
    refreshOrder,
    get scrollTarget(): typeof scrollTarget {
      return scrollTarget;
    },
  } as { sb: FakeScrollBox; refreshOrder: string[]; scrollTarget: typeof scrollTarget };
}

describe("centerChildInView", () => {
  it("refreshes the ancestor chain top-down before reading positions", () => {
    const { sb, refreshOrder } = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 5,
      freshChildY: 90, // screen-y 90, contentY = 90 - 0 + 100 = 190
      freshChildHeight: 4,
    });
    centerChildInView(sb as unknown as ScrollBoxRenderable, "target");
    expect(refreshOrder).toEqual(["content", "file", "child"]);
  });

  it("scrolls so the child is centered in the viewport", () => {
    // contentY = 90 - 0 + 100 = 190; height = 4; viewport.height = 20.
    // center scrollTop = 190 - (20 - 4) / 2 = 190 - 8 = 182.
    const fake = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 90,
      freshChildHeight: 4,
    });
    const result = centerChildInView(fake.sb as unknown as ScrollBoxRenderable, "target");
    expect(result).toBe(true);
    expect(fake.scrollTarget).toEqual({ type: "to", value: 182 });
  });

  it("returns false and skips scroll when already centered", () => {
    // Already at the target center: scrollTop already equals 182.
    const fake = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 182,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 8, // screen-y = 8; contentY = 8 - 0 + 182 = 190
      freshChildHeight: 4,
    });
    const result = centerChildInView(fake.sb as unknown as ScrollBoxRenderable, "target");
    expect(result).toBe(false);
    expect(fake.scrollTarget).toBeNull();
  });

  it("falls back to start-alignment when the child is taller than the viewport", () => {
    // child.height (40) > viewport.height (20). centerScrollTarget
    // returns child.y (clamped) → 190.
    const fake = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 190,
      freshChildHeight: 40,
    });
    const result = centerChildInView(fake.sb as unknown as ScrollBoxRenderable, "target");
    expect(result).toBe(true);
    expect(fake.scrollTarget).toEqual({ type: "to", value: 190 });
  });

  it("returns false when the descendant is not found", () => {
    const fake = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 0,
      freshChildHeight: 0,
    });
    const result = centerChildInView(fake.sb as unknown as ScrollBoxRenderable, "missing");
    expect(result).toBe(false);
    expect(fake.scrollTarget).toBeNull();
  });

  it("uses stale values without the chain refresh — regression guard", () => {
    // This is what the buggy inline version did: read positions before
    // refreshing the chain. The fresh values produce the correct
    // center; the stale values would produce a different (wrong) one.
    // The test confirms `centerChildInView` uses the fresh values.
    const fake = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 5, // screen-y 5 → contentY 105 → center scrollTop 97
      staleChildHeight: 4,
      freshChildY: 90, // screen-y 90 → contentY 190 → center scrollTop 182
      freshChildHeight: 4,
    });
    centerChildInView(fake.sb as unknown as ScrollBoxRenderable, "target");
    expect(fake.scrollTarget).toEqual({ type: "to", value: 182 });
    expect(fake.scrollTarget).not.toEqual({ type: "to", value: 97 });
  });
});

describe("scrollChildIntoView", () => {
  it("also refreshes the ancestor chain top-down (regression: existing behavior preserved)", () => {
    const { sb, refreshOrder } = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 100, // off-screen below
      freshChildHeight: 4,
    });
    scrollChildIntoView(sb as unknown as ScrollBoxRenderable, "target");
    expect(refreshOrder).toEqual(["content", "file", "child"]);
  });
});

// Issue #302: the footer-hint "is the card in view" probe was driven by
// a uniform-row-height index approximation (`avg = scrollHeight / rows`)
// that mis-reports tall annotation cards as off-screen whenever the
// prefix is enriched with already-passed cards. The fix is a true
// pixel-position probe: ask the scrollbox for the rendered card's
// layout box and intersect it with the viewport rect. The helper
// shares the same culling-safe layout-refresh path as the other
// scroll-into-view primitives.
describe("computeCardViewportPosition", () => {
  it("returns `\"in\"` when the child's box intersects the viewport rect", () => {
    // viewport [50, 70). child [60, 64). Fully inside.
    const { sb } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 60,
      freshChildHeight: 4,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(out).toBe("in");
  });

  it("returns `\"above\"` when the child sits entirely above the viewport top", () => {
    // viewport [50, 70). child [40, 44). Entirely above.
    const { sb } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 40,
      freshChildHeight: 4,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(out).toBe("above");
  });

  it("returns `\"below\"` when the child sits entirely below the viewport bottom", () => {
    // viewport [50, 70). child [80, 84). Entirely below.
    const { sb } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 80,
      freshChildHeight: 4,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(out).toBe("below");
  });

  it("returns `\"in\"` when the child straddles the viewport top (partially in view)", () => {
    // viewport [50, 70). child [48, 54). Partially in view at the top.
    const { sb } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 48,
      freshChildHeight: 6,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(out).toBe("in");
  });

  it("returns `\"in\"` when the child straddles the viewport bottom (partially in view)", () => {
    // viewport [50, 70). child [66, 74). Partially in view at the bottom.
    const { sb } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 66,
      freshChildHeight: 8,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(out).toBe("in");
  });

  it("returns null when the descendant isn't found (pre-mount / culled)", () => {
    const { sb } = makeFakeScrollbox({
      viewportY: 0,
      viewportHeight: 20,
      scrollTop: 0,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 0,
      freshChildY: 0,
      freshChildHeight: 0,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "missing");
    expect(out).toBeNull();
  });

  it("refreshes the ancestor chain top-down before reading positions (culling-safe)", () => {
    // Without the refresh, stale child.y (0) would land "above" viewport
    // [50, 70). After the refresh, child.y = 60 lands "in" — the fresh
    // value is what we want.
    const { sb, refreshOrder } = makeFakeScrollbox({
      viewportY: 50,
      viewportHeight: 20,
      scrollTop: 100,
      scrollHeight: 500,
      staleChildY: 0,
      staleChildHeight: 4,
      freshChildY: 60,
      freshChildHeight: 4,
    });
    const out = computeCardViewportPosition(sb as unknown as ScrollBoxRenderable, "target");
    expect(refreshOrder).toEqual(["content", "file", "child"]);
    expect(out).toBe("in");
  });
});
