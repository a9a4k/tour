import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows, flatRowFromLines } from "../../src/core/flat-rows.js";
import {
  planRows,
  type PlannedRow,
  type InteractiveRow,
} from "../../src/core/diff-rows.js";
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

  it("emits cursor-walkable rows for diff-row + hunk-header but skips annotation rows", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 })];
    const planned = new Map<string, PlannedRow[]>([
      ["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")],
    ]);
    const rows = flatRows([f], planned, () => false);
    // Hunk-headers are cursor-addressable as `hunk-separator` interactive
    // rows (PRD #108, ADR 0013). Annotation rows still skip.
    const cursorables = planned
      .get("x.txt")!
      .filter((r) => r.kind === "diff-row" || r.kind === "hunk-header");
    expect(rows.length).toBe(cursorables.length);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "hunk-separator")).toBe(true);
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
