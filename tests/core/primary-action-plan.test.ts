import { describe, it, expect } from "vitest";
import {
  planPrimaryAction,
  type PrimaryActionContext,
} from "../../src/core/primary-action-plan.js";
import type { FlatRow } from "../../src/core/flat-rows.js";

function pairedFlat(file: string, line: number): FlatRow {
  return {
    kind: "diff",
    file,
    lineNumber: line,
    side: "additions",
    leftLineNumber: line,
    rightLineNumber: line,
    paired: true,
  };
}

function interactiveFlat(parts: {
  file: string;
  subKind: "hunk-separator" | "boundary-top" | "expand-down" | "collapsed-file";
  boundaryRef: number | "top" | "bottom";
}): FlatRow {
  return {
    kind: "interactive",
    file: parts.file,
    subKind: parts.subKind,
    boundaryRef: parts.boundaryRef,
  };
}

const ZERO: PrimaryActionContext["boundaryExpansion"] = { up: 0, down: 0 };

describe("planPrimaryAction (issue #372)", () => {
  describe("boundary-top", () => {
    it("small file-top gap → expandTop 'all' with orphan-landing on the first diff row of the file", () => {
      const rows: FlatRow[] = [
        interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
        pairedFlat("x.txt", 5),
        pairedFlat("x.txt", 6),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "boundary-top", boundaryRef: "top" },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 4,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expandTop",
        file: "x.txt",
        mode: "all",
        gapSize: 4,
      });
      expect(plan.landing).not.toBeNull();
      expect(plan.landing?.file).toBe("x.txt");
      expect(plan.landing?.lineNumber).toBe(5);
      expect(plan.landing?.interactive).toBeUndefined();
    });

    it("large file-top gap → expandTop 'symmetric-20' with no orphan-landing (banner survives)", () => {
      const rows: FlatRow[] = [
        interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
        pairedFlat("x.txt", 41),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "boundary-top", boundaryRef: "top" },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 40,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expandTop",
        file: "x.txt",
        mode: "symmetric-20",
        gapSize: 40,
      });
      expect(plan.landing).toBeNull();
    });

    it("zero gap → no expansion, no landing", () => {
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "boundary-top", boundaryRef: "top" },
        preferredSide: "additions",
        flatRowsBefore: [],
        gapSize: 0,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toBeNull();
      expect(plan.landing).toBeNull();
    });
  });

  describe("hunk-separator", () => {
    it("small mid-file gap → expand both/all with orphan-landing on the next diff row", () => {
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
        pairedFlat("x.txt", 30),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 20,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expand",
        file: "x.txt",
        ref: 1,
        direction: "both",
        mode: "all",
        gapSize: 20,
      });
      expect(plan.landing).not.toBeNull();
      expect(plan.landing?.lineNumber).toBe(30);
    });

    it("large mid-file gap → expand 'down' (bottom of gap) with no orphan-landing (issue #381)", () => {
      // Issue #381: user-facing `↑` on the banner reveals lines that
      // render immediately above the banner — those are at the bottom
      // edge of the gap (line numbers approaching `currentStart - 1`),
      // which the reducer grows via `direction: "down"`. The planner
      // translates the banner's `primaryExpand: "up"` (user-facing
      // direction) into gap-edge `direction: "down"` for the reducer.
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
        pairedFlat("x.txt", 60),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 50,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expand",
        file: "x.txt",
        ref: 1,
        direction: "down",
        mode: "symmetric-20",
        gapSize: 50,
      });
      expect(plan.landing).toBeNull();
    });

    it("threads preferredSide onto the landing anchor", () => {
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
        pairedFlat("x.txt", 20),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 },
        preferredSide: "deletions",
        flatRowsBefore: rows,
        gapSize: 10,
        boundaryExpansion: ZERO,
      });
      expect(plan.landing?.preferredSide).toBe("deletions");
    });
  });

  describe("expand-down (mid-file)", () => {
    it("large remaining gap → expand 'up' (top of gap) with no orphan-landing (row survives) (issue #381)", () => {
      // Issue #381: user-facing `↓` on the standalone row reveals lines
      // that grow the visible context from the previous hunk's end
      // downward — those are at the top edge of the gap (line numbers
      // starting at `prevEnd + 1`), which the reducer grows via
      // `direction: "up"`. The planner translates the standalone row's
      // `subKind: "expand-down"` (user-facing direction ↓) into
      // gap-edge `direction: "up"` for the reducer.
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: 1 }),
        interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
        pairedFlat("x.txt", 100),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "expand-down", boundaryRef: 1 },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 100,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expand",
        file: "x.txt",
        ref: 1,
        direction: "up",
        mode: "symmetric-20",
        gapSize: 100,
      });
      expect(plan.landing).toBeNull();
    });

    it("post-dispatch remaining gap drops below GAP_TWO_ROW_THRESHOLD → orphan-landing on next diff row (issue #381)", () => {
      // gap=50, no prior expansion → addition=min(20, 50)=20 → newRemaining=30
      // 30 < 40 (GAP_TWO_ROW_THRESHOLD) → expand-down-mid orphan.
      // Issue #381: direction is now gap-edge "up" (top of gap = lines
      // just after prevEnd), translated from user-facing ↓.
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: 1 }),
        interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
        pairedFlat("x.txt", 60),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "expand-down", boundaryRef: 1 },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 50,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expand",
        file: "x.txt",
        ref: 1,
        direction: "up",
        mode: "symmetric-20",
        gapSize: 50,
      });
      expect(plan.landing).not.toBeNull();
      expect(plan.landing?.lineNumber).toBe(60);
    });

    it("zero gap → no expansion, no landing", () => {
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "expand-down", boundaryRef: 1 },
        preferredSide: "additions",
        flatRowsBefore: [],
        gapSize: 0,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toBeNull();
      expect(plan.landing).toBeNull();
    });
  });

  describe("expand-down (file-bottom)", () => {
    it("post-dispatch remaining gap > 0 → no orphan-landing (row survives)", () => {
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" }),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 50,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expandBottom",
        file: "x.txt",
        mode: "symmetric-20",
        gapSize: 50,
      });
      expect(plan.landing).toBeNull();
    });

    it("post-dispatch remaining gap == 0 → orphan-landing backward to last diff row of file", () => {
      // gap=10, addition=10, newRemaining=0 → expand-down-bottom orphan.
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1),
        pairedFlat("x.txt", 2),
        interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" }),
        pairedFlat("y.txt", 1),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 10,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({
        type: "expansion.expandBottom",
        file: "x.txt",
        mode: "symmetric-20",
        gapSize: 10,
      });
      expect(plan.landing).not.toBeNull();
      expect(plan.landing?.file).toBe("x.txt");
      expect(plan.landing?.lineNumber).toBe(2);
    });
  });

  describe("collapsed-file", () => {
    it("dispatches expansion.expandFile and lands on a synthetic boundary-top anchor", () => {
      const rows: FlatRow[] = [
        interactiveFlat({ file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" }),
        pairedFlat("y.txt", 1),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" },
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 0,
        boundaryExpansion: ZERO,
      });
      expect(plan.expansion).toEqual({ type: "expansion.expandFile", file: "x.txt" });
      expect(plan.landing).not.toBeNull();
      expect(plan.landing?.file).toBe("x.txt");
      expect(plan.landing?.interactive).toEqual({
        subKind: "boundary-top",
        boundaryRef: "top",
      });
    });

    it("threads preferredSide onto the synthetic boundary-top landing", () => {
      const rows: FlatRow[] = [
        interactiveFlat({ file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" }),
      ];
      const plan = planPrimaryAction({
        target: { file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" },
        preferredSide: "deletions",
        flatRowsBefore: rows,
        gapSize: 0,
        boundaryExpansion: ZERO,
      });
      expect(plan.landing?.preferredSide).toBe("deletions");
    });
  });

  describe("cross-pane click", () => {
    // Issue #372: the click handler may fire when the cursor is on a
    // sidebar selection / a comment card / null. The planner is target-
    // explicit; the pre-click cursor never feeds in. These tests just
    // confirm the plan does not depend on a pre-existing cursor at the
    // target — every other test in this file already constructs the
    // synthetic anchor implicitly through `target`.
    it("plans identically regardless of where the cursor was pre-click (target is the only input)", () => {
      const rows: FlatRow[] = [
        interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
        pairedFlat("x.txt", 5),
      ];
      const target = { file: "x.txt" as const, subKind: "boundary-top" as const, boundaryRef: "top" as const };
      const plan = planPrimaryAction({
        target,
        preferredSide: "additions",
        flatRowsBefore: rows,
        gapSize: 4,
        boundaryExpansion: ZERO,
      });
      // Plan computes orphan-landing relative to target, not the (irrelevant)
      // pre-click cursor — there's no cursor input at all.
      expect(plan.landing?.lineNumber).toBe(5);
    });
  });
});
