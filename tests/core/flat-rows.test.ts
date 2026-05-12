import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows, flatRowFromLines } from "../../src/core/flat-rows.js";
import {
  planRows,
  type PlannedRow,
  type InteractiveRow,
} from "../../src/core/diff-rows.js";
import { resolveCursorRowIdx } from "../../src/core/cursor-state.js";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Annotation } from "../../src/core/types.js";

function fileFromDiff(rawDiff: string, name: string): DiffFile {
  return { name, type: "change", hunks: [] };
}

function plannedFor(rawDiff: string, anns: Annotation[], layout: "split" | "unified"): PlannedRow[] {
  const meta = parsePatchFiles(rawDiff)[0].files[0];
  return planRows(meta, anns, layout);
}

const SIMPLE_DIFF = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;

const PURE_DEL_DIFF = `diff --git a/y.txt b/y.txt
index 1..2 100644
--- a/y.txt
+++ b/y.txt
@@ -1,2 +1,1 @@
 ctx
-only-del
`;

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

describe("flatRows", () => {
  it("emits one entry per diff-row, in the given file order", () => {
    const f1 = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const f2 = fileFromDiff(SIMPLE_DIFF, "z.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["x.txt", plannedFor(SIMPLE_DIFF, [], "split")],
      ["z.txt", plannedFor(SIMPLE_DIFF, [], "split")],
    ]);
    const rows = flatRows([f1, f2], planned, () => false);
    const xRows = rows.filter((r) => r.file === "x.txt");
    const zRows = rows.filter((r) => r.file === "z.txt");
    expect(xRows.length).toBeGreaterThan(0);
    expect(zRows.length).toBe(xRows.length);
    expect(rows[0].file).toBe("x.txt");
    expect(rows[rows.length - 1].file).toBe("z.txt");
  });

  it("emits cursor-walkable rows for diff-row + annotation cards, skips inert hunk-header rows (PRD #192)", () => {
    // PRD #151: hunk-headers are cursor-addressable iff `gapAbove > 0`.
    // SIMPLE_DIFF's first hunk starts at line 1, so its hunk-header is
    // inert and excluded from the flat stream.
    // PRD #192: annotation rows ARE cursor-addressable now (as card
    // rows), so they contribute one card flat row each.
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 })];
    const planned = new Map<string, PlannedRow[]>([
      ["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")],
    ]);
    const rows = flatRows([f], planned, () => false);
    const cursorables = planned
      .get("x.txt")!
      .filter(
        (r) =>
          r.kind === "diff-row" ||
          r.kind === "annotation" ||
          (r.kind === "hunk-header" && r.gapAbove > 0),
      );
    expect(rows.length).toBe(cursorables.length);
    // No interactive rows expected — first hunk's gapAbove is 0.
    expect(rows.some((r) => r.kind === "interactive")).toBe(false);
    // The card flat row carries the annotation id.
    const cardRow = rows.find((r) => r.kind === "card");
    expect(cardRow).toBeDefined();
    if (cardRow?.kind !== "card") throw new Error("narrow");
    expect(cardRow.annotationId).toBe("a1");
    expect(cardRow.lineEnd).toBe(2);
    expect(cardRow.side).toBe("additions");
  });

  it("contributes zero entries from a folded file", () => {
    const f1 = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const f2 = fileFromDiff(SIMPLE_DIFF, "z.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["x.txt", plannedFor(SIMPLE_DIFF, [], "split")],
      ["z.txt", plannedFor(SIMPLE_DIFF, [], "split")],
    ]);
    const rows = flatRows([f1, f2], planned, (n) => n === "z.txt");
    expect(rows.every((r) => r.file === "x.txt")).toBe(true);
  });

  it("skips a folded file in the middle so cross-file motion jumps over it", () => {
    // Three files in stream order. The middle one is folded — the cursor
    // should walk a.txt's rows directly into c.txt's rows with no b.txt
    // entries appearing between them.
    const fa = fileFromDiff(SIMPLE_DIFF, "a.txt");
    const fb = fileFromDiff(SIMPLE_DIFF, "b.txt");
    const fc = fileFromDiff(SIMPLE_DIFF, "c.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor(SIMPLE_DIFF, [], "split")],
      ["b.txt", plannedFor(SIMPLE_DIFF, [], "split")],
      ["c.txt", plannedFor(SIMPLE_DIFF, [], "split")],
    ]);
    const rows = flatRows([fa, fb, fc], planned, (n) => n === "b.txt");
    const fileSeq = rows.map((r) => r.file);
    expect(fileSeq).not.toContain("b.txt");
    // The boundary is direct: the last a.txt row is immediately followed
    // by the first c.txt row.
    const lastA = fileSeq.lastIndexOf("a.txt");
    expect(fileSeq[lastA + 1]).toBe("c.txt");
  });

  it("paired=true on a context row (both line numbers populated)", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => false);
    const ctx = rows.find((r) => r.leftLineNumber === 1 && r.rightLineNumber === 1);
    expect(ctx).toBeDefined();
    expect(ctx!.paired).toBe(true);
  });

  it("paired=true on a paired change row in split layout", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => false);
    // SIMPLE_DIFF: change block deletions=1, additions=2; row 0 is paired
    // (leftLine=2, rightLine=2 in the change block).
    const paired = rows.find((r) => r.leftLineNumber === 2 && r.rightLineNumber === 2);
    expect(paired).toBeDefined();
    expect(paired!.paired).toBe(true);
  });

  it("paired=false on a pure-addition row in split layout", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => false);
    const pureAdd = rows.find((r) => r.leftLineNumber === null && r.rightLineNumber === 3);
    expect(pureAdd).toBeDefined();
    expect(pureAdd!.paired).toBe(false);
    expect(pureAdd!.side).toBe("additions");
    expect(pureAdd!.lineNumber).toBe(3);
  });

  it("paired=false on a pure-deletion row in split layout", () => {
    const f = fileFromDiff(PURE_DEL_DIFF, "y.txt");
    const planned = new Map([["y.txt", plannedFor(PURE_DEL_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => false);
    const pureDel = rows.find((r) => r.leftLineNumber === 2 && r.rightLineNumber === null);
    expect(pureDel).toBeDefined();
    expect(pureDel!.paired).toBe(false);
    expect(pureDel!.side).toBe("deletions");
    expect(pureDel!.lineNumber).toBe(2);
  });

  it("populates leftLineNumber and rightLineNumber from the planned diff-row", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => false);
    const ctx = rows.find((r) => r.leftLineNumber === 1 && r.rightLineNumber === 1);
    expect(ctx?.lineNumber).toBe(1);
    expect(ctx?.side).toBe("additions");
  });

  it("returns an empty list when every file is folded", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, [], "split")]]);
    const rows = flatRows([f], planned, () => true);
    expect(rows).toEqual([]);
  });

  it("returns an empty list when there are no files", () => {
    expect(flatRows([], new Map(), () => false)).toEqual([]);
  });

  // issue #199: regression. When the webapp routed the cross-file annotation
  // list through planRows per-file (no upstream filter), the planner emitted
  // a phantom card row into every file whose line range overlapped another
  // file's annotation `line_end`. resolveCursorRowIdx then resolved the
  // CardAnchor to the first (alphabetically-earliest) phantom — moveCursor
  // from a card stepped into the wrong file.
  it("emits exactly one card row per top-level Annotation in a multi-file Tour with overlapping line ranges", () => {
    const diffA = `diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ a/a.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;
    const diffB = `diff --git a/b.txt b/b.txt
index 1..2 100644
--- a/b.txt
+++ b/b.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;
    const fa = fileFromDiff(diffA, "a.txt");
    const fb = fileFromDiff(diffB, "b.txt");
    const onlyInB = ann({ id: "ann-b", file: "b.txt", side: "additions", line_start: 2, line_end: 2 });
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor(diffA, [onlyInB], "split")],
      ["b.txt", plannedFor(diffB, [onlyInB], "split")],
    ]);
    const flat = flatRows([fa, fb], planned, () => false);
    const cardRows = flat.filter((r) => r.kind === "card");
    expect(cardRows.length).toBe(1);
    if (cardRows[0].kind !== "card") throw new Error("narrow");
    expect(cardRows[0].file).toBe("b.txt");
    expect(cardRows[0].annotationId).toBe("ann-b");

    const idx = resolveCursorRowIdx(
      { kind: "card", annotationId: "ann-b" },
      flat,
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(flat[idx].file).toBe("b.txt");
  });
});

