import { describe, it, expect } from "vitest";
import { buildRowYResolver, cursorRowDomId, flatRowId } from "../../src/tui/row-y-resolver.js";
import { step } from "../../src/core/diff-pane-motion.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { ScrollBoxRenderable } from "@opentui/core";

type FakeNode = {
  id?: string;
  y?: number;
  getChildren?: () => FakeNode[];
  updateFromLayout?: () => void;
};

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

function cursorAt(row: FlatRow): Cursor {
  if (row.kind !== "diff") throw new Error("expected diff row");
  return {
    file: row.file,
    lineNumber: row.lineNumber,
    side: row.side,
    preferredSide: row.side,
  };
}

/**
 * Build a synthetic ScrollBoxRenderable whose children mirror opentui's
 * screen-absolute coord space: child.y = viewport.y + (contentY - scrollTop).
 */
function makeFakeScrollbox(
  viewportY: number,
  scrollTop: number,
  contentYs: ReadonlyArray<{ id: string; contentY: number }>,
): ScrollBoxRenderable {
  const children: FakeNode[] = contentYs.map((c) => ({
    id: c.id,
    y: viewportY + (c.contentY - scrollTop),
    getChildren: () => [],
  }));
  const content: FakeNode = {
    getChildren: () => children,
  };
  return {
    content,
    viewport: { y: viewportY, x: 0, width: 80, height: 30 },
    scrollTop,
  } as unknown as ScrollBoxRenderable;
}

