import { describe, it, expect } from "vitest";
import {
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  preferredSideOf,
  setCursorSide,
  validateCursor,
  resolveCursorRowIdx,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  cursorOnInteractive,
  cursorAfterExpand,
  isRowAnchor,
  isCardAnchor,
  type Cursor,
  type RowAnchor,
  type CardAnchor,
} from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import type { Annotation } from "../../src/core/types.js";

function flat(parts: {
  file: string;
  lineNumber: number;
  side: "additions" | "deletions";
  leftLineNumber?: number | null;
  rightLineNumber?: number | null;
  paired?: boolean;
}): FlatRow {
  return {
    kind: "diff",
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
    kind: "diff",
    file,
    lineNumber: right,
    side: "additions",
    leftLineNumber: left,
    rightLineNumber: right,
    paired: true,
  };
}

function interactiveFlat(parts: {
  file: string;
  subKind: "hunk-separator" | "boundary-top" | "collapsed-file";
  boundaryRef: number | "top" | "bottom";
}): FlatRow {
  return {
    kind: "interactive",
    file: parts.file,
    subKind: parts.subKind,
    boundaryRef: parts.boundaryRef,
  };
}

function cardFlat(parts: {
  file: string;
  side: "additions" | "deletions";
  lineEnd: number;
  annotationId: string;
}): FlatRow {
  return {
    kind: "card",
    file: parts.file,
    side: parts.side,
    lineEnd: parts.lineEnd,
    annotationId: parts.annotationId,
  };
}

function row(c: Partial<RowAnchor> & Pick<RowAnchor, "file" | "lineNumber" | "side" | "preferredSide">): RowAnchor {
  return { kind: "row", ...c };
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

  it("seeds a CardAnchor on the first top-level annotation when its card row is in the stream (PRD #192)", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      pairedFlat("x.txt", 2, 2),
      cardFlat({ file: "x.txt", side: "additions", lineEnd: 2, annotationId: "a1" }),
    ];
    const a = ann({ id: "a1", file: "x.txt", side: "additions", line_start: 2, line_end: 2 });
    const cursor = initialCursor({ topLevelAnnotations: [a], flatRows: rows });
    expect(cursor).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
  });

  it("falls back to the first diff row when there are no annotations", () => {
    const rows: FlatRow[] = [pairedFlat("x.txt", 5, 5)];
    const cursor = initialCursor({ topLevelAnnotations: [], flatRows: rows });
    expect(cursor).toEqual(row({ file: "x.txt", lineNumber: 5, side: "additions", preferredSide: "additions" }));
  });

  it("falls back to the first diff row when the top annotation's card row isn't in the flat stream", () => {
    // Card row missing (e.g., card row emission disabled or annotation
    // pointed at a missing anchor). The fallback is the first diff row.
    const rows: FlatRow[] = [pairedFlat("x.txt", 1, 1)];
    const a = ann({ id: "g", file: "x.txt", side: "additions", line_start: 999, line_end: 999 });
    const cursor = initialCursor({ topLevelAnnotations: [a], flatRows: rows });
    expect(cursor?.kind).toBe("row");
    if (cursor?.kind !== "row") throw new Error("narrow");
    expect(cursor.lineNumber).toBe(1);
  });
});