// ADR 0013 / PRD #107: the cursor walks `diff` rows AND `interactive`
// rows. Interactive rows come from the planner (PRD #108) — these tests
// drive the flat-rows builder with synthetic InteractiveRow planner
// output to lock in the FlatRow shape and the pass-through semantics.
describe("flatRows interactive rows (PRD #107)", () => {
  function interactive(parts: {
    subKind: InteractiveRow["subKind"];
    boundaryRef: InteractiveRow["boundaryRef"];
    text?: string;
  }): InteractiveRow {
    return { kind: "interactive", subKind: parts.subKind, boundaryRef: parts.boundaryRef, text: parts.text };
  }

  it("emits a hunk-separator interactive FlatRow when the planner emits one", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      ...plannedFor(SIMPLE_DIFF, [], "split"),
      interactive({ subKind: "hunk-separator", boundaryRef: 1, text: "··· 12 hidden ···" }),
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    // The synthetic interactive row has boundaryRef=1; the planner's
    // hunk-header (also walkable as hunk-separator) has boundaryRef=0.
    const interactiveRow = flat.find(
      (r) => r.kind === "interactive" && r.boundaryRef === 1,
    );
    expect(interactiveRow).toBeDefined();
    expect(interactiveRow!.kind).toBe("interactive");
    if (interactiveRow!.kind !== "interactive") throw new Error("narrow");
    expect(interactiveRow!.subKind).toBe("hunk-separator");
    expect(interactiveRow!.boundaryRef).toBe(1);
    expect(interactiveRow!.file).toBe("x.txt");
  });

  it("preserves the order of all four interactive subKinds in stream order", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      interactive({ subKind: "boundary-top", boundaryRef: "top" }),
      interactive({ subKind: "hunk-separator", boundaryRef: 1 }),
      interactive({ subKind: "boundary-bottom", boundaryRef: "bottom" }),
      interactive({ subKind: "collapsed-file", boundaryRef: "top" }),
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    const subKinds = flat
      .filter((r) => r.kind === "interactive")
      .map((r) => (r.kind === "interactive" ? r.subKind : null));
    expect(subKinds).toEqual([
      "boundary-top",
      "hunk-separator",
      "boundary-bottom",
      "collapsed-file",
    ]);
  });

  it("interactive rows carry no `side` or `lineNumber`", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      interactive({ subKind: "hunk-separator", boundaryRef: 0 }),
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    const r = flat[0];
    expect(r.kind).toBe("interactive");
    if (r.kind !== "interactive") throw new Error("narrow");
    expect((r as unknown as { side?: unknown }).side).toBeUndefined();
    expect((r as unknown as { lineNumber?: unknown }).lineNumber).toBeUndefined();
  });

  it("boundaryRef survives identical re-runs of the builder (idempotent)", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      interactive({ subKind: "hunk-separator", boundaryRef: 2 }),
      interactive({ subKind: "boundary-top", boundaryRef: "top" }),
    ];
    const map = new Map([["x.txt", rows]]);
    const a = flatRows([f], map, () => false);
    const b = flatRows([f], map, () => false);
    expect(a.map((r) => (r.kind === "interactive" ? r.boundaryRef : null))).toEqual(
      b.map((r) => (r.kind === "interactive" ? r.boundaryRef : null)),
    );
  });

  it("a folded file contributes zero rows including its interactive rows", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      ...plannedFor(SIMPLE_DIFF, [], "split"),
      interactive({ subKind: "hunk-separator", boundaryRef: 0 }),
      interactive({ subKind: "boundary-bottom", boundaryRef: "bottom" }),
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => true);
    expect(flat).toEqual([]);
  });

  it("diff rows continue to carry kind: 'diff' when interleaved with interactive rows", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      interactive({ subKind: "boundary-top", boundaryRef: "top" }),
      ...plannedFor(SIMPLE_DIFF, [], "split"),
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    const diffRows = flat.filter((r) => r.kind === "diff");
    expect(diffRows.length).toBeGreaterThan(0);
    for (const r of diffRows) expect(r.kind).toBe("diff");
  });
});

