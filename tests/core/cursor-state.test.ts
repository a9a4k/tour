import { describe, it, expect } from "vitest";
import {
  initialCursor,
  moveCursor,
  setCursorSide,
  validateCursor,
  resolveCursorRowIdx,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  type Cursor,
} from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import type { Annotation } from "../../src/core/types.js";

function flat(parts: Partial<FlatRow> & Pick<FlatRow, "file" | "lineNumber" | "side">): FlatRow {
  return {
    file: parts.file,
    lineNumber: parts.lineNumber,
    side: parts.side,
    leftLineNumber: parts.leftLineNumber ?? (parts.side === "deletions" ? parts.lineNumber : null),
    rightLineNumber: parts.rightLineNumber ?? (parts.side === "additions" ? parts.lineNumber : null),
    paired: parts.paired ?? false,
  };
}

function pairedFlat(file: string, left: number, right: number): FlatRow {
  return {
    file,
    lineNumber: right,
    side: "additions",
    leftLineNumber: left,
    rightLineNumber: right,
    paired: true,
  };
}

function ann(o: Partial<Annotation> & Pick<Annotation, "id" | "side" | "line_start" | "line_end">): Annotation {
  return {
    id: o.id,
    file: o.file ?? "x.txt",
    side: o.side,
    line_start: o.line_start,
    line_end: o.line_end,
    body: o.body ?? "n",
    author: o.author ?? "agent",
    author_kind: o.author_kind ?? "agent",
    replies_to: o.replies_to,
    created_at: o.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("initialCursor", () => {
  it("returns null when there are no rows", () => {
    expect(initialCursor({ topLevelAnnotations: [], flatRows: [] })).toBeNull();
  });

  it("seeds from the first top-level annotation when one exists and resolves", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      pairedFlat("x.txt", 2, 2),
    ];
    const a = ann({ id: "a1", file: "x.txt", side: "additions", line_start: 2, line_end: 2 });
    const cursor = initialCursor({ topLevelAnnotations: [a], flatRows: rows });
    expect(cursor).toEqual({ file: "x.txt", lineNumber: 2, side: "additions", preferredSide: "additions" });
  });

  it("falls back to the first row when there are no annotations", () => {
    const rows: FlatRow[] = [pairedFlat("x.txt", 5, 5)];
    const cursor = initialCursor({ topLevelAnnotations: [], flatRows: rows });
    expect(cursor).toEqual({ file: "x.txt", lineNumber: 5, side: "additions", preferredSide: "additions" });
  });

  it("falls back to the first row when the top annotation's anchor isn't resolvable", () => {
    const rows: FlatRow[] = [pairedFlat("x.txt", 1, 1)];
    const a = ann({ id: "g", file: "x.txt", side: "additions", line_start: 999, line_end: 999 });
    const cursor = initialCursor({ topLevelAnnotations: [a], flatRows: rows });
    expect(cursor?.lineNumber).toBe(1);
  });

  it("seeds preferredSide from the annotation's side", () => {
    const rows: FlatRow[] = [
      flat({ file: "x.txt", side: "deletions", lineNumber: 7, leftLineNumber: 7, rightLineNumber: null }),
    ];
    const a = ann({ id: "a1", file: "x.txt", side: "deletions", line_start: 7, line_end: 7 });
    const cursor = initialCursor({ topLevelAnnotations: [a], flatRows: rows });
    expect(cursor?.preferredSide).toBe("deletions");
    expect(cursor?.side).toBe("deletions");
  });
});