describe("moveCursor", () => {
  const rows: FlatRow[] = [
    pairedFlat("x.txt", 1, 1),
    pairedFlat("x.txt", 2, 2),
    pairedFlat("x.txt", 3, 3),
  ];

  it("moves down one row", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    const next = moveCursor(c, "down", rows);
    expect(isRowAnchor(next) && next.lineNumber).toBe(2);
  });

  it("moves up one row", () => {
    const c = row({ file: "x.txt", lineNumber: 2, side: "additions", preferredSide: "additions" });
    const next = moveCursor(c, "up", rows);
    expect(isRowAnchor(next) && next.lineNumber).toBe(1);
  });

  it("stops at the last row of the flat sequence (stream extremity)", () => {
    const c = row({ file: "x.txt", lineNumber: 3, side: "additions", preferredSide: "additions" });
    const next = moveCursor(c, "down", rows);
    expect(isRowAnchor(next) && next.lineNumber).toBe(3);
  });

  it("stops at the first row of the flat sequence (stream extremity)", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    const next = moveCursor(c, "up", rows);
    expect(isRowAnchor(next) && next.lineNumber).toBe(1);
  });

  it("returns null when cursor is null", () => {
    expect(moveCursor(null, "down", rows)).toBeNull();
  });

  it("preserves preferredSide across motion", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" });
    const next = moveCursor(c, "down", rows);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.preferredSide).toBe("deletions");
    expect(next.side).toBe("deletions");
    expect(next.lineNumber).toBe(2);
  });

  it("snaps effective side on a single-side destination row", () => {
    const mixed: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      flat({ file: "x.txt", side: "additions", lineNumber: 2, leftLineNumber: null, rightLineNumber: 2 }),
    ];
    const c = row({ file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" });
    const next = moveCursor(c, "down", mixed);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.preferredSide).toBe("deletions");
    expect(next.side).toBe("additions");
    expect(next.lineNumber).toBe(2);
  });

  // Step/jump model (ADR 0023, supersedes ADR 0022's two-lane rule;
  // issue #200). `j`/`k` is the step gesture — one row per press, no
  // destination filter. Cards are valid stops; the cursor lands ON a
  // card when stepping onto it, then steps off on the next press.
  describe("row lane is the STEP gesture (ADR 0023 / issue #200)", () => {
    it("`j` from a diff row whose line_end matches an annotation's anchor lands ON the card", () => {
      // Bug repro per the issue: cursor on the anchor row, press j,
      // expected to land on the card, not skip past it.
      const mixed: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
        pairedFlat("x.txt", 2, 2),
      ];
      const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "down", mixed);
      expect(next).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
    });

    it("`j` from a CardAnchor steps to the next row after the card", () => {
      const mixed: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
        pairedFlat("x.txt", 2, 2),
      ];
      const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
      const next = moveCursor(c, "down", mixed);
      if (!isRowAnchor(next)) throw new Error("narrow");
      expect(next.lineNumber).toBe(2);
    });

    it("`k` from a row preceded by a card lands ON the card", () => {
      const mixed: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
        pairedFlat("x.txt", 2, 2),
      ];
      const c = row({ file: "x.txt", lineNumber: 2, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "up", mixed);
      expect(next).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
    });

    it("stacked cards each count as a step: anchor → first card → second card → next row", () => {
      const mixed: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a2" }),
        pairedFlat("x.txt", 2, 2),
      ];
      const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      const s1 = moveCursor(c, "down", mixed);
      expect(s1).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
      const s2 = moveCursor(s1, "down", mixed);
      expect(s2).toEqual({ kind: "card", annotationId: "a2", preferredSide: "additions" });
      const s3 = moveCursor(s2, "down", mixed);
      if (!isRowAnchor(s3)) throw new Error("narrow");
      expect(s3.lineNumber).toBe(2);
    });

    it("preserves preferredSide across step-into-card and step-out-of-card", () => {
      // Issue #200 AC: after `h` setting preferredSide: "deletions",
      // two `j` presses (row → card → next row) keep preferredSide
      // "deletions" so the second row landing honours the side choice.
      const mixed: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
        pairedFlat("x.txt", 2, 2),
      ];
      const c = row({ file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" });
      const onCard = moveCursor(c, "down", mixed);
      if (onCard?.kind !== "card") throw new Error("narrow");
      expect(onCard.preferredSide).toBe("deletions");
      const offCard = moveCursor(onCard, "down", mixed);
      if (!isRowAnchor(offCard)) throw new Error("narrow");
      expect(offCard.preferredSide).toBe("deletions");
      expect(offCard.side).toBe("deletions");
      expect(offCard.lineNumber).toBe(2);
    });
  });

  describe("cross-file motion", () => {
    const multi: FlatRow[] = [
      pairedFlat("a.txt", 1, 1),
      pairedFlat("a.txt", 2, 2),
      pairedFlat("b.txt", 10, 10),
      pairedFlat("b.txt", 11, 11),
    ];

    it("descends into the next file when pressing down on the last row of file A", () => {
      const c = row({ file: "a.txt", lineNumber: 2, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "down", multi);
      if (!isRowAnchor(next)) throw new Error("narrow");
      expect(next.file).toBe("b.txt");
      expect(next.lineNumber).toBe(10);
    });

    it("ascends into the previous file when pressing up on the first row of file B", () => {
      const c = row({ file: "b.txt", lineNumber: 10, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "up", multi);
      if (!isRowAnchor(next)) throw new Error("narrow");
      expect(next.file).toBe("a.txt");
      expect(next.lineNumber).toBe(2);
    });

    it("stops at the very first row of the first file (stream extremity)", () => {
      const c = row({ file: "a.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "up", multi);
      expect(next).toEqual(c);
    });

    it("stops at the very last row of the last file (stream extremity)", () => {
      const c = row({ file: "b.txt", lineNumber: 11, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "down", multi);
      expect(next).toEqual(c);
    });

    it("preserves preferredSide across a file boundary", () => {
      const c = row({ file: "a.txt", lineNumber: 2, side: "deletions", preferredSide: "deletions" });
      const next = moveCursor(c, "down", multi);
      if (!isRowAnchor(next)) throw new Error("narrow");
      expect(next.file).toBe("b.txt");
      expect(next.preferredSide).toBe("deletions");
      expect(next.side).toBe("deletions");
    });

    it("skips folded files (cursor jumps over them as if they weren't in the list)", () => {
      const skipping: FlatRow[] = [
        pairedFlat("a.txt", 1, 1),
        pairedFlat("a.txt", 2, 2),
        pairedFlat("c.txt", 5, 5),
      ];
      const c = row({ file: "a.txt", lineNumber: 2, side: "additions", preferredSide: "additions" });
      const next = moveCursor(c, "down", skipping);
      if (!isRowAnchor(next)) throw new Error("narrow");
      expect(next.file).toBe("c.txt");
      expect(next.lineNumber).toBe(5);
    });
  });
});

// Card lane walker (PRD #192 / ADR 0022; reordering fix issue #197).
// `n`/`p` is the **jump** gesture (ADR 0023) and walks the canonical
// top-level Annotation order — the same order the `[N/M]` pill counter
// reads — NOT flat-row display order (#197). From a null cursor or a
// RowAnchor the walk enters the track at the topLevel edge; the cursor's
// `(file, line)` is **not** consulted (issue #206 revert of #203).
describe("nextCard / prevCard (PRD #192, issue #197)", () => {
  const a1 = ann({ id: "a1", file: "x.txt", side: "additions", line_start: 1, line_end: 1 });
  const a2 = ann({ id: "a2", file: "x.txt", side: "additions", line_start: 2, line_end: 2 });
  const topLevel = [a1, a2];

  it("nextCard from a row cursor enters the track at the first top-level annotation", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "deletions" });
    expect(nextCard(c, topLevel)).toEqual({ kind: "card", annotationId: "a1", preferredSide: "deletions" });
  });

  it("nextCard from a card cursor lands on the following card in top-level order", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    expect(nextCard(c, topLevel)).toEqual({ kind: "card", annotationId: "a2", preferredSide: "additions" });
  });

  it("nextCard from the last card returns null", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a2", preferredSide: "additions" };
    expect(nextCard(c, topLevel)).toBeNull();
  });

  it("prevCard from a card cursor lands on the preceding card in top-level order", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a2", preferredSide: "additions" };
    expect(prevCard(c, topLevel)).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
  });

  it("prevCard from the first card returns null", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    expect(prevCard(c, topLevel)).toBeNull();
  });

  it("nextCard from a null cursor picks the first top-level annotation", () => {
    expect(nextCard(null, topLevel)).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
  });

  it("prevCard from a null cursor picks the last top-level annotation", () => {
    expect(prevCard(null, topLevel)).toEqual({ kind: "card", annotationId: "a2", preferredSide: "additions" });
  });

  it("nextCard preserves a card cursor's preferredSide on the destination CardAnchor (issue #200)", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "deletions" };
    expect(nextCard(c, topLevel)).toEqual({ kind: "card", annotationId: "a2", preferredSide: "deletions" });
  });

  it("returns null when there are no top-level annotations", () => {
    expect(nextCard(null, [])).toBeNull();
    expect(prevCard(null, [])).toBeNull();
  });

  // Bug A repro (issue #197): a Tour whose JSONL `created_at` order
  // disagrees with file display order — e.g., annotation `aFirst` was
  // authored first (top of the topLevel list, pill `1/3`) but anchors
  // to the last file in display order. The walker must follow the
  // top-level order, so `n` from `1/3` lands on `2/3`, not on whichever
  // card happens to be earliest in flat-row position.
  it("nextCard tracks top-level order even when flat-row order disagrees (issue #197)", () => {
    const aFirst = ann({
      id: "aFirst",
      file: "z.txt",
      side: "additions",
      line_start: 1,
      line_end: 1,
      created_at: "2026-01-01T00:00:00Z",
    });
    const aSecond = ann({
      id: "aSecond",
      file: "a.txt",
      side: "additions",
      line_start: 1,
      line_end: 1,
      created_at: "2026-02-01T00:00:00Z",
    });
    const aThird = ann({
      id: "aThird",
      file: "m.txt",
      side: "additions",
      line_start: 1,
      line_end: 1,
      created_at: "2026-03-01T00:00:00Z",
    });
    // Top-level order (JSONL / created_at): aFirst, aSecond, aThird.
    const topLevelMixed = [aFirst, aSecond, aThird];
    const c1: CardAnchor = { kind: "card", annotationId: "aFirst", preferredSide: "additions" };
    expect(nextCard(c1, topLevelMixed)).toEqual({ kind: "card", annotationId: "aSecond", preferredSide: "additions" });
    const c2: CardAnchor = { kind: "card", annotationId: "aSecond", preferredSide: "additions" };
    expect(nextCard(c2, topLevelMixed)).toEqual({ kind: "card", annotationId: "aThird", preferredSide: "additions" });
    const c3: CardAnchor = { kind: "card", annotationId: "aThird", preferredSide: "additions" };
    expect(nextCard(c3, topLevelMixed)).toBeNull();
    expect(prevCard(c3, topLevelMixed)).toEqual({ kind: "card", annotationId: "aSecond", preferredSide: "additions" });
    expect(prevCard(c2, topLevelMixed)).toEqual({ kind: "card", annotationId: "aFirst", preferredSide: "additions" });
  });

  // Stale CardAnchor (id not in topLevel): same as null cursor. The
  // validation policy clears the cursor on the next render independently.
  it("stale CardAnchor (annotation removed from top-level) falls back to the topLevel edge (issue #206)", () => {
    const ghost: CardAnchor = { kind: "card", annotationId: "ghost", preferredSide: "deletions" };
    expect(nextCard(ghost, topLevel)).toEqual({ kind: "card", annotationId: "a1", preferredSide: "deletions" });
    expect(prevCard(ghost, topLevel)).toEqual({ kind: "card", annotationId: "a2", preferredSide: "deletions" });
  });

  // Issue #206: from a RowAnchor, n/p is a pure topLevel-order gesture —
  // the cursor's (file, lineNumber) is not consulted. Pressing `n` from
  // any row enters the track at topLevel[0]; pressing `p` enters at the
  // last topLevel entry. Subsequent presses step by topLevel index.
  describe("row cursor position is not consulted (issue #206)", () => {
    const ann1 = ann({ id: "ann1", file: "SKILL.md", side: "additions", line_start: 3, line_end: 21 });
    const ann2 = ann({ id: "ann2", file: "SKILL.md", side: "additions", line_start: 30, line_end: 35 });
    const tl = [ann1, ann2];

    it("nextCard from a row past the last annotation still enters at topLevel[0]", () => {
      const c = row({ file: "SKILL.md", lineNumber: 99, side: "additions", preferredSide: "additions" });
      expect(nextCard(c, tl)).toEqual({ kind: "card", annotationId: "ann1", preferredSide: "additions" });
    });

    it("prevCard from a row before the first annotation still enters at topLevel[last]", () => {
      const c = row({ file: "SKILL.md", lineNumber: 1, side: "additions", preferredSide: "additions" });
      expect(prevCard(c, tl)).toEqual({ kind: "card", annotationId: "ann2", preferredSide: "additions" });
    });

    it("nextCard from a row threads preferredSide onto the destination card", () => {
      const c = row({ file: "SKILL.md", lineNumber: 22, side: "deletions", preferredSide: "deletions" });
      expect(nextCard(c, tl)).toEqual({ kind: "card", annotationId: "ann1", preferredSide: "deletions" });
    });

    it("nextCard from a row in a different file from any annotation enters at topLevel[0]", () => {
      const c = row({ file: "other.txt", lineNumber: 5, side: "additions", preferredSide: "additions" });
      expect(nextCard(c, tl)).toEqual({ kind: "card", annotationId: "ann1", preferredSide: "additions" });
      expect(prevCard(c, tl)).toEqual({ kind: "card", annotationId: "ann2", preferredSide: "additions" });
    });
  });
});