// PRD #151 / ADR 0018: hunk-header rows are cursor-addressable iff
// gapAbove > 0. First-hunk interactive hunk-headers tag as `boundary-top` /
// `"top"`; mid-file interactive hunk-headers tag as `hunk-separator` /
// `hunkIndex`. gap-mid-top passes through.
describe("flatRows gap-row family (PRD #151)", () => {
  it("skips a hunk-header with gapAbove === 0", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ -1,3 +1,3 @@", hunkIndex: 0, gapAbove: 0 },
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    expect(flat.length).toBe(0);
  });

  it("includes a first-hunk hunk-header with gapAbove > 0 as boundary-top / 'top'", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ -5,3 +5,3 @@", hunkIndex: 0, gapAbove: 4 },
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    expect(flat.length).toBe(1);
    expect(flat[0].kind).toBe("interactive");
    if (flat[0].kind !== "interactive") throw new Error("narrow");
    expect(flat[0].subKind).toBe("boundary-top");
    expect(flat[0].boundaryRef).toBe("top");
  });

  it("includes a mid-file hunk-header with gapAbove > 0 as hunk-separator / hunkIndex", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ -10,3 +10,3 @@", hunkIndex: 3, gapAbove: 12 },
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    expect(flat.length).toBe(1);
    expect(flat[0].kind).toBe("interactive");
    if (flat[0].kind !== "interactive") throw new Error("narrow");
    expect(flat[0].subKind).toBe("hunk-separator");
    expect(flat[0].boundaryRef).toBe(3);
  });

  it("passes through gap-mid-top interactive rows into the cursor stream", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      { kind: "interactive", subKind: "gap-mid-top", boundaryRef: 2 },
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    expect(flat.length).toBe(1);
    if (flat[0].kind !== "interactive") throw new Error("narrow");
    expect(flat[0].subKind).toBe("gap-mid-top");
    expect(flat[0].boundaryRef).toBe(2);
  });

  it("passes through boundary-bottom interactive rows unchanged", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const rows: PlannedRow[] = [
      { kind: "interactive", subKind: "boundary-bottom", boundaryRef: "bottom" },
    ];
    const flat = flatRows([f], new Map([["x.txt", rows]]), () => false);
    expect(flat.length).toBe(1);
    if (flat[0].kind !== "interactive") throw new Error("narrow");
    expect(flat[0].subKind).toBe("boundary-bottom");
    expect(flat[0].boundaryRef).toBe("bottom");
  });
});