describe("moveCursor", () => {
  const rows: FlatRow[] = [
    pairedFlat("x.txt", 1, 1),
    pairedFlat("x.txt", 2, 2),
    pairedFlat("x.txt", 3, 3),
  ];

  it("moves down one row", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
    const next = moveCursor(c, "down", rows);
    expect(next?.lineNumber).toBe(2);
  });

  it("moves up one row", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 2, side: "additions", preferredSide: "additions" };
    const next = moveCursor(c, "up", rows);
    expect(next?.lineNumber).toBe(1);
  });

  it("stops at the last row of the flat sequence (stream extremity)", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 3, side: "additions", preferredSide: "additions" };
    const next = moveCursor(c, "down", rows);
    expect(next?.lineNumber).toBe(3);
  });

  it("stops at the first row of the flat sequence (stream extremity)", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
    const next = moveCursor(c, "up", rows);
    expect(next?.lineNumber).toBe(1);
  });

  it("returns null when cursor is null", () => {
    expect(moveCursor(null, "down", rows)).toBeNull();
  });

  it("preserves preferredSide across motion", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" };
    const next = moveCursor(c, "down", rows);
    expect(next?.preferredSide).toBe("deletions");
    // Paired rows honour preferredSide so effective side stays deletions.
    expect(next?.side).toBe("deletions");
    expect(next?.lineNumber).toBe(2);
  });

  it("snaps effective side on a single-side destination row", () => {
    const mixed: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      flat({ file: "x.txt", side: "additions", lineNumber: 2, leftLineNumber: null, rightLineNumber: 2 }),
    ];
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" };
    const next = moveCursor(c, "down", mixed);
    expect(next?.preferredSide).toBe("deletions");
    expect(next?.side).toBe("additions");
    expect(next?.lineNumber).toBe(2);
  });

  describe("cross-file motion", () => {
    const multi: FlatRow[] = [
      pairedFlat("a.txt", 1, 1),
      pairedFlat("a.txt", 2, 2),
      pairedFlat("b.txt", 10, 10),
      pairedFlat("b.txt", 11, 11),
    ];

    it("descends into the next file when pressing down on the last row of file A", () => {
      const c: Cursor = { file: "a.txt", lineNumber: 2, side: "additions", preferredSide: "additions" };
      const next = moveCursor(c, "down", multi);
      expect(next?.file).toBe("b.txt");
      expect(next?.lineNumber).toBe(10);
    });

    it("ascends into the previous file when pressing up on the first row of file B", () => {
      const c: Cursor = { file: "b.txt", lineNumber: 10, side: "additions", preferredSide: "additions" };
      const next = moveCursor(c, "up", multi);
      expect(next?.file).toBe("a.txt");
      expect(next?.lineNumber).toBe(2);
    });

    it("stops at the very first row of the first file (stream extremity)", () => {
      const c: Cursor = { file: "a.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
      const next = moveCursor(c, "up", multi);
      expect(next).toEqual(c);
    });

    it("stops at the very last row of the last file (stream extremity)", () => {
      const c: Cursor = { file: "b.txt", lineNumber: 11, side: "additions", preferredSide: "additions" };
      const next = moveCursor(c, "down", multi);
      expect(next).toEqual(c);
    });

    it("preserves preferredSide across a file boundary", () => {
      const c: Cursor = { file: "a.txt", lineNumber: 2, side: "deletions", preferredSide: "deletions" };
      const next = moveCursor(c, "down", multi);
      expect(next?.file).toBe("b.txt");
      expect(next?.preferredSide).toBe("deletions");
      // Next-file row is paired so preferredSide wins for effective side too.
      expect(next?.side).toBe("deletions");
    });

    it("skips folded files (cursor jumps over them as if they weren't in the list)", () => {
      // Folded files contribute zero rows to flatRows, so c→a.txt#2 + down
      // skips the folded b.txt entirely and lands on the first row of c.txt.
      // The flat-rows builder is responsible for the omission; moveCursor
      // just sees a flat sequence with no b.txt entries.
      const skipping: FlatRow[] = [
        pairedFlat("a.txt", 1, 1),
        pairedFlat("a.txt", 2, 2),
        // b.txt would be here but is folded → omitted
        pairedFlat("c.txt", 5, 5),
      ];
      const c: Cursor = { file: "a.txt", lineNumber: 2, side: "additions", preferredSide: "additions" };
      const next = moveCursor(c, "down", skipping);
      expect(next?.file).toBe("c.txt");
      expect(next?.lineNumber).toBe(5);
    });
  });
});