describe("setCursorSide", () => {
  it("on a paired row, both preferredSide and effective side switch", () => {
    const rows = [pairedFlat("x.txt", 5, 7)];
    const c = row({ file: "x.txt", lineNumber: 7, side: "additions", preferredSide: "additions" });
    const next = setCursorSide(c, "deletions", rows);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.side).toBe("deletions");
    expect(next.preferredSide).toBe("deletions");
    expect(next.lineNumber).toBe(5);
  });

  it("on a single-side row, preferredSide updates but effective side is forced", () => {
    const rows: FlatRow[] = [
      flat({ file: "x.txt", side: "additions", lineNumber: 9, leftLineNumber: null, rightLineNumber: 9 }),
    ];
    const c = row({ file: "x.txt", lineNumber: 9, side: "additions", preferredSide: "additions" });
    const next = setCursorSide(c, "deletions", rows);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.preferredSide).toBe("deletions");
    expect(next.side).toBe("additions");
    expect(next.lineNumber).toBe(9);
  });

  it("returns null when cursor is null", () => {
    expect(setCursorSide(null, "deletions", [])).toBeNull();
  });

  it("on a card cursor, returns the cursor unchanged (h/l is a no-op on cards)", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    const rows: FlatRow[] = [cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" })];
    expect(setCursorSide(c, "deletions", rows)).toBe(c);
  });

  it("preserves preferredSide across moves after a side change", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 10),
      pairedFlat("x.txt", 2, 11),
      pairedFlat("x.txt", 3, 12),
    ];
    const c = row({ file: "x.txt", lineNumber: 10, side: "additions", preferredSide: "additions" });
    const sided = setCursorSide(c, "deletions", rows);
    if (!isRowAnchor(sided)) throw new Error("narrow");
    expect(sided.side).toBe("deletions");
    const moved = moveCursor(sided, "down", rows);
    if (!isRowAnchor(moved)) throw new Error("narrow");
    expect(moved.side).toBe("deletions");
    expect(moved.lineNumber).toBe(2);
    const moved2 = moveCursor(moved, "down", rows);
    if (!isRowAnchor(moved2)) throw new Error("narrow");
    expect(moved2.side).toBe("deletions");
    expect(moved2.lineNumber).toBe(3);
  });
});

