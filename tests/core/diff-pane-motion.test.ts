import { describe, it, expect } from "vitest";
import { step, pageMove } from "../../src/core/diff-pane-motion.js";
import type { PaneState } from "../../src/core/diff-pane-motion.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import { resolveCursorRowIdx } from "../../src/core/cursor-state.js";

function pairedRow(file: string, line: number): FlatRow {
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

function makeRows(file: string, count: number): FlatRow[] {
  const out: FlatRow[] = [];
  for (let i = 1; i <= count; i++) out.push(pairedRow(file, i));
  return out;
}

function cursorAt(row: FlatRow): Cursor {
  if (row.kind !== "diff") throw new Error("expected diff row");
  return {
    file: row.file,
    lineNumber: row.lineNumber,
    side: row.side,
    preferredSide: row.side,
  };
}

const ROW_AT_INDEX = (idx: number): number => idx;

describe("step (down)", () => {
  it("advances the cursor and leaves scrollTop unchanged in the comfort zone", () => {
    const rows = makeRows("x.txt", 30);
    // cursor at row index 8 (line 9). scrollTop=5, viewportHeight=20 → screen y=3.
    // Bottom edge would be row 24 (idx). 24-9=15 rows below cursor. Plenty.
    const state: PaneState = {
      cursor: cursorAt(rows[8]),
      flatRows: rows,
      scrollTop: 5,
      viewportHeight: 20,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(10);
    expect(r.scrollTop).toBe(5);
  });

  it("scrolls one row when crossing into the bottom 3-row margin", () => {
    // viewport=10, scrolloff=3 → bottom margin starts at csy 7.
    // cursor pre-press at idx 6, scrollTop=0 → csy=6 (4 rows from bottom).
    // After j: cursor idx 7, csy=7 → at margin → scroll by 1.
    const rows = makeRows("x.txt", 20);
    const state: PaneState = {
      cursor: cursorAt(rows[6]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(8);
    expect(r.scrollTop).toBe(1);
  });

  it("does not scroll while still 4 rows from the bottom edge", () => {
    // viewport=10, scrolloff=3. cursor pre at idx 5, csy=5.
    // After j: idx 6, csy=6 (4 rows from bottom edge at idx 9). No scroll.
    const rows = makeRows("x.txt", 20);
    const state: PaneState = {
      cursor: cursorAt(rows[5]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(7);
    expect(r.scrollTop).toBe(0);
  });

  it("is a no-op at the last row of flatRows", () => {
    const rows = makeRows("x.txt", 5);
    const state: PaneState = {
      cursor: cursorAt(rows[4]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(5);
    expect(r.scrollTop).toBe(0);
  });

  it("does not scroll when document is shorter than viewport", () => {
    // viewport=10, doc=5 rows, cursor at idx 0. j → idx 1, no scroll.
    const rows = makeRows("x.txt", 5);
    const state: PaneState = {
      cursor: cursorAt(rows[0]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(2);
    expect(r.scrollTop).toBe(0);
  });

  it("is a no-op when only a single eligible row exists", () => {
    const rows = makeRows("x.txt", 1);
    const state: PaneState = {
      cursor: cursorAt(rows[0]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.lineNumber).toBe(1);
    expect(r.scrollTop).toBe(0);
  });

  it("returns null cursor unchanged", () => {
    const rows = makeRows("x.txt", 5);
    const state: PaneState = {
      cursor: null,
      flatRows: rows,
      scrollTop: 3,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor).toBeNull();
    expect(r.scrollTop).toBe(3);
  });
});

describe("step (up)", () => {
  it("advances the cursor and leaves scrollTop unchanged in the comfort zone", () => {
    const rows = makeRows("x.txt", 30);
    // cursor at idx 15, scrollTop=10. csy=5. Top margin is csy<3.
    const state: PaneState = {
      cursor: cursorAt(rows[15]),
      flatRows: rows,
      scrollTop: 10,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "up");
    expect(r.cursor?.lineNumber).toBe(15);
    expect(r.scrollTop).toBe(10);
  });

  it("scrolls one row when crossing into the top 3-row margin", () => {
    // cursor at idx 13, scrollTop=10. csy=3. After k: idx 12, csy=2 → scroll up 1.
    const rows = makeRows("x.txt", 30);
    const state: PaneState = {
      cursor: cursorAt(rows[13]),
      flatRows: rows,
      scrollTop: 10,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "up");
    expect(r.cursor?.lineNumber).toBe(13);
    expect(r.scrollTop).toBe(9);
  });

  it("is a no-op at the first row of flatRows", () => {
    const rows = makeRows("x.txt", 10);
    const state: PaneState = {
      cursor: cursorAt(rows[0]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "up");
    expect(r.cursor?.lineNumber).toBe(1);
    expect(r.scrollTop).toBe(0);
  });

  it("clamps scrollTop to >= 0 when already at top of pane", () => {
    // cursor idx 1, scrollTop=0. csy=1. k → idx 0, csy=0 → would scroll up but clamped.
    const rows = makeRows("x.txt", 10);
    const state: PaneState = {
      cursor: cursorAt(rows[1]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "up");
    expect(r.cursor?.lineNumber).toBe(1);
    expect(r.scrollTop).toBe(0);
  });
});

describe("step preserves preferredSide and screen position invariants", () => {
  it("preserves preferredSide across cross-row motion", () => {
    const rows = makeRows("x.txt", 10);
    const cursor: Cursor = {
      file: "x.txt",
      lineNumber: 3,
      side: "additions",
      preferredSide: "deletions",
    };
    const state: PaneState = {
      cursor,
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 20,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    expect(r.cursor?.preferredSide).toBe("deletions");
  });

  it("scroll-by-one keeps the cursor at the same screen y when in the bottom margin", () => {
    // cursor idx 6, scrollTop=0, viewport=10. csy=6 (just inside comfort).
    // After j: idx 7, scrollTop=1. csy = 7 - 1 = 6. Same screen position.
    const rows = makeRows("x.txt", 20);
    const state: PaneState = {
      cursor: cursorAt(rows[6]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = step(state, "down");
    const newIdx = (r.cursor!.lineNumber - 1);
    expect(newIdx - r.scrollTop).toBe(6);
  });
});

// PRD #126 / issue #129: Space / Shift-Space / PageDown / PageUp page the
// pane by one viewport AND move the cursor with it so its screen-relative
// offset is preserved. Cursor snaps to the nearest cursor-eligible row in
// flatRows. Bumping a document bound (no full viewport of room) lands the
// cursor at the last/first eligible row instead of stranding it mid-pane.
describe("pageMove (down)", () => {
  it("scrolls one viewport down and preserves the cursor's screen-relative offset (comfort zone)", () => {
    // 50 rows, viewport=10. cursor idx 5, scrollTop=0 → csy=5.
    // PageDown: scrollTop → 10, cursor → idx 15 (csy preserved at 5).
    const rows = makeRows("x.txt", 50);
    const state: PaneState = {
      cursor: cursorAt(rows[5]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(10);
    expect(r.cursor?.lineNumber).toBe(16); // idx 15 = lineNumber 16
    const newIdx = resolveCursorRowIdx(r.cursor, rows);
    expect(newIdx - r.scrollTop).toBe(5); // screen-y preserved
  });

  it("preserves screen-relative offset when cursor sits near the top of the pane", () => {
    // viewport=10. cursor idx 1, scrollTop=0 → csy=1.
    // PageDown: scrollTop → 10, cursor → idx 11 (csy=1 preserved).
    const rows = makeRows("x.txt", 50);
    const state: PaneState = {
      cursor: cursorAt(rows[1]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(10);
    expect(r.cursor?.lineNumber).toBe(12);
    expect(resolveCursorRowIdx(r.cursor, rows) - r.scrollTop).toBe(1);
  });

  it("clamps scrollTop at maxScrollTop and lands the cursor on the last row when near the document end", () => {
    // 30 rows, viewport=10 → maxScrollTop = 20.
    // cursor idx 24, scrollTop=15 → csy=9. PageDown desired scrollTop=25
    // → clamped to 20 (delta=5). Cursor snaps to last row (idx 29).
    const rows = makeRows("x.txt", 30);
    const state: PaneState = {
      cursor: cursorAt(rows[24]),
      flatRows: rows,
      scrollTop: 15,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(20);
    expect(r.cursor?.lineNumber).toBe(30); // last row, idx 29
  });

  it("at the bottom edge (already maxScrollTop), still snaps the cursor to the last row", () => {
    // 30 rows, viewport=10, scrollTop=20 (already max). cursor idx 22.
    // PageDown: desired=30, clamped to 20 (no scroll). Cursor → last row.
    const rows = makeRows("x.txt", 30);
    const state: PaneState = {
      cursor: cursorAt(rows[22]),
      flatRows: rows,
      scrollTop: 20,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(20);
    expect(r.cursor?.lineNumber).toBe(30);
  });

  it("is a no-op when document is shorter than viewport", () => {
    const rows = makeRows("x.txt", 5);
    const state: PaneState = {
      cursor: cursorAt(rows[2]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(0);
    expect(r.cursor?.lineNumber).toBe(3); // unchanged
  });

  it("is a no-op when document height equals viewport height", () => {
    const rows = makeRows("x.txt", 10);
    const state: PaneState = {
      cursor: cursorAt(rows[3]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(0);
    expect(r.cursor?.lineNumber).toBe(4);
  });

  it("doc just larger than viewport: scrolls to maxScrollTop and snaps cursor to last row", () => {
    // 11 rows, viewport=10 → maxScrollTop = 1. cursor idx 0, scrollTop=0.
    // PageDown: desired=10, clamped to 1 (delta=1, but clamped). Cursor → last row.
    const rows = makeRows("x.txt", 11);
    const state: PaneState = {
      cursor: cursorAt(rows[0]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.scrollTop).toBe(1);
    expect(r.cursor?.lineNumber).toBe(11);
  });

  it("returns null cursor unchanged", () => {
    const rows = makeRows("x.txt", 50);
    const state: PaneState = {
      cursor: null,
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.cursor).toBeNull();
    expect(r.scrollTop).toBe(0);
  });
});

describe("pageMove (up)", () => {
  it("scrolls one viewport up and preserves the cursor's screen-relative offset (comfort zone)", () => {
    // 50 rows, viewport=10. cursor idx 25, scrollTop=20 → csy=5.
    // PageUp: scrollTop → 10, cursor → idx 15.
    const rows = makeRows("x.txt", 50);
    const state: PaneState = {
      cursor: cursorAt(rows[25]),
      flatRows: rows,
      scrollTop: 20,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "up");
    expect(r.scrollTop).toBe(10);
    expect(r.cursor?.lineNumber).toBe(16);
    expect(resolveCursorRowIdx(r.cursor, rows) - r.scrollTop).toBe(5);
  });

  it("clamps scrollTop at 0 and lands the cursor on the first row near the document start", () => {
    // 30 rows, viewport=10. cursor idx 5, scrollTop=3 → csy=2.
    // PageUp: desired=-7, clamped to 0 (delta=-3). Cursor → first row.
    const rows = makeRows("x.txt", 30);
    const state: PaneState = {
      cursor: cursorAt(rows[5]),
      flatRows: rows,
      scrollTop: 3,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "up");
    expect(r.scrollTop).toBe(0);
    expect(r.cursor?.lineNumber).toBe(1);
  });

  it("at the top edge (already 0), still snaps the cursor to the first row", () => {
    const rows = makeRows("x.txt", 30);
    const state: PaneState = {
      cursor: cursorAt(rows[5]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "up");
    expect(r.scrollTop).toBe(0);
    expect(r.cursor?.lineNumber).toBe(1);
  });

  it("is a no-op when document is shorter than viewport", () => {
    const rows = makeRows("x.txt", 5);
    const state: PaneState = {
      cursor: cursorAt(rows[2]),
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "up");
    expect(r.scrollTop).toBe(0);
    expect(r.cursor?.lineNumber).toBe(3);
  });

  it("preserves preferredSide across page motion", () => {
    const rows = makeRows("x.txt", 50);
    const cursor: Cursor = {
      file: "x.txt",
      lineNumber: 6,
      side: "additions",
      preferredSide: "deletions",
    };
    const state: PaneState = {
      cursor,
      flatRows: rows,
      scrollTop: 0,
      viewportHeight: 10,
      rowY: ROW_AT_INDEX,
      contentHeight: rows.length,
    };
    const r = pageMove(state, "down");
    expect(r.cursor?.preferredSide).toBe("deletions");
  });
});
