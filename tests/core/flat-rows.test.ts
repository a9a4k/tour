import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows } from "../../src/core/flat-rows.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
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

  it("skips hunk-header and annotation rows", () => {
    const f = fileFromDiff(SIMPLE_DIFF, "x.txt");
    const annotations = [ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 })];
    const planned = new Map<string, PlannedRow[]>([
      ["x.txt", plannedFor(SIMPLE_DIFF, annotations, "split")],
    ]);
    const rows = flatRows([f], planned, () => false);
    // No hunk header or annotation rows should leak through.
    const diffRowsOnly = planned.get("x.txt")!.filter((r) => r.kind === "diff-row");
    expect(rows.length).toBe(diffRowsOnly.length);
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