describe("buildRowYResolver", () => {
  it("returns content-y given screen-absolute child.y from a scrollbox below other UI", () => {
    // Header above scrollbox → viewport.y=5; user scrolled to scrollTop=100.
    // Three rows at content positions 100/101/102 → on screen at 5/6/7.
    const viewportY = 5;
    const scrollTop = 100;
    const rows: FlatRow[] = [pairedRow("x.txt", 1), pairedRow("x.txt", 2), pairedRow("x.txt", 3)];
    const sb = makeFakeScrollbox(viewportY, scrollTop, [
      { id: "diff-row-x.txt-additions-1", contentY: 100 },
      { id: "diff-row-x.txt-additions-2", contentY: 101 },
      { id: "diff-row-x.txt-additions-3", contentY: 102 },
    ]);
    const rowY = buildRowYResolver(sb, rows);
    expect(rowY(0)).toBe(100);
    expect(rowY(1)).toBe(101);
    expect(rowY(2)).toBe(102);
  });

  it("integrates with step('up'): no scroll when cursor is mid-viewport after the user has scrolled", () => {
    // Regression: previously rowY returned screen-y, so `nextY - scrollTop`
    // was trivially negative and step("up") scrolled on every press.
    // Setup: viewport.y=5 (header above), height=20, scrollTop=100. Rows
    // span content-y 100..119 → screen rows 5..24. Cursor mid-viewport
    // at content-y 110 (screen row 15). Arrow Up should move cursor to
    // content-y 109 (screen row 14) and leave scrollTop at 100 — well
    // outside the 3-row top margin (csy=4 ≥ scrolloff).
    const viewportY = 5;
    const scrollTop = 100;
    const viewportHeight = 20;
    const rows: FlatRow[] = [];
    const childYs: { id: string; contentY: number }[] = [];
    for (let line = 1; line <= 30; line++) {
      const row = pairedRow("x.txt", line);
      rows.push(row);
      childYs.push({
        id: `diff-row-x.txt-additions-${line}`,
        contentY: 99 + line, // line 1 → 100, line 11 → 110, line 30 → 129
      });
    }
    const sb = makeFakeScrollbox(viewportY, scrollTop, childYs);
    const rowY = buildRowYResolver(sb, rows);
    const r = step(
      {
        cursor: cursorAt(rows[10]), // line 11, content-y 110, screen-y 15
        flatRows: rows,
        scrollTop,
        viewportHeight,
        rowY,
        contentHeight: 130,
      },
      "up",
    );
    expect(r.cursor?.lineNumber).toBe(10);
    expect(r.scrollTop).toBe(scrollTop);
  });

  it("integrates with step('up'): scrolls one row when cursor enters the 3-row top margin", () => {
    // Same scrollbox geometry. Cursor pre-press at content-y 103
    // (screen-y 8). After ↑: content-y 102, screen-y 7. screen-y < 3?
    // No — 7 ≥ 3. Hmm, the scrolloff fires when screen offset from top
    // is <3. So pre-press at content-y 103 leaves csy=8 after step.
    // Let's pick cursor pre-press at content-y 102 (screen-y 2). After
    // ↑ → content-y 101, screen-y 1 (<3) → scroll by 1.
    const viewportY = 5;
    const scrollTop = 100;
    const viewportHeight = 20;
    const rows: FlatRow[] = [];
    const childYs: { id: string; contentY: number }[] = [];
    for (let line = 1; line <= 30; line++) {
      rows.push(pairedRow("x.txt", line));
      childYs.push({
        id: `diff-row-x.txt-additions-${line}`,
        contentY: 99 + line,
      });
    }
    const sb = makeFakeScrollbox(viewportY, scrollTop, childYs);
    const rowY = buildRowYResolver(sb, rows);
    const r = step(
      {
        cursor: cursorAt(rows[2]), // line 3, content-y 102
        flatRows: rows,
        scrollTop,
        viewportHeight,
        rowY,
        contentHeight: 130,
      },
      "up",
    );
    expect(r.cursor?.lineNumber).toBe(2);
    expect(r.scrollTop).toBe(scrollTop - 1);
  });

  it("flatRowId handles all three flat-row kinds (diff, interactive, card)", () => {
    const diff: FlatRow = {
      kind: "diff",
      file: "x.ts",
      lineNumber: 8,
      side: "additions",
      leftLineNumber: 5,
      rightLineNumber: 8,
      paired: true,
    };
    const interactive: FlatRow = {
      kind: "interactive",
      file: "x.ts",
      subKind: "hunk-separator",
      boundaryRef: 1,
    };
    const card: FlatRow = {
      kind: "card",
      file: "x.ts",
      side: "additions",
      lineEnd: 8,
      commentId: "ann-7",
    };
    expect(flatRowId(diff)).toBe("diff-row-x.ts-additions-8");
    expect(flatRowId(interactive)).toBe("interactive-row-x.ts-hunk-separator-1");
    expect(flatRowId(card)).toBe("comment-ann-7");
  });

  describe("cursorRowDomId (layout-invariant resolution for preserve-screen-y)", () => {
    const pairedContext: FlatRow = {
      kind: "diff",
      file: "x.ts",
      lineNumber: 8,
      side: "additions",
      leftLineNumber: 5,
      rightLineNumber: 8,
      paired: true,
    };
    const flatRows = [pairedContext] as ReadonlyArray<FlatRow>;

    it("maps a card cursor to `comment-${id}` without consulting flatRows", () => {
      const cursor: Cursor = {
        kind: "card",
        commentId: "ann-3",
        preferredSide: "additions",
      };
      expect(cursorRowDomId(cursor, [])).toBe("comment-ann-3");
    });

    it("returns the FlatRow's id (additions side) for a paired-row cursor on the ADDITIONS side", () => {
      const cursor: Cursor = {
        kind: "row",
        file: "x.ts",
        lineNumber: 8,
        side: "additions",
        preferredSide: "additions",
      };
      // resolveCursorRowIdx finds the paired row, flatRowId returns the
      // canonical additions-side id.
      expect(cursorRowDomId(cursor, flatRows)).toBe("diff-row-x.ts-additions-8");
    });

    it("returns the SAME id (additions side) for a paired-row cursor on the DELETIONS side", () => {
      // This is the layout-invariance pin: a cursor on the deletions side
      // of a paired context row must hand back the same id as the additions
      // side, because in unified the row is rendered with a single id
      // anchored to the additions side. Otherwise preserveScreenY would
      // miss the row across a split→unified toggle.
      const cursor: Cursor = {
        kind: "row",
        file: "x.ts",
        lineNumber: 5,
        side: "deletions",
        preferredSide: "deletions",
      };
      expect(cursorRowDomId(cursor, flatRows)).toBe("diff-row-x.ts-additions-8");
    });

    it("returns null when the cursor doesn't resolve in flatRows", () => {
      const cursor: Cursor = {
        kind: "row",
        file: "missing.ts",
        lineNumber: 1,
        side: "additions",
        preferredSide: "additions",
      };
      expect(cursorRowDomId(cursor, flatRows)).toBeNull();
    });
  });

  it("integrates with step('down'): no scroll when cursor is mid-viewport", () => {
    // Symmetry check: down should also not scroll when cursor is well
    // inside the comfort zone. Pre-bug, this happened to work because
    // the wrong formula was always-false; this test pins the right
    // behaviour going forward.
    const viewportY = 5;
    const scrollTop = 100;
    const viewportHeight = 20;
    const rows: FlatRow[] = [];
    const childYs: { id: string; contentY: number }[] = [];
    for (let line = 1; line <= 30; line++) {
      rows.push(pairedRow("x.txt", line));
      childYs.push({
        id: `diff-row-x.txt-additions-${line}`,
        contentY: 99 + line,
      });
    }
    const sb = makeFakeScrollbox(viewportY, scrollTop, childYs);
    const rowY = buildRowYResolver(sb, rows);
    const r = step(
      {
        cursor: cursorAt(rows[10]),
        flatRows: rows,
        scrollTop,
        viewportHeight,
        rowY,
        contentHeight: 130,
      },
      "down",
    );
    expect(r.cursor?.lineNumber).toBe(12);
    expect(r.scrollTop).toBe(scrollTop);
  });
});