describe("validateCursor", () => {
  it("returns the cursor unchanged when its anchor still resolves", () => {
    const rows = [pairedFlat("x.txt", 1, 1)];
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    expect(validateCursor(c, rows)).toEqual(c);
  });

  it("snaps to the file's first row when the anchor is gone but the file remains", () => {
    const rows = [pairedFlat("x.txt", 1, 1), pairedFlat("x.txt", 2, 2)];
    const c = row({ file: "x.txt", lineNumber: 999, side: "additions", preferredSide: "additions" });
    const v = validateCursor(c, rows);
    if (!isRowAnchor(v)) throw new Error("narrow");
    expect(v.file).toBe("x.txt");
    expect(v.lineNumber).toBe(1);
  });

  it("returns null when no rows remain at all", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    expect(validateCursor(c, [])).toBeNull();
  });

  it("returns null when the cursor's file has no rows and no files context is given", () => {
    const rows = [pairedFlat("y.txt", 1, 1)];
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    expect(validateCursor(c, rows)).toBeNull();
  });

  it("returns null when input is null", () => {
    expect(validateCursor(null, [pairedFlat("x.txt", 1, 1)])).toBeNull();
  });

  // Reconciled snap policy (issue #232): when the cursor's file is in
  // `files` (the bundle) but has no rows in the flat-row stream, the
  // anchor is preserved unchanged. This replaces the prior walk-to-next-
  // file fallback so that folding the cursor's file no longer jumps the
  // anchor away — uncollapsing restores it in place. When the file isn't
  // in `files` at all, the anchor still clears to null (file genuinely
  // removed from the bundle).
  describe("file in bundle but currently no rows (folded)", () => {
    it("preserves the anchor when cursor's file is in `files` but has no rows", () => {
      const rows = [pairedFlat("a.txt", 5, 5), pairedFlat("c.txt", 7, 7)];
      const files = [{ name: "a.txt" }, { name: "b.txt" }, { name: "c.txt" }];
      const c = row({ file: "b.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      expect(validateCursor(c, rows, files)).toEqual(c);
    });

    it("preserves the anchor when only the cursor's file is in `files` but every file is folded", () => {
      const c = row({ file: "b.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      expect(
        validateCursor(c, [], [{ name: "a.txt" }, { name: "b.txt" }]),
      ).toEqual(c);
    });

    it("clears the anchor when cursor's file is not in `files` (file removed from bundle)", () => {
      const rows = [pairedFlat("a.txt", 5, 5)];
      const files = [{ name: "a.txt" }];
      const c = row({ file: "gone.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
      expect(validateCursor(c, rows, files)).toBeNull();
    });

    it("preserves anchor when a sibling (non-cursor) file folds", () => {
      const rows = [pairedFlat("a.txt", 5, 5)];
      const files = [{ name: "a.txt" }, { name: "b.txt" }];
      const c = row({ file: "a.txt", lineNumber: 5, side: "additions", preferredSide: "additions" });
      expect(validateCursor(c, rows, files)).toEqual(c);
    });

    it("preserves preferredSide on a preserved anchor", () => {
      const rows = [pairedFlat("c.txt", 1, 1)];
      const files = [{ name: "b.txt" }, { name: "c.txt" }];
      const c = row({ file: "b.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" });
      const v = validateCursor(c, rows, files);
      if (!isRowAnchor(v)) throw new Error("narrow");
      expect(v.preferredSide).toBe("deletions");
      expect(v.file).toBe("b.txt");
    });
  });

  // PRD #192 / ADR 0022: a CardAnchor survives bundle reload when its
  // annotationId is still in the flat-row stream; clears to null
  // otherwise. No "snap to file's first row" fallback for cards — the
  // card stop is unambiguous or gone.
  describe("CardAnchor survival across reload (PRD #192)", () => {
    it("preserves a CardAnchor whose annotationId is still in the flat-row stream", () => {
      const rows: FlatRow[] = [
        pairedFlat("x.txt", 1, 1),
        cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
      ];
      const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
      expect(validateCursor(c, rows)).toBe(c);
    });

    it("returns null when the CardAnchor's id is no longer in the stream", () => {
      const rows: FlatRow[] = [pairedFlat("x.txt", 1, 1)];
      const c: CardAnchor = { kind: "card", annotationId: "gone", preferredSide: "additions" };
      expect(validateCursor(c, rows)).toBeNull();
    });

    it("returns null on empty flatRows even for a CardAnchor", () => {
      const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
      expect(validateCursor(c, [])).toBeNull();
    });
  });
});

describe("cursorAtFirstFileRow", () => {
  it("returns a cursor on the file's first row in stream order", () => {
    const rows = [
      pairedFlat("x.txt", 5, 7),
      pairedFlat("x.txt", 6, 8),
      pairedFlat("y.txt", 1, 1),
    ];
    expect(cursorAtFirstFileRow("y.txt", rows)).toEqual(row({
      file: "y.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    }));
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

// PRD #192 / ADR 0022 (revised by ADR 0023, issue #200):
// cursorFromAnnotation returns a CardAnchor carrying preferredSide so
// the side choice survives jumps.
describe("cursorFromAnnotation", () => {
  it("returns a CardAnchor pointing at the annotation's id, default preferredSide additions", () => {
    const a = ann({ id: "a1", file: "src/foo.ts", side: "additions", line_start: 42, line_end: 42 });
    expect(cursorFromAnnotation(a)).toEqual({ kind: "card", annotationId: "a1", preferredSide: "additions" });
  });

  it("threads an explicit preferredSide onto the CardAnchor (issue #200)", () => {
    const a = ann({ id: "a1", file: "src/foo.ts", side: "additions", line_start: 42, line_end: 42 });
    expect(cursorFromAnnotation(a, "deletions")).toEqual({
      kind: "card",
      annotationId: "a1",
      preferredSide: "deletions",
    });
  });

  it("preserves the annotationId verbatim across multi-line ranges", () => {
    const a = ann({ id: "weirdId", file: "src/foo.ts", side: "additions", line_start: 10, line_end: 20 });
    expect(cursorFromAnnotation(a).annotationId).toBe("weirdId");
  });
});

describe("resolveCursorRowIdx", () => {
  it("locates a paired row by additions-side line number", () => {
    const rows = [pairedFlat("x.txt", 5, 7), pairedFlat("x.txt", 6, 8)];
    const c = row({ file: "x.txt", lineNumber: 8, side: "additions", preferredSide: "additions" });
    expect(resolveCursorRowIdx(c, rows)).toBe(1);
  });

  it("locates a paired row by deletions-side line number", () => {
    const rows = [pairedFlat("x.txt", 5, 7), pairedFlat("x.txt", 6, 8)];
    const c = row({ file: "x.txt", lineNumber: 5, side: "deletions", preferredSide: "deletions" });
    expect(resolveCursorRowIdx(c, rows)).toBe(0);
  });

  it("returns -1 when not resolvable", () => {
    const rows = [pairedFlat("x.txt", 1, 1)];
    const c = row({ file: "x.txt", lineNumber: 99, side: "additions", preferredSide: "additions" });
    expect(resolveCursorRowIdx(c, rows)).toBe(-1);
  });

  it("returns -1 when cursor is null", () => {
    expect(resolveCursorRowIdx(null, [pairedFlat("x.txt", 1, 1)])).toBe(-1);
  });

  it("resolves a CardAnchor by annotationId match against a card flat row", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      cardFlat({ file: "x.txt", side: "additions", lineEnd: 1, annotationId: "a1" }),
    ];
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    expect(resolveCursorRowIdx(c, rows)).toBe(1);
  });
});

// preferredSideOf reads cursor.preferredSide for BOTH RowAnchor and
// CardAnchor (ADR 0023 / issue #200). The "additions" fallback fires
// only for null cursors.
describe("preferredSideOf (issue #200)", () => {
  it("reads a RowAnchor's preferredSide", () => {
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "deletions" });
    expect(preferredSideOf(c)).toBe("deletions");
  });

  it("reads a CardAnchor's preferredSide", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "deletions" };
    expect(preferredSideOf(c)).toBe("deletions");
  });

  it("falls back to additions only when the cursor is null", () => {
    expect(preferredSideOf(null)).toBe("additions");
  });
});

describe("type guards", () => {
  it("isRowAnchor narrows correctly", () => {
    const r = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    expect(isRowAnchor(r)).toBe(true);
    expect(isRowAnchor(null)).toBe(false);
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    expect(isRowAnchor(c)).toBe(false);
  });

  it("isCardAnchor narrows correctly", () => {
    const c: CardAnchor = { kind: "card", annotationId: "a1", preferredSide: "additions" };
    expect(isCardAnchor(c)).toBe(true);
    expect(isCardAnchor(null)).toBe(false);
    const r = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    expect(isCardAnchor(r)).toBe(false);
  });
});

// ADR 0013 / PRD #107: cursor walks interactive rows alongside diff rows.
describe("interactive-row cursor support (PRD #107)", () => {
  it("moveCursor lands on an interactive row in the stream", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("x.txt", 2, 2),
    ];
    const c = row({ file: "x.txt", lineNumber: 1, side: "additions", preferredSide: "additions" });
    const next = moveCursor(c, "down", rows);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.interactive).toBeDefined();
    expect(next.interactive?.subKind).toBe("hunk-separator");
    expect(next.interactive?.boundaryRef).toBe(1);
    expect(next.file).toBe("x.txt");
  });

  it("moveCursor leaves an interactive row back onto a diff row", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("x.txt", 5, 5),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "hunk-separator",
      boundaryRef: 1,
    });
    const next = moveCursor(c, "down", rows);
    if (!isRowAnchor(next)) throw new Error("narrow");
    expect(next.interactive).toBeUndefined();
    expect(next.lineNumber).toBe(5);
  });

  it("moveCursor preserves preferredSide across a diff→interactive→diff hop", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("x.txt", 2, 2),
    ];
    const c = row({ file: "x.txt", lineNumber: 1, side: "deletions", preferredSide: "deletions" });
    const onInteractive = moveCursor(c, "down", rows);
    if (!isRowAnchor(onInteractive)) throw new Error("narrow");
    expect(onInteractive.preferredSide).toBe("deletions");
    const back = moveCursor(onInteractive, "down", rows);
    if (!isRowAnchor(back)) throw new Error("narrow");
    expect(back.preferredSide).toBe("deletions");
    expect(back.side).toBe("deletions");
  });

  it("setCursorSide is a no-op on interactive rows (preferredSide preserved)", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 0 }),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "hunk-separator",
      boundaryRef: 0,
      preferredSide: "additions",
    });
    expect(setCursorSide(c, "deletions", rows)).toBe(c);
  });

  it("validateCursor preserves an interactive anchor when its boundary still resolves", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "boundary-top",
      boundaryRef: "top",
    });
    expect(validateCursor(c, rows)).toBe(c);
  });

  it("validateCursor snaps interactive cursor to file's first row when its boundary is gone", () => {
    const rows: FlatRow[] = [pairedFlat("x.txt", 1, 1)];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "hunk-separator",
      boundaryRef: 7,
    });
    const v = validateCursor(c, rows);
    if (!isRowAnchor(v)) throw new Error("narrow");
    expect(v.interactive).toBeUndefined();
    expect(v.file).toBe("x.txt");
    expect(v.lineNumber).toBe(1);
  });

  it("resolveCursorRowIdx resolves an interactive anchor by (file, subKind, boundaryRef)", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 0 }),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "hunk-separator",
      boundaryRef: 1,
    });
    expect(resolveCursorRowIdx(c, rows)).toBe(2);
  });

  it("resolveCursorRowIdx returns -1 when an interactive anchor doesn't match any row", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 0 }),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "hunk-separator",
      boundaryRef: 99,
    });
    expect(resolveCursorRowIdx(c, rows)).toBe(-1);
  });

  it("initialCursor never lands on an interactive row by default (PRD US 14)", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
      pairedFlat("x.txt", 5, 5),
    ];
    const cursor = initialCursor({ topLevelAnnotations: [], flatRows: rows });
    if (!isRowAnchor(cursor)) throw new Error("narrow");
    expect(cursor.interactive).toBeUndefined();
    expect(cursor.lineNumber).toBe(5);
  });

  it("initialCursor returns null when only interactive rows exist (no diff anchor)", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" }),
    ];
    expect(initialCursor({ topLevelAnnotations: [], flatRows: rows })).toBeNull();
  });

  it("cursorAtFirstFileRow skips interactive rows to land on the first diff row", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
      pairedFlat("x.txt", 5, 5),
    ];
    const c = cursorAtFirstFileRow("x.txt", rows);
    expect(c?.interactive).toBeUndefined();
    expect(c?.lineNumber).toBe(5);
  });

  it("cursorOnInteractive builds a cursor with interactive populated and no resolvable side", () => {
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "collapsed-file",
      boundaryRef: "top",
    });
    expect(c.interactive).toEqual({ subKind: "collapsed-file", boundaryRef: "top" });
    expect(c.file).toBe("x.txt");
  });
});