describe("setCursorSide", () => {
  it("on a paired row, both preferredSide and effective side switch", () => {
    const rows = [pairedFlat("x.txt", 5, 7)];
    const c: Cursor = { file: "x.txt", lineNumber: 7, side: "additions", preferredSide: "additions" };
    const next = setCursorSide(c, "deletions", rows);
    expect(next?.side).toBe("deletions");
    expect(next?.preferredSide).toBe("deletions");
    expect(next?.lineNumber).toBe(5);
  });

  it("on a single-side row, preferredSide updates but effective side is forced", () => {
    const rows: FlatRow[] = [
      flat({ file: "x.txt", side: "additions", lineNumber: 9, leftLineNumber: null, rightLineNumber: 9 }),
    ];
    const c: Cursor = { file: "x.txt", lineNumber: 9, side: "additions", preferredSide: "additions" };
    const next = setCursorSide(c, "deletions", rows);
    expect(next?.preferredSide).toBe("deletions");
    expect(next?.side).toBe("additions");
    expect(next?.lineNumber).toBe(9);
  });

  it("returns null when cursor is null", () => {
    expect(setCursorSide(null, "deletions", [])).toBeNull();
  });

  it("preserves preferredSide across moves after a side change", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 10),
      pairedFlat("x.txt", 2, 11),
      pairedFlat("x.txt", 3, 12),
    ];
    const c: Cursor = { file: "x.txt", lineNumber: 10, side: "additions", preferredSide: "additions" };
    const sided = setCursorSide(c, "deletions", rows);
    expect(sided?.side).toBe("deletions");
    const moved = moveCursor(sided, "down", rows);
    expect(moved?.side).toBe("deletions");
    expect(moved?.lineNumber).toBe(2);
    const moved2 = moveCursor(moved, "down", rows);
    expect(moved2?.side).toBe("deletions");
    expect(moved2?.lineNumber).toBe(3);
  });
});