// PRD #192 / ADR 0022: annotation cards are first-class cursor stops.
// The flat-rows builder emits a CardFlatRow directly after the diff row
// the annotation anchors to (matching the planner's interleave order).
// Multiple cards at the same anchor stack in `created_at` order.
describe("flatRows card rows (PRD #192)", () => {
  it("emits a CardFlatRow with the annotation's id, side, and lineEnd", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [
      ann({ id: "card-a", side: "additions", line_start: 2, line_end: 3, body: "hello world" }),
    ];
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")]]);
    const rows = flatRows([f], planned, () => false);
    const card = rows.find((r) => r.kind === "card");
    expect(card).toBeDefined();
    if (card?.kind !== "card") throw new Error("narrow");
    expect(card.annotationId).toBe("card-a");
    expect(card.side).toBe("additions");
    expect(card.lineEnd).toBe(3);
    expect(card.file).toBe("x.txt");
  });

  it("places the card row directly after the anchor diff row in the flat sequence", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 })];
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")]]);
    const rows = flatRows([f], planned, () => false);
    const cardIdx = rows.findIndex((r) => r.kind === "card");
    expect(cardIdx).toBeGreaterThanOrEqual(1);
    const prev = rows[cardIdx - 1];
    expect(prev.kind).toBe("diff");
    if (prev.kind !== "diff") throw new Error("narrow");
    // The diff row immediately before the card row is the card's anchor.
    expect(prev.rightLineNumber).toBe(2);
  });

  it("stacks multiple cards at the same anchor in created_at order", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    // Same anchor (line 2 additions), distinct created_at — the planner's
    // interleave step orders by created_at ascending.
    const annotations = [
      ann({
        id: "a-second",
        side: "additions",
        line_start: 2,
        line_end: 2,
        created_at: "2026-02-02T00:00:00Z",
      }),
      ann({
        id: "a-first",
        side: "additions",
        line_start: 2,
        line_end: 2,
        created_at: "2026-01-01T00:00:00Z",
      }),
    ];
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")]]);
    const rows = flatRows([f], planned, () => false);
    const cards = rows.filter((r) => r.kind === "card");
    expect(cards.length).toBe(2);
    if (cards[0].kind !== "card" || cards[1].kind !== "card") throw new Error("narrow");
    expect(cards[0].annotationId).toBe("a-first");
    expect(cards[1].annotationId).toBe("a-second");
  });

  it("omits card rows from a folded file", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 })];
    const planned = new Map([["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")]]);
    const rows = flatRows([f], planned, () => true);
    expect(rows).toEqual([]);
  });
});

describe("flatRowFromLines", () => {
  it("paired row: both line numbers populated → paired=true, side=additions, lineNumber=right", () => {
    const r = flatRowFromLines("x.txt", 5, 7);
    expect(r).toEqual({
      kind: "diff",
      file: "x.txt",
      lineNumber: 7,
      side: "additions",
      leftLineNumber: 5,
      rightLineNumber: 7,
      paired: true,
    });
  });

  it("pure-addition row: left null → paired=false, side=additions, lineNumber=right", () => {
    const r = flatRowFromLines("x.txt", null, 4);
    expect(r).toEqual({
      kind: "diff",
      file: "x.txt",
      lineNumber: 4,
      side: "additions",
      leftLineNumber: null,
      rightLineNumber: 4,
      paired: false,
    });
  });

  it("pure-deletion row: right null → paired=false, side=deletions, lineNumber=left", () => {
    const r = flatRowFromLines("x.txt", 9, null);
    expect(r).toEqual({
      kind: "diff",
      file: "x.txt",
      lineNumber: 9,
      side: "deletions",
      leftLineNumber: 9,
      rightLineNumber: null,
      paired: false,
    });
  });

  it("threads file through unchanged", () => {
    expect(flatRowFromLines("a/b/c.ts", 1, 1).file).toBe("a/b/c.ts");
  });

  it("context row (left===right) is paired and additions-side by default", () => {
    const r = flatRowFromLines("x.txt", 3, 3);
    expect(r.paired).toBe(true);
    expect(r.side).toBe("additions");
    expect(r.lineNumber).toBe(3);
  });
});