describe("cursorAfterExpand (issue #306)", () => {
  it("boundary-top consumed in 'all' mode lands on the first diff row of the same file", () => {
    // flatRowsBefore: file-top banner + the hunk's first content rows.
    // After the dispatch the banner is gone from the stream; we want the
    // cursor to land on the first hunk-content row which survives.
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
      pairedFlat("x.txt", 5, 5),
      pairedFlat("x.txt", 6, 6),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" });
    const landed = cursorAfterExpand(c, rows, "boundary-top");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.interactive).toBeUndefined();
    expect(landed.file).toBe("x.txt");
    expect(landed.lineNumber).toBe(5);
    expect(landed.side).toBe("additions");
  });

  it("hunk-separator consumed in 'all' mode lands on the first diff row at or after the banner in the same file", () => {
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("x.txt", 20, 20),
      pairedFlat("x.txt", 21, 21),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 });
    const landed = cursorAfterExpand(c, rows, "hunk-separator");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.lineNumber).toBe(20);
  });

  it("expand-down mid-file consumed skips past the adjacent hunk-header banner (which the same dispatch orphans) to land on the next hunk-content", () => {
    // The mid-file expand-down sits immediately before the hunk-header
    // banner. A full-down dispatch consumes the gap → the banner's
    // primaryExpand drops to null and the planner stops emitting the
    // expand-down row. Both adjacent interactives orphan; the cursor
    // must land on the first DIFF row.
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: 1 }),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("x.txt", 60, 60),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "expand-down", boundaryRef: 1 });
    const landed = cursorAfterExpand(c, rows, "expand-down-mid");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.lineNumber).toBe(60);
  });

  it("expand-down file-bottom consumed lands on the LAST diff row of the file (not the next file's first row)", () => {
    // Forward scan would jump into the next file. Bottom-orphan must
    // walk backward to find the file's last surviving diff row.
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      pairedFlat("x.txt", 2, 2),
      interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" }),
      pairedFlat("y.txt", 1, 1),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" });
    const landed = cursorAfterExpand(c, rows, "expand-down-bottom");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.file).toBe("x.txt");
    expect(landed.lineNumber).toBe(2);
  });

  it("collapsed-file consumed returns a synthetic boundary-top anchor for the file (validateCursor snaps if banner is non-walkable)", () => {
    // flatRowsBefore has no diff rows in the file (only the synthetic
    // collapsed-file row). The post-dispatch file body is unknown to the
    // helper; we return a boundary-top anchor on the file so the cursor
    // lands on the (commonly walkable) hunk-header banner, with the
    // view's validateCursor snapping to the file's first emitted row
    // when the banner is non-walkable.
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" }),
      pairedFlat("y.txt", 1, 1),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "collapsed-file", boundaryRef: "top" });
    const landed = cursorAfterExpand(c, rows, "collapsed-file");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.file).toBe("x.txt");
    expect(landed.interactive).toEqual({ subKind: "boundary-top", boundaryRef: "top" });
  });

  it("preserves preferredSide on the landing anchor (issue #200 — side carries across orphan)", () => {
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
      pairedFlat("x.txt", 5, 5),
    ];
    const c = cursorOnInteractive({
      file: "x.txt",
      subKind: "boundary-top",
      boundaryRef: "top",
      preferredSide: "deletions",
    });
    const landed = cursorAfterExpand(c, rows, "boundary-top");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.preferredSide).toBe("deletions");
    expect(landed.side).toBe("deletions");
    expect(landed.lineNumber).toBe(5);
  });

  it("returns the same cursor when the orphan target is not in the flat stream (defensive)", () => {
    const rows: FlatRow[] = [pairedFlat("y.txt", 1, 1)];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" });
    const landed = cursorAfterExpand(c, rows, "boundary-top");
    expect(landed).toBe(c);
  });

  it("returns the same cursor when no diff row exists in the same file in either direction", () => {
    // Only interactive rows in the file — pathological / defensive case.
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" }),
      interactiveFlat({ file: "x.txt", subKind: "expand-down", boundaryRef: "bottom" }),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "boundary-top", boundaryRef: "top" });
    const landed = cursorAfterExpand(c, rows, "boundary-top");
    expect(landed).toBe(c);
  });

  it("forward scan skips card rows and lands on the first DIFF row of the file", () => {
    // Cards aren't diff rows; the helper walks past them to the diff row.
    const rows: FlatRow[] = [
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      cardFlat({ file: "x.txt", side: "additions", lineEnd: 5, annotationId: "a1" }),
      pairedFlat("x.txt", 20, 20),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 });
    const landed = cursorAfterExpand(c, rows, "hunk-separator");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    expect(landed.lineNumber).toBe(20);
  });

  it("scoped to the same file — forward scan does not cross file boundaries", () => {
    // The next file's diff row must not be picked when this file has no
    // following diff row.
    const rows: FlatRow[] = [
      pairedFlat("x.txt", 1, 1),
      interactiveFlat({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 }),
      pairedFlat("y.txt", 1, 1),
    ];
    const c = cursorOnInteractive({ file: "x.txt", subKind: "hunk-separator", boundaryRef: 1 });
    const landed = cursorAfterExpand(c, rows, "hunk-separator");
    if (!isRowAnchor(landed)) throw new Error("expected row anchor");
    // Forward in same file: none. Falls back to backward in same file.
    expect(landed.file).toBe("x.txt");
    expect(landed.lineNumber).toBe(1);
  });
});