describe("validateCursor", () => {
  it("returns the cursor unchanged when its anchor still resolves", () => {
    const rows = [pairedFlat("x.txt", 1, 1)];
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
    expect(validateCursor(c, rows)).toEqual(c);
  });

  it("snaps to the file's first row when the anchor is gone but the file remains", () => {
    const rows = [pairedFlat("x.txt", 1, 1), pairedFlat("x.txt", 2, 2)];
    const c: Cursor = { file: "x.txt", lineNumber: 999, side: "additions", preferredSide: "additions" };
    const v = validateCursor(c, rows);
    expect(v?.file).toBe("x.txt");
    expect(v?.lineNumber).toBe(1);
  });

  it("returns null when no rows remain at all", () => {
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
    expect(validateCursor(c, [])).toBeNull();
  });

  it("returns null when the cursor's file has no rows and no files context is given", () => {
    // Without `files` the function can't pick a deterministic neighbour,
    // so it falls through to null. App.tsx always passes files.
    const rows = [pairedFlat("y.txt", 1, 1)];
    const c: Cursor = { file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
    expect(validateCursor(c, rows)).toBeNull();
  });

  it("returns null when input is null", () => {
    expect(validateCursor(null, [pairedFlat("x.txt", 1, 1)])).toBeNull();
  });

  // Issue #105: when the cursor's file becomes folded (`c` on the cursor's
  // file in the sidebar) the row sequence loses every row from that file.
  // validateCursor must snap to the next file in stream order so the cursor
  // never points at an invisible row, falling back to the previous file at
  // the tail and to null when no file in the bundle has any row.
  describe("stream-order snap when cursor's file is gone", () => {
    it("snaps to the first row of the next file in stream order", () => {
      const rows = [pairedFlat("a.txt", 5, 5), pairedFlat("c.txt", 7, 7)];
      const files = [{ name: "a.txt" }, { name: "b.txt" }, { name: "c.txt" }];
      const c: Cursor = { file: "b.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
      const v = validateCursor(c, rows, files);
      expect(v?.file).toBe("c.txt");
      expect(v?.lineNumber).toBe(7);
    });

    it("falls back to the previous file when cursor was at the tail of stream order", () => {
      const rows = [pairedFlat("a.txt", 5, 5)];
      const files = [{ name: "a.txt" }, { name: "b.txt" }];
      const c: Cursor = { file: "b.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
      const v = validateCursor(c, rows, files);
      expect(v?.file).toBe("a.txt");
      expect(v?.lineNumber).toBe(5);
    });

    it("returns null when no other file has rows (every other file folded too)", () => {
      const c: Cursor = { file: "b.txt", lineNumber: 1, side: "additions", preferredSide: "additions" };
      expect(validateCursor(c, [], [{ name: "a.txt" }, { name: "b.txt" }])).toBeNull();
    });

    it("preserves anchor when a sibling (non-cursor) file folds", () => {
      // cursor.file still has rows; b.txt was folded → its rows are absent.
      // The anchor still resolves so validateCursor is a no-op.
      const rows = [pairedFlat("a.txt", 5, 5)];
      const files = [{ name: "a.txt" }, { name: "b.txt" }];
      const c: Cursor = { file: "a.txt", lineNumber: 5, side: "additions", preferredSide: "additions" };
      expect(validateCursor(c, rows, files)).toEqual(c);
    });

    it("preserves preferredSide on the snapped row", () => {
      const rows = [pairedFlat("c.txt", 1, 1)];
      const files = [{ name: "b.txt" }, { name: "c.txt" }];
      const c: Cursor = { file: "b.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" };
      const v = validateCursor(c, rows, files);
      expect(v?.preferredSide).toBe("deletions");
    });
  });
});

// Issue #105: explicit sidebar-driven file selection (mouse click or
// arrow-then-Return) moves the cursor to that file's first annotatable
// row — "show me from the top" per PRD US 20. Folded files have no rows
// and the cursor goes null.
describe("cursorAtFirstFileRow", () => {
  it("returns a cursor on the file's first row in stream order", () => {
    const rows = [
      pairedFlat("x.txt", 5, 7),
      pairedFlat("x.txt", 6, 8),
      pairedFlat("y.txt", 1, 1),
    ];
    expect(cursorAtFirstFileRow("y.txt", rows)).toEqual({
      file: "y.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    });
  });

  it("picks the file's first row, not just any matching row", () => {
    const rows = [
      pairedFlat("x.txt", 5, 7),
      pairedFlat("x.txt", 6, 8),
    ];
    const c = cursorAtFirstFileRow("x.txt", rows);
    expect(c?.lineNumber).toBe(7);
  });

  it("returns null when the file has no rows in the flat sequence (folded, no hunks)", () => {
    const rows = [pairedFlat("x.txt", 1, 1)];
    expect(cursorAtFirstFileRow("y.txt", rows)).toBeNull();
  });

  it("returns null when the flat sequence is empty (snapshot-lost / empty tour)", () => {
    expect(cursorAtFirstFileRow("anything.txt", [])).toBeNull();
  });

  it("preserves the row's natural side on a pure-deletion file row", () => {
    const rows: FlatRow[] = [
      flat({ file: "x.txt", side: "deletions", lineNumber: 5, leftLineNumber: 5, rightLineNumber: null }),
    ];
    const c = cursorAtFirstFileRow("x.txt", rows);
    expect(c?.side).toBe("deletions");
    expect(c?.preferredSide).toBe("deletions");
    expect(c?.lineNumber).toBe(5);
  });
});

// β-coupling per ADR 0011: n/p annotation-nav moves the line cursor to the
// target annotation's anchor. The pure helper computes the cursor; app.tsx
// wires it into the navigation handler.
describe("cursorFromAnnotation", () => {
  it("anchors to the annotation's (file, side, line_start)", () => {
    const a = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "additions",
      line_start: 42,
      line_end: 42,
    });
    expect(cursorFromAnnotation(a)).toEqual({
      file: "src/foo.ts",
      lineNumber: 42,
      side: "additions",
      preferredSide: "additions",
    });
  });

  it("uses line_start (not line_end) for multi-line annotations", () => {
    const a = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "additions",
      line_start: 10,
      line_end: 20,
    });
    expect(cursorFromAnnotation(a).lineNumber).toBe(10);
  });

  it("sets preferredSide to the annotation's side (deletions)", () => {
    const a = ann({
      id: "a1",
      file: "src/foo.ts",
      side: "deletions",
      line_start: 7,
      line_end: 7,
    });
    const c = cursorFromAnnotation(a);
    expect(c.side).toBe("deletions");
    expect(c.preferredSide).toBe("deletions");
  });
});

describe("resolveCursorRowIdx", () => {
  it("locates a paired row by additions-side line number", () => {
    const rows = [pairedFlat("x.txt", 5, 7), pairedFlat("x.txt", 6, 8)];
    const c: Cursor = { file: "x.txt", lineNumber: 8, side: "additions", preferredSide: "additions" };
    expect(resolveCursorRowIdx(c, rows)).toBe(1);
  });

  it("locates a paired row by deletions-side line number", () => {
    const rows = [pairedFlat("x.txt", 5, 7), pairedFlat("x.txt", 6, 8)];
    const c: Cursor = { file: "x.txt", lineNumber: 5, side: "deletions", preferredSide: "deletions" };
    expect(resolveCursorRowIdx(c, rows)).toBe(0);
  });

  it("returns -1 when not resolvable", () => {
    const rows = [pairedFlat("x.txt", 1, 1)];
    const c: Cursor = { file: "x.txt", lineNumber: 99, side: "additions", preferredSide: "additions" };
    expect(resolveCursorRowIdx(c, rows)).toBe(-1);
  });

  it("returns -1 when cursor is null", () => {
    expect(resolveCursorRowIdx(null, [pairedFlat("x.txt", 1, 1)])).toBe(-1);
  });
});
