import { describe, it, expect } from "vitest";
import { nearest, center, preserveScreenY, start } from "../../src/core/scroll-target.js";

// All inputs are pure numbers in content-coordinate space:
// - child.y      : top of the child relative to the content's top (0)
// - child.height : child height in rows
// - viewport.scrollTop  : current scrollTop (top of viewport in content space)
// - viewport.height     : viewport height in rows
// - viewport.contentHeight : total content height (clamps target to
//                             [0, max(0, contentHeight - viewport.height)])

describe("scroll-target", () => {
  describe("start()", () => {
    it("returns child.y when child fits inside the document", () => {
      expect(
        start({ y: 30, height: 10 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(30);
    });

    it("clamps to 0 when child.y is negative", () => {
      expect(
        start({ y: -5, height: 10 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(0);
    });

    it("clamps to (contentHeight - viewport.height) when child sits near the document end", () => {
      // max scrollTop = 200 - 20 = 180. child.y = 195 → clamp to 180.
      expect(
        start({ y: 195, height: 5 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(180);
    });

    it("clamps to 0 when contentHeight <= viewport.height", () => {
      // No scrolling possible — max scrollTop is 0.
      expect(
        start({ y: 5, height: 2 }, { scrollTop: 0, height: 20, contentHeight: 10 }),
      ).toBe(0);
    });
  });

  describe("center()", () => {
    it("centers a child smaller than the viewport", () => {
      // viewport.height=20, child.height=10 → leftover space=10, half=5.
      // Target = child.y - 5 = 50 - 5 = 45.
      expect(
        center({ y: 50, height: 10 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(45);
    });

    it("falls back to start() when child is taller than viewport", () => {
      // child.height=30, viewport.height=20. Centering would put the title
      // off-screen; we want the title at the top.
      expect(
        center({ y: 50, height: 30 }, { scrollTop: 0, height: 20, contentHeight: 500 }),
      ).toBe(50);
    });

    it("falls back to start() when child is exactly viewport height", () => {
      // height equality: no centering needed; align top.
      expect(
        center({ y: 60, height: 20 }, { scrollTop: 0, height: 20, contentHeight: 500 }),
      ).toBe(60);
    });

    it("clamps to 0 at document top", () => {
      // child.y=2, viewport.height=20, child.height=10 → 2 - 5 = -3 → clamp to 0.
      expect(
        center({ y: 2, height: 10 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(0);
    });

    it("clamps to (contentHeight - viewport.height) at document bottom", () => {
      // max scrollTop = 200 - 20 = 180. child.y=195 → 195 - 5 = 190 → clamp to 180.
      expect(
        center({ y: 195, height: 10 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(180);
    });

    it("clamps to 0 when contentHeight <= viewport.height", () => {
      expect(
        center({ y: 4, height: 2 }, { scrollTop: 0, height: 20, contentHeight: 10 }),
      ).toBe(0);
    });

    it("returns same scrollTop regardless of current scrollTop (block:center is unconditional)", () => {
      // Matches the webapp's unconditional `scrollIntoView({ block: 'center' })`
      // — even when the child is already on-screen, the target is the same.
      const child = { y: 100, height: 10 };
      const v = (st: number) => ({ scrollTop: st, height: 30, contentHeight: 400 });
      // Centered target = 100 - (30 - 10) / 2 = 90.
      expect(center(child, v(0))).toBe(90);
      expect(center(child, v(85))).toBe(90);
      expect(center(child, v(200))).toBe(90);
    });
  });

  describe("nearest()", () => {
    it("returns current scrollTop when child is already fully visible", () => {
      // viewport [10, 30), child [12, 22) → fully inside.
      expect(
        nearest({ y: 12, height: 10 }, { scrollTop: 10, height: 20, contentHeight: 200 }),
      ).toBe(10);
    });

    it("scrolls up to align child top with viewport top when child is above viewport", () => {
      // viewport [50, 70), child [30, 40). Align tops → scrollTop = 30.
      expect(
        nearest({ y: 30, height: 10 }, { scrollTop: 50, height: 20, contentHeight: 200 }),
      ).toBe(30);
    });

    it("scrolls down to align child bottom with viewport bottom when child is below viewport", () => {
      // viewport [10, 30), child [40, 50). Align bottoms → scrollTop = 50 - 20 = 30.
      expect(
        nearest({ y: 40, height: 10 }, { scrollTop: 10, height: 20, contentHeight: 200 }),
      ).toBe(30);
    });

    it("returns current scrollTop when child larger than viewport already covers it", () => {
      // viewport [20, 40), child [10, 50) → child encloses viewport, no change.
      expect(
        nearest({ y: 10, height: 40 }, { scrollTop: 20, height: 20, contentHeight: 200 }),
      ).toBe(20);
    });

    it("clamps to 0 when scrolling above document top", () => {
      // child.y = -5; clamping prevents a negative scrollTop.
      expect(
        nearest({ y: -5, height: 4 }, { scrollTop: 50, height: 20, contentHeight: 200 }),
      ).toBe(0);
    });

    it("clamps to (contentHeight - viewport.height) at document bottom", () => {
      // max scrollTop = 200 - 20 = 180. child near end produces 195, clamped to 180.
      expect(
        nearest({ y: 195, height: 5 }, { scrollTop: 0, height: 20, contentHeight: 200 }),
      ).toBe(180);
    });
  });

  describe("preserveScreenY()", () => {
    it("pins the row at the same screen-y when the content reflow leaves room", () => {
      // Before: row at contentY=100, scrollTop=80 → screenY=20.
      // After:  row at contentY=140 (the diff grew above by 40 rows).
      // To keep screenY=20, scrollTop must be 140 - 20 = 120.
      expect(
        preserveScreenY(
          { y: 100, height: 1 },
          { y: 140, height: 1 },
          80,
          { scrollTop: 0, height: 30, contentHeight: 500 },
        ),
      ).toBe(120);
    });

    it("returns the same scrollTop when the row's content-y did not move", () => {
      // Stable row → screenY unchanged → scrollTop unchanged. Use a screenY
      // strictly inside (0, viewport.height) so the visibility check passes.
      // contentY=50, scrollTop=40 → screenY=10 (mid-viewport).
      expect(
        preserveScreenY(
          { y: 50, height: 1 },
          { y: 50, height: 1 },
          40,
          { scrollTop: 0, height: 20, contentHeight: 200 },
        ),
      ).toBe(40);
    });

    it("clamps to 0 at the document top (cursor was near the top before reflow)", () => {
      // Before: contentY=5, scrollTop=0 → screenY=5.
      // After:  contentY=3 (diff shrank above). desired = 3 - 5 = -2 → clamp to 0.
      // Row still visible (contentY=3 inside viewport [0, 20)) → no center fallback.
      expect(
        preserveScreenY(
          { y: 5, height: 1 },
          { y: 3, height: 1 },
          0,
          { scrollTop: 0, height: 20, contentHeight: 200 },
        ),
      ).toBe(0);
    });

    it("clamps to (contentHeight - viewport.height) at the document bottom", () => {
      // viewport.height=20, contentHeight=200 → maxScrollTop=180.
      // Before: contentY=195, scrollTop=180 → screenY=15.
      // After:  contentY=210 (diff grew). desired = 210 - 15 = 195 → clamp to 180.
      // childTop = 210 - 180 = 30 → past viewport bottom → center fallback;
      // center math = 210 - 9.5 = 200.5 → clamped to 180.
      expect(
        preserveScreenY(
          { y: 195, height: 1 },
          { y: 210, height: 1 },
          180,
          { scrollTop: 0, height: 20, contentHeight: 200 },
        ),
      ).toBe(180);
    });

    it("centers when the clamped preserve would leave the row off the bottom of the viewport", () => {
      // The reflow shrank contentHeight so newChild sits below the new max-
      // scrollable viewport. Old contentY=500, scrollTop=480, viewport=20,
      // screenY=20. New contentHeight=100, newChild.y=95. maxScrollTop=80;
      // desired=95-20=75 (in range). childTop = 95 - 75 = 20 = viewport.height
      // → off-screen → center(newChild) = 95 - 9.5 = 85.5 → clamp to 80.
      expect(
        preserveScreenY(
          { y: 500, height: 1 },
          { y: 95, height: 1 },
          480,
          { scrollTop: 0, height: 20, contentHeight: 100 },
        ),
      ).toBe(80);
    });

    it("centers when the clamped preserve would leave the row above the viewport top", () => {
      // Before: contentY=100, scrollTop=0 → screenY=100 (cursor far below viewport).
      // After: contentY=50, scrollTop=0 → desired = 50 - 100 = -50 → clamp to 0.
      // childTop = 50 → off-screen (childTop >= viewport.height=20) → center:
      // 50 - (20 - 1)/2 = 40.5; contentHeight=200, max=180, no further clamp.
      expect(
        preserveScreenY(
          { y: 100, height: 1 },
          { y: 50, height: 1 },
          0,
          { scrollTop: 0, height: 20, contentHeight: 200 },
        ),
      ).toBe(40.5);
    });

    it("returns 0 when contentHeight <= viewport.height (no scrolling possible)", () => {
      // Tiny doc — no room to scroll. Even when preserve math wants a positive
      // scrollTop, max is 0 and we land at 0.
      expect(
        preserveScreenY(
          { y: 5, height: 1 },
          { y: 4, height: 1 },
          0,
          { scrollTop: 0, height: 20, contentHeight: 10 },
        ),
      ).toBe(0);
    });
  });
});
