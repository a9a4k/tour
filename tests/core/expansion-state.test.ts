import { describe, it, expect } from "vitest";
import {
  emptyExpansion,
  expand,
  expandTop,
  expandBottom,
  expandFile,
  expandFileAll,
  seedFromOrphans,
  getBoundary,
  getFileExpanded,
  type BoundaryKey,
  type FileBoundaryGap,
} from "../../src/core/expansion-state.js";

const SEP = (file: string, ref: number | "top" | "bottom"): BoundaryKey => ({ file, ref });

describe("expansion-state", () => {
  describe("initial state", () => {
    it("emptyExpansion() returns an empty map", () => {
      expect(emptyExpansion().size).toBe(0);
    });

    it("getBoundary on empty state returns { up: 0, down: 0 }", () => {
      expect(getBoundary(emptyExpansion(), SEP("x", 1))).toEqual({ up: 0, down: 0 });
    });
  });

  describe("expand (hunk-separator)", () => {
    it("'symmetric-20' adds 10 up + 10 down on a fresh boundary", () => {
      const s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 10, down: 10 });
    });

    it("returns a new state and does not mutate the input", () => {
      const s0 = emptyExpansion();
      const s1 = expand(s0, SEP("x", 1), "symmetric-20", 100);
      expect(s1).not.toBe(s0);
      expect(s0.size).toBe(0);
      expect(s1.size).toBe(1);
    });

    it("repeated 'symmetric-20' Enters keep adding 10+10 until saturation", () => {
      let s = emptyExpansion();
      s = expand(s, SEP("x", 1), "symmetric-20", 50);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 10, down: 10 });
      s = expand(s, SEP("x", 1), "symmetric-20", 50);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 20, down: 20 });
      s = expand(s, SEP("x", 1), "symmetric-20", 50);
      const after3 = getBoundary(s, SEP("x", 1));
      expect(after3.up + after3.down).toBe(50);
      // Saturated; further calls are no-op.
      const s2 = expand(s, SEP("x", 1), "symmetric-20", 50);
      expect(getBoundary(s2, SEP("x", 1))).toEqual(after3);
    });

    it("saturation cap on a 5-line gap reveals only 5 lines total (no negative)", () => {
      const s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 5);
      const b = getBoundary(s, SEP("x", 1));
      expect(b.up + b.down).toBe(5);
      expect(b.up).toBeGreaterThanOrEqual(0);
      expect(b.down).toBeGreaterThanOrEqual(0);
    });

    it("'all' mode reveals the entire gap in one call", () => {
      const s = expand(emptyExpansion(), SEP("x", 1), "all", 30);
      const b = getBoundary(s, SEP("x", 1));
      expect(b.up + b.down).toBe(30);
    });

    it("'all' mode is a silent no-op when already saturated", () => {
      let s = expand(emptyExpansion(), SEP("x", 1), "all", 5);
      const before = getBoundary(s, SEP("x", 1));
      s = expand(s, SEP("x", 1), "all", 5);
      expect(getBoundary(s, SEP("x", 1))).toEqual(before);
    });

    it("partial expand followed by 'all' caps total at gapSize", () => {
      let s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 25);
      s = expand(s, SEP("x", 1), "all", 25);
      const b = getBoundary(s, SEP("x", 1));
      expect(b.up + b.down).toBe(25);
    });

    it("a gap of size 0 is a silent no-op (no negative-line expansion)", () => {
      const s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 0);
      expect(s.size).toBe(0);
    });

    it("treats different `ref` values on the same file as independent boundaries", () => {
      let s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      s = expand(s, SEP("x", 2), "symmetric-20", 100);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 10, down: 10 });
      expect(getBoundary(s, SEP("x", 2))).toEqual({ up: 10, down: 10 });
    });
  });

  describe("expandTop / expandBottom independence", () => {
    it("expandTop only affects the 'top' key", () => {
      const s = expandTop(emptyExpansion(), "x", "symmetric-20", 100);
      expect(getBoundary(s, SEP("x", "top")).up + getBoundary(s, SEP("x", "top")).down).toBe(20);
      expect(getBoundary(s, SEP("x", "bottom"))).toEqual({ up: 0, down: 0 });
      expect(getBoundary(s, SEP("x", 0))).toEqual({ up: 0, down: 0 });
    });

    it("expandBottom only affects the 'bottom' key", () => {
      const s = expandBottom(emptyExpansion(), "x", "symmetric-20", 100);
      const b = getBoundary(s, SEP("x", "bottom"));
      expect(b.up + b.down).toBe(20);
      expect(getBoundary(s, SEP("x", "top"))).toEqual({ up: 0, down: 0 });
    });

    it("expandTop saturates at gapSize", () => {
      const s = expandTop(emptyExpansion(), "x", "symmetric-20", 5);
      const b = getBoundary(s, SEP("x", "top"));
      expect(b.up + b.down).toBe(5);
    });

    it("expandTop 'all' fills the gap", () => {
      const s = expandTop(emptyExpansion(), "x", "all", 12);
      const b = getBoundary(s, SEP("x", "top"));
      expect(b.up + b.down).toBe(12);
    });

    it("expandTop and a numeric expand on the same file are independent", () => {
      let s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      s = expandTop(s, "x", "symmetric-20", 100);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 10, down: 10 });
      const top = getBoundary(s, SEP("x", "top"));
      expect(top.up + top.down).toBe(20);
    });
  });

  describe("seedFromOrphans", () => {
    it("populates boundaries from a single window", () => {
      const s = seedFromOrphans(emptyExpansion(), [
        { file: "x", ref: 1, fromStart: 6, fromEnd: 6 },
      ]);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 6, down: 6 });
    });

    it("merges multiple windows on the same boundary by max-each-side", () => {
      const s = seedFromOrphans(emptyExpansion(), [
        { file: "x", ref: 1, fromStart: 4, fromEnd: 8 },
        { file: "x", ref: 1, fromStart: 7, fromEnd: 5 },
      ]);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 7, down: 8 });
    });

    it("populates separate boundaries for separate files", () => {
      const s = seedFromOrphans(emptyExpansion(), [
        { file: "x", ref: 1, fromStart: 5, fromEnd: 5 },
        { file: "y", ref: 0, fromStart: 3, fromEnd: 3 },
      ]);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 5, down: 5 });
      expect(getBoundary(s, SEP("y", 0))).toEqual({ up: 3, down: 3 });
    });

    it("supports 'top' / 'bottom' refs", () => {
      const s = seedFromOrphans(emptyExpansion(), [
        { file: "x", ref: "top", fromStart: 4, fromEnd: 0 },
        { file: "x", ref: "bottom", fromStart: 0, fromEnd: 4 },
      ]);
      expect(getBoundary(s, SEP("x", "top"))).toEqual({ up: 4, down: 0 });
      expect(getBoundary(s, SEP("x", "bottom"))).toEqual({ up: 0, down: 4 });
    });

    it("preserves prior state on unrelated boundaries", () => {
      let s = expand(emptyExpansion(), SEP("x", 2), "symmetric-20", 100);
      s = seedFromOrphans(s, [{ file: "x", ref: 1, fromStart: 5, fromEnd: 5 }]);
      expect(getBoundary(s, SEP("x", 2))).toEqual({ up: 10, down: 10 });
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 5, down: 5 });
    });

    it("unions with prior user expansion on the SAME boundary (max wins, no clobber)", () => {
      // User Enter-expanded boundary 1 to {up: 10, down: 10}. Watcher
      // reload then re-seeds with a smaller orphan window {fromStart: 4,
      // fromEnd: 6}. The bigger user expansion must survive.
      let s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      s = seedFromOrphans(s, [{ file: "x", ref: 1, fromStart: 4, fromEnd: 6 }]);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 10, down: 10 });
    });

    it("on a same boundary, takes the larger of user expansion and orphan window per side", () => {
      // User expansion {up: 10, down: 10}; orphan window asks for
      // {fromStart: 15, fromEnd: 5}. Per-side max → {up: 15, down: 10}.
      let s = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      s = seedFromOrphans(s, [{ file: "x", ref: 1, fromStart: 15, fromEnd: 5 }]);
      expect(getBoundary(s, SEP("x", 1))).toEqual({ up: 15, down: 10 });
    });

    it("empty windows list returns the input state unchanged", () => {
      const s0 = expand(emptyExpansion(), SEP("x", 1), "symmetric-20", 100);
      const s1 = seedFromOrphans(s0, []);
      expect(s1).toBe(s0);
    });
  });

  describe("expandFile (collapsed-file flip — PRD #108 issue #113)", () => {
    it("flips fileExpanded from false to true on a fresh state", () => {
      const s = expandFile(emptyExpansion(), "x.txt");
      expect(getFileExpanded(s, "x.txt")).toBe(true);
    });

    it("returns a new state and does not mutate the input", () => {
      const s0 = emptyExpansion();
      const s1 = expandFile(s0, "x.txt");
      expect(s1).not.toBe(s0);
      expect(s0.size).toBe(0);
      expect(getFileExpanded(s0, "x.txt")).toBe(false);
    });

    it("is a no-op when already expanded (returns input by reference)", () => {
      const s1 = expandFile(emptyExpansion(), "x.txt");
      const s2 = expandFile(s1, "x.txt");
      expect(s2).toBe(s1);
    });

    it("preserves existing boundaries on the file", () => {
      let s = expand(emptyExpansion(), { file: "x.txt", ref: 1 }, "symmetric-20", 100);
      s = expandFile(s, "x.txt");
      expect(getBoundary(s, { file: "x.txt", ref: 1 })).toEqual({ up: 10, down: 10 });
      expect(getFileExpanded(s, "x.txt")).toBe(true);
    });

    it("only affects the named file", () => {
      const s = expandFile(emptyExpansion(), "x.txt");
      expect(getFileExpanded(s, "y.txt")).toBe(false);
    });

    it("composes with a later expand on a hunk-separator without losing fileExpanded", () => {
      let s = expandFile(emptyExpansion(), "x.txt");
      s = expand(s, { file: "x.txt", ref: 1 }, "symmetric-20", 100);
      expect(getFileExpanded(s, "x.txt")).toBe(true);
      expect(getBoundary(s, { file: "x.txt", ref: 1 })).toEqual({ up: 10, down: 10 });
    });
  });

  describe("expandFileAll (PRD #270 / issue #274 — Slice 4)", () => {
    const G = (ref: number | "top" | "bottom", gapSize: number): FileBoundaryGap => ({
      ref,
      gapSize,
    });

    it("saturates every boundary in the file in one call", () => {
      const s = expandFileAll(emptyExpansion(), "x.ts", [
        G("top", 30),
        G(1, 50),
        G("bottom", 20),
      ]);
      expect(getBoundary(s, { file: "x.ts", ref: "top" })).toEqual({ up: 30, down: 0 });
      expect(getBoundary(s, { file: "x.ts", ref: 1 })).toEqual({
        up: 25,
        down: 25,
      });
      expect(getBoundary(s, { file: "x.ts", ref: "bottom" })).toEqual({ up: 0, down: 20 });
    });

    it("empty boundary list returns the input state by reference (no-op)", () => {
      const s0 = expand(emptyExpansion(), { file: "x.ts", ref: 1 }, "symmetric-20", 100);
      const s1 = expandFileAll(s0, "x.ts", []);
      expect(s1).toBe(s0);
    });

    it("leaves other files unchanged", () => {
      let s = expand(emptyExpansion(), { file: "y.ts", ref: 1 }, "symmetric-20", 100);
      s = expandFileAll(s, "x.ts", [G(1, 30)]);
      expect(getBoundary(s, { file: "y.ts", ref: 1 })).toEqual({ up: 10, down: 10 });
      expect(getBoundary(s, { file: "x.ts", ref: 1 })).toEqual({ up: 15, down: 15 });
    });

    it("composes with prior partial expansion (saturates on top of what's already revealed)", () => {
      let s = expand(emptyExpansion(), { file: "x.ts", ref: 1 }, "symmetric-20", 100);
      s = expandFileAll(s, "x.ts", [G(1, 100), G("top", 50)]);
      const b = getBoundary(s, { file: "x.ts", ref: 1 });
      expect(b.up + b.down).toBe(100);
      expect(getBoundary(s, { file: "x.ts", ref: "top" })).toEqual({ up: 50, down: 0 });
    });

    it("preserves fileExpanded flag on the file", () => {
      let s = expandFile(emptyExpansion(), "x.ts");
      s = expandFileAll(s, "x.ts", [G(1, 30)]);
      expect(getFileExpanded(s, "x.ts")).toBe(true);
      expect(getBoundary(s, { file: "x.ts", ref: 1 })).toEqual({ up: 15, down: 15 });
    });

    it("is a no-op when all boundaries are already saturated (same state ref)", () => {
      const s0 = expandFileAll(emptyExpansion(), "x.ts", [G(1, 10), G("top", 5)]);
      const s1 = expandFileAll(s0, "x.ts", [G(1, 10), G("top", 5)]);
      expect(s1).toBe(s0);
    });

    it("returns the input state when every gapSize is zero (no-op)", () => {
      const s0 = emptyExpansion();
      const s1 = expandFileAll(s0, "x.ts", [G(1, 0), G("top", 0)]);
      expect(s1).toBe(s0);
    });

    it("after dispatch, every gap is saturated so the directional rows would be gone", () => {
      // Reflects AC: "After dispatch, all expand-up / expand-down / expand-all
      // rows for the file are gone from the planner output (because every gap
      // is now zero-sized)." The planner key is gapSize - up - down ≤ 0.
      const s = expandFileAll(emptyExpansion(), "x.ts", [
        G("top", 12),
        G(1, 42),
        G(2, 7),
        G("bottom", 31),
      ]);
      const refs: Array<{ ref: BoundaryKey["ref"]; gapSize: number }> = [
        { ref: "top", gapSize: 12 },
        { ref: 1, gapSize: 42 },
        { ref: 2, gapSize: 7 },
        { ref: "bottom", gapSize: 31 },
      ];
      for (const r of refs) {
        const b = getBoundary(s, { file: "x.ts", ref: r.ref });
        expect(b.up + b.down).toBe(r.gapSize);
      }
    });
  });

  describe("invariants", () => {
    it("up + down never exceeds gapSize across many random expand calls", () => {
      let s = emptyExpansion();
      for (let i = 0; i < 50; i++) {
        s = expand(s, SEP("x", 1), "symmetric-20", 25);
      }
      const b = getBoundary(s, SEP("x", 1));
      expect(b.up + b.down).toBeLessThanOrEqual(25);
    });

    it("up and down are always non-negative", () => {
      let s = emptyExpansion();
      for (const m of ["symmetric-20", "all"] as const) {
        s = expand(s, SEP("x", 1), m, 5);
      }
      const b = getBoundary(s, SEP("x", 1));
      expect(b.up).toBeGreaterThanOrEqual(0);
      expect(b.down).toBeGreaterThanOrEqual(0);
    });
  });
});
