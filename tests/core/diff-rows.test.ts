import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import type { Annotation } from "../../src/core/types.js";

function parseFile(rawDiff: string): FileDiffMetadata {
  const patches = parsePatchFiles(rawDiff);
  if (patches.length === 0 || patches[0].files.length === 0) {
    throw new Error("expected at least one parsed file");
  }
  return patches[0].files[0];
}

function ann(overrides: Partial<Annotation> & Pick<Annotation, "id" | "side" | "line_start" | "line_end">): Annotation {
  return {
    id: overrides.id,
    file: overrides.file ?? "x.txt",
    side: overrides.side,
    line_start: overrides.line_start,
    line_end: overrides.line_end,
    body: overrides.body ?? "note",
    author: overrides.author ?? "agent",
    author_kind: overrides.author_kind ?? "agent",
    replies_to: overrides.replies_to,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
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

describe("planRows", () => {
  it("strips trailing newlines from leftText/rightText", () => {
    // @pierre/diffs returns each line with its trailing "\n" intact; the TUI
    // <text> renderable honours embedded newlines and emits a phantom empty
    // visual line per row, doubling the diff's vertical footprint. Strip at
    // the planner so every TUI consumer of PlannedRow gets clean text.
    const file = parseFile(SIMPLE_DIFF);
    const split = planRows(file, [], "split").filter((r) => r.kind === "diff-row");
    for (const row of split) {
      if (row.kind !== "diff-row") continue;
      expect(row.leftText.endsWith("\n")).toBe(false);
      expect(row.rightText.endsWith("\n")).toBe(false);
    }
    const unified = planRows(file, [], "unified").filter((r) => r.kind === "diff-row");
    for (const row of unified) {
      if (row.kind !== "diff-row") continue;
      expect(row.leftText.endsWith("\n")).toBe(false);
      expect(row.rightText.endsWith("\n")).toBe(false);
    }
  });

  it("returns rows with no annotations when annotations list is empty", () => {
    const file = parseFile(SIMPLE_DIFF);
    const rows = planRows(file, [], "split");
    expect(rows.some((r) => r.kind === "annotation")).toBe(false);
    expect(rows.some((r) => r.kind === "hunk-header")).toBe(true);
    expect(rows.some((r) => r.kind === "diff-row")).toBe(true);
  });

  it("inserts a single-line annotation on additions directly after its anchor row", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "annotation");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    expect(prev.kind).toBe("diff-row");
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(2);
    }
    const annRow = rows[annIdx];
    if (annRow.kind === "annotation") {
      expect(annRow.id).toBe("a1");
      expect(annRow.annotation.id).toBe("a1");
    }
  });

  it("places the card after the row matching line_end for a multi-line annotation on additions", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 3 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "annotation");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(3);
    } else {
      throw new Error("expected diff-row before annotation");
    }
  });

  it("places a deletions-side card after the row whose left line matches line_end (split)", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+kept
`;
    const file = parseFile(diff);
    const a = ann({ id: "a1", side: "deletions", line_start: 1, line_end: 3 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "annotation");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.leftLineNumber).toBe(3);
    } else {
      throw new Error("expected diff-row before annotation");
    }
  });

  it("places multiple annotations on different anchor rows independently", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a1 = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
    const a2 = ann({ id: "a2", side: "additions", line_start: 3, line_end: 3 });
    const rows = planRows(file, [a1, a2], "split");
    const annIds = rows
      .filter((r): r is Extract<PlannedRow, { kind: "annotation" }> => r.kind === "annotation")
      .map((r) => r.id);
    expect(annIds).toEqual(["a1", "a2"]);
    const a1Idx = rows.findIndex((r) => r.kind === "annotation" && r.id === "a1");
    const a2Idx = rows.findIndex((r) => r.kind === "annotation" && r.id === "a2");
    const before1 = rows[a1Idx - 1];
    const before2 = rows[a2Idx - 1];
    if (before1.kind === "diff-row") expect(before1.rightLineNumber).toBe(2);
    if (before2.kind === "diff-row") expect(before2.rightLineNumber).toBe(3);
  });

  it("stacks multiple annotations sharing the same line_end in created_at ascending order", () => {
    const file = parseFile(SIMPLE_DIFF);
    const earlier = ann({
      id: "z-id",
      side: "additions",
      line_start: 2,
      line_end: 2,
      created_at: "2026-01-01T00:00:00Z",
    });
    const later = ann({
      id: "a-id",
      side: "additions",
      line_start: 2,
      line_end: 2,
      created_at: "2026-01-02T00:00:00Z",
    });
    const rows = planRows(file, [later, earlier], "split");
    const annIds = rows
      .filter((r): r is Extract<PlannedRow, { kind: "annotation" }> => r.kind === "annotation")
      .map((r) => r.id);
    expect(annIds).toEqual(["z-id", "a-id"]);
  });

  it("breaks created_at ties by id ascending", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({
      id: "b",
      side: "additions",
      line_start: 2,
      line_end: 2,
      created_at: "2026-01-01T00:00:00Z",
    });
    const b = ann({
      id: "a",
      side: "additions",
      line_start: 2,
      line_end: 2,
      created_at: "2026-01-01T00:00:00Z",
    });
    const rows = planRows(file, [a, b], "split");
    const annIds = rows
      .filter((r): r is Extract<PlannedRow, { kind: "annotation" }> => r.kind === "annotation")
      .map((r) => r.id);
    expect(annIds).toEqual(["a", "b"]);
  });

  it("silently drops annotations that fall outside any visible row", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "ghost", side: "additions", line_start: 99, line_end: 99 });
    const rows = planRows(file, [a], "split");
    expect(rows.some((r) => r.kind === "annotation")).toBe(false);
  });

  it("places a deletions-side annotation after the matching row in unified layout", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
-old
+new
 ctx
`;
    const file = parseFile(diff);
    const a = ann({ id: "u1", side: "deletions", line_start: 1, line_end: 1 });
    const rows = planRows(file, [a], "unified");
    const annIdx = rows.findIndex((r) => r.kind === "annotation");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.type).toBe("deletion");
      expect(prev.leftLineNumber).toBe(1);
      expect(prev.rightLineNumber).toBeNull();
    } else {
      throw new Error("expected diff-row before annotation");
    }
  });

  it("emits paired change rows in split and separate deletion/addition rows in unified", () => {
    const file = parseFile(SIMPLE_DIFF);
    const split = planRows(file, [], "split");
    const unified = planRows(file, [], "unified");
    const splitChanges = split.filter(
      (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row" && r.type === "change",
    );
    expect(splitChanges.length).toBeGreaterThan(0);
    const unifiedChanges = unified.filter(
      (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row" && r.type === "change",
    );
    expect(unifiedChanges.length).toBe(0);
    const unifiedDels = unified.filter(
      (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row" && r.type === "deletion",
    );
    const unifiedAdds = unified.filter(
      (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row" && r.type === "addition",
    );
    expect(unifiedDels.length).toBe(1);
    expect(unifiedAdds.length).toBe(2);
  });

  describe("tint + gutter flags", () => {
    it("does not set any tint/gutter flags when annotations list is empty", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      for (const r of diffRows) {
        expect(r.leftTinted).toBeFalsy();
        expect(r.rightTinted).toBeFalsy();
        expect(r.leftGutter).toBeFalsy();
        expect(r.rightGutter).toBeFalsy();
      }
    });

    it("sets right-only flags for an additions annotation in split layout", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 3 });
      const rows = planRows(file, [a], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const tinted = diffRows.filter((r) => r.rightTinted === true);
      expect(tinted.map((r) => r.rightLineNumber).sort()).toEqual([2, 3]);
      for (const r of tinted) {
        expect(r.rightGutter).toBe(true);
        expect(r.leftTinted).toBeFalsy();
        expect(r.leftGutter).toBeFalsy();
      }
      const ctx = diffRows.find((r) => r.type === "context");
      expect(ctx?.rightTinted).toBeFalsy();
      expect(ctx?.leftTinted).toBeFalsy();
    });

    it("sets left-only flags for a deletions annotation in split layout", () => {
      const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+kept
`;
      const file = parseFile(diff);
      const a = ann({ id: "a1", side: "deletions", line_start: 1, line_end: 3 });
      const rows = planRows(file, [a], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const tinted = diffRows.filter((r) => r.leftTinted === true);
      expect(tinted.map((r) => r.leftLineNumber).sort()).toEqual([1, 2, 3]);
      for (const r of tinted) {
        expect(r.leftGutter).toBe(true);
        expect(r.rightTinted).toBeFalsy();
        expect(r.rightGutter).toBeFalsy();
      }
    });

    it("collapses to right-only flags in unified layout regardless of side", () => {
      const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+kept
`;
      const file = parseFile(diff);
      const a = ann({ id: "a1", side: "deletions", line_start: 1, line_end: 3 });
      const rows = planRows(file, [a], "unified");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const tinted = diffRows.filter((r) => r.rightTinted === true);
      expect(tinted.length).toBe(3);
      for (const r of tinted) {
        expect(r.rightGutter).toBe(true);
        expect(r.leftTinted).toBeFalsy();
        expect(r.leftGutter).toBeFalsy();
        expect(r.type).toBe("deletion");
      }
    });

    it("sets flags on +/- change rows where one side has a null line number (split)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a = ann({ id: "a1", side: "additions", line_start: 3, line_end: 3 });
      const rows = planRows(file, [a], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const target = diffRows.find((r) => r.rightLineNumber === 3);
      expect(target).toBeDefined();
      expect(target?.rightTinted).toBe(true);
      expect(target?.rightGutter).toBe(true);
      expect(target?.leftLineNumber).toBeNull();
    });

    it("unions per-side flags when multiple annotations cover the same rows", () => {
      const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+kept
`;
      const file = parseFile(diff);
      const adds = ann({ id: "ad", side: "additions", line_start: 1, line_end: 1 });
      const dels = ann({ id: "de", side: "deletions", line_start: 1, line_end: 3 });
      const rows = planRows(file, [adds, dels], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const both = diffRows.find((r) => r.leftLineNumber === 1 && r.rightLineNumber === 1);
      expect(both).toBeDefined();
      expect(both?.leftTinted).toBe(true);
      expect(both?.leftGutter).toBe(true);
      expect(both?.rightTinted).toBe(true);
      expect(both?.rightGutter).toBe(true);

      const leftOnly = diffRows.find((r) => r.leftLineNumber === 2);
      expect(leftOnly?.leftTinted).toBe(true);
      expect(leftOnly?.rightTinted).toBeFalsy();
    });

    it("unions flags when two additions annotations have overlapping ranges", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a1 = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
      const a2 = ann({ id: "a2", side: "additions", line_start: 2, line_end: 3 });
      const rows = planRows(file, [a1, a2], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const r2 = diffRows.find((r) => r.rightLineNumber === 2);
      const r3 = diffRows.find((r) => r.rightLineNumber === 3);
      expect(r2?.rightTinted).toBe(true);
      expect(r2?.rightGutter).toBe(true);
      expect(r3?.rightTinted).toBe(true);
      expect(r3?.rightGutter).toBe(true);
    });

    it("produces a different flag distribution when toggling layout for the same annotations", () => {
      const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,1 @@
-d1
-d2
-d3
+kept
`;
      const file = parseFile(diff);
      const a = ann({ id: "a1", side: "deletions", line_start: 1, line_end: 3 });
      const split = planRows(file, [a], "split");
      const unified = planRows(file, [a], "unified");
      const splitDiffRows = split.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const unifiedDiffRows = unified.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const splitLeft = splitDiffRows.filter((r) => r.leftTinted).length;
      const splitRight = splitDiffRows.filter((r) => r.rightTinted).length;
      expect(splitLeft).toBe(3);
      expect(splitRight).toBe(0);
      const unifiedLeft = unifiedDiffRows.filter((r) => r.leftTinted).length;
      const unifiedRight = unifiedDiffRows.filter((r) => r.rightTinted).length;
      expect(unifiedLeft).toBe(0);
      expect(unifiedRight).toBe(3);
    });

    it("sets flags on a single-line annotation the same as on multi-line ones", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(file, [a], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      const r2 = diffRows.find((r) => r.rightLineNumber === 2);
      expect(r2?.rightTinted).toBe(true);
      expect(r2?.rightGutter).toBe(true);
      const tintedCount = diffRows.filter((r) => r.rightTinted).length;
      expect(tintedCount).toBe(1);
    });
  });
});

// PRD #108 (issue #112). The planner gains `oldContent`, `newContent`, and
// `expansion` parameters, learns to emit synthetic file-top / file-bottom
// boundary rows, attaches `gapAbove` line counts to the hunk-header
// (PRD #151), and emits expanded `context` rows from the file contents
// when expansion state requests them.
describe("planRows hidden-context expansion (PRD #108)", () => {
  // A file with two hunks separated by a 10-line gap.
  // Hunk 1: lines 1..3 (one ctx + one paired change). Hunk 2 starts at
  // line 14, so lines 4..13 are hidden in the gap.
  const TWO_HUNK_DIFF = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -14,2 +14,2 @@
 ctx14
-old14
+new14
`;

  // newContent: 16 lines (line 1 starts a 16-line file). Old content same
  // shape with `old1` / `old14` instead of `new1` / `new14`.
  const NEW_CONTENT_TWO_HUNK =
    [
      "ctx1",
      "new1",
      "ctx2",
      "g4",
      "g5",
      "g6",
      "g7",
      "g8",
      "g9",
      "g10",
      "g11",
      "g12",
      "g13",
      "ctx14",
      "new14",
      "ctx15",
    ].join("\n") + "\n";

  const OLD_CONTENT_TWO_HUNK =
    [
      "ctx1",
      "old1",
      "ctx2",
      "g4",
      "g5",
      "g6",
      "g7",
      "g8",
      "g9",
      "g10",
      "g11",
      "g12",
      "g13",
      "ctx14",
      "old14",
      "ctx15",
    ].join("\n") + "\n";

  it("hunk-header carries gapAbove line count (= remaining gap size)", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers.length).toBe(2);
    // First hunk starts at line 1 → no file-top gap.
    expect(headers[0].gapAbove).toBe(0);
    // Second hunk's preceding gap: lines 4..13 = 10 hidden lines.
    expect(headers[1].gapAbove).toBe(10);
  });

  // PRD #151: boundary-top no longer emitted; first hunk's hunk-header absorbs it.
  it("does NOT emit a boundary-top row when first hunk's additionStart > 1 (folded into hunk-header)", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,1 +5,1 @@
-old5
+new5
`;
    const file = parseFile(diff);
    const rows = planRows(file, [], "split");
    const top = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "boundary-top",
    );
    expect(top).toBeUndefined();
    // The first hunk's hunk-header carries the file-top gap as gapAbove.
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers.length).toBe(1);
    expect(headers[0].hunkIndex).toBe(0);
    expect(headers[0].gapAbove).toBe(4); // lines 1..4 hidden above hunk starting at line 5
  });

  it("does NOT emit a boundary-top row when first hunk's additionStart === 1", () => {
    const file = parseFile(SIMPLE_DIFF);
    const rows = planRows(file, [], "split");
    const top = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "boundary-top",
    );
    expect(top).toBeUndefined();
  });

  it("emits a boundary-bottom interactive row when last hunk doesn't reach EOF (with newContent)", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
    });
    const bottom = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bottom).toBeDefined();
    if (bottom?.kind === "interactive") {
      expect(bottom.boundaryRef).toBe("bottom");
    }
  });

  it("does NOT emit a boundary-bottom row when newContent is missing", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split");
    const bottom = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bottom).toBeUndefined();
  });

  // Issue #160 / PRD #151 US-10: boundary-bottom is a pure affordance row
  // (no @@-metadata to carry, unlike hunk-header). Once Pierre has revealed
  // every line of the file-bottom gap, the row should drop out — leaving
  // it visible with "0 hidden below" is a cursor trap (Enter is a no-op).
  it("does NOT emit a boundary-bottom row when file-bottom gap is fully absorbed", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    // file-bottom gap = 1 line ("ctx15" on line 16). down=1 absorbs it.
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map<"bottom", { up: number; down: number }>([
            ["bottom", { up: 0, down: 1 }],
          ]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
      expansion,
    });
    const bottom = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bottom).toBeUndefined();
  });

  it("emits boundary-bottom with reduced count when file-bottom gap is partially absorbed", () => {
    // Build a one-hunk diff with a 5-line file-bottom gap (hunk ends at line
    // 3, newContent has 8 lines). Absorb 2 from the bottom → remaining = 3.
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old2
+new2
 ctx3
`;
    const newContent = ["ctx1", "new2", "ctx3", "g4", "g5", "g6", "g7", "g8"].join("\n") + "\n";
    const oldContent = ["ctx1", "old2", "ctx3", "g4", "g5", "g6", "g7", "g8"].join("\n") + "\n";
    const file = parseFile(diff);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map<"bottom", { up: number; down: number }>([
            ["bottom", { up: 0, down: 2 }],
          ]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", { oldContent, newContent, expansion });
    const bottom = rows.find(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> =>
        r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bottom).toBeDefined();
    expect(bottom?.text).toContain("3 lines hidden");
  });

  it("emits boundary-bottom with the original count when no file-bottom expansion has occurred", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
    });
    const bottom = rows.find(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> =>
        r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bottom).toBeDefined();
    // file-bottom gap = 1 line.
    expect(bottom?.text).toContain("1 lines hidden");
  });

  it("expansion state with non-zero up/down on a hunk-separator emits matching context rows from newContent", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 2, down: 1 }]]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
      expansion,
    });
    const ctxLines = rows
      .filter((r) => r.kind === "diff-row" && r.type === "context")
      .map((r) => (r.kind === "diff-row" ? r.rightText : ""));
    // up = 2 → lines 4 ("g4"), 5 ("g5") just after hunk 1's end.
    expect(ctxLines).toContain("g4");
    expect(ctxLines).toContain("g5");
    // down = 1 → line 13 ("g13") just before hunk 2.
    expect(ctxLines).toContain("g13");
    // Lines NOT in the expanded windows stay hidden.
    expect(ctxLines).not.toContain("g8");
  });

  it("gapAbove shrinks as expansion reveals lines from the gap", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 4, down: 4 }]]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
      expansion,
    });
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    // gap was 10; revealed 4 + 4 = 8; remaining = 2.
    expect(headers[1].gapAbove).toBe(2);
  });

  it("renamed file uses prevName content for deletion-side expansion via oldContent", () => {
    // Pierre's `parseFileDiffMetadata` doesn't differentiate prevName for
    // emit logic; the planner reads oldContent verbatim. The test simply
    // verifies that a deletion-side line number falls inside a context row
    // when oldContent supplies the text.
    const file = parseFile(TWO_HUNK_DIFF);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 1, down: 0 }]]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
      expansion,
    });
    const ctxLine4 = rows.find(
      (r) => r.kind === "diff-row" && r.type === "context" && r.rightLineNumber === 4,
    );
    expect(ctxLine4).toBeDefined();
    if (ctxLine4?.kind === "diff-row") {
      expect(ctxLine4.leftLineNumber).toBe(4);
      expect(ctxLine4.leftText).toBe("g4");
    }
  });

  it("default (no expansion) emits no expanded context rows in the gap", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split");
    const ctxLines = rows
      .filter((r) => r.kind === "diff-row" && r.type === "context")
      .map((r) => (r.kind === "diff-row" ? r.rightText : ""));
    // Only the in-hunk context lines (`ctx1`, `ctx14`) should be present.
    expect(ctxLines).toContain("ctx1");
    expect(ctxLines).toContain("ctx14");
    expect(ctxLines).not.toContain("g4");
    expect(ctxLines).not.toContain("g13");
  });

  // PRD #108 issue #113: classifier-collapsed file gets a single synthetic
  // `collapsed-file` interactive row in place of its diff body. Pressing
  // Enter on that row sets `fileExpanded: true` in expansion state, which
  // makes the planner emit the file's normal diff rows.
  describe("classifier-collapsed file (PRD #108 issue #113)", () => {
    it("emits exactly one 'collapsed-file' interactive row when classifierCollapsed and fileExpanded is false", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split", { classifierCollapsed: true });
      expect(rows.length).toBe(1);
      expect(rows[0].kind).toBe("interactive");
      if (rows[0].kind === "interactive") {
        expect(rows[0].subKind).toBe("collapsed-file");
        expect(rows[0].boundaryRef).toBe("top");
        expect(rows[0].text).toContain("Enter to expand");
        expect(rows[0].text).toContain("hidden");
      }
    });

    it("emits normal diff rows when classifierCollapsed and expansion has fileExpanded=true", () => {
      const file = parseFile(SIMPLE_DIFF);
      const expansion = new Map([
        ["x.txt", { fileExpanded: true, boundaries: new Map() }],
      ]);
      const rows = planRows(file, [], "split", {
        classifierCollapsed: true,
        expansion,
      });
      expect(rows.some((r) => r.kind === "diff-row")).toBe(true);
      expect(rows.some((r) => r.kind === "hunk-header")).toBe(true);
      expect(
        rows.some(
          (r) => r.kind === "interactive" && r.subKind === "collapsed-file",
        ),
      ).toBe(false);
    });

    it("does not emit a collapsed-file row when classifierCollapsed is false", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      expect(
        rows.some(
          (r) => r.kind === "interactive" && r.subKind === "collapsed-file",
        ),
      ).toBe(false);
    });

    it("collapsed-file row text includes the diff body line count", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split", { classifierCollapsed: true });
      // SIMPLE_DIFF: -1,3 +1,4 → additionCount 4 + deletionCount 3 = 7
      const collapsed = rows.find(
        (r) => r.kind === "interactive" && r.subKind === "collapsed-file",
      );
      expect(collapsed).toBeDefined();
      if (collapsed?.kind === "interactive") {
        expect(collapsed.text).toBe("··· 7 lines hidden — Enter to expand ···");
      }
    });

    it("suppresses annotation rows when collapsed (no diff rows means no anchors to attach to)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(file, [a], "split", { classifierCollapsed: true });
      expect(rows.some((r) => r.kind === "annotation")).toBe(false);
      expect(rows.length).toBe(1);
    });
  });

  it("'all' expansion fills the entire gap with context rows", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 5, down: 5 }]]),
        },
      ],
    ]);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
      expansion,
    });
    const ctxLines = rows
      .filter((r) => r.kind === "diff-row" && r.type === "context")
      .map((r) => (r.kind === "diff-row" ? r.rightText : ""));
    // gap 4..13 fully revealed (10 lines).
    for (const expected of ["g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "g13"]) {
      expect(ctxLines).toContain(expected);
    }
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(0);
  });
});

// PRD #151 / ADR 0018: hunk-header becomes a first-class interactive gap-row.
// gap-mid-top emitted for mid-file gaps > 2N (= 40); boundary-top dropped.
describe("planRows gap-row family (PRD #151)", () => {
  function buildLargeGapDiff(gapLines: number): {
    diff: string;
    newContent: string;
    oldContent: string;
  } {
    // Hunk 1 covers lines 1..3; hunk 2 starts at line `gapLines + 4`.
    // Both have one paired change so each hunk emits a real diff body.
    const hunk2Start = gapLines + 4;
    const gapBody: string[] = [];
    for (let i = 4; i <= gapLines + 3; i++) gapBody.push(`g${i}`);
    const newLines = [
      "ctx1",
      "new1",
      "ctx2",
      ...gapBody,
      `ctx${hunk2Start}`,
      `new${hunk2Start + 1}`,
      `ctx${hunk2Start + 2}`,
    ];
    const oldLines = [
      "ctx1",
      "old1",
      "ctx2",
      ...gapBody,
      `ctx${hunk2Start}`,
      `old${hunk2Start + 1}`,
      `ctx${hunk2Start + 2}`,
    ];
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -${hunk2Start},3 +${hunk2Start},3 @@
 ctx${hunk2Start}
-old${hunk2Start + 1}
+new${hunk2Start + 1}
 ctx${hunk2Start + 2}
`;
    return {
      diff,
      newContent: newLines.join("\n") + "\n",
      oldContent: oldLines.join("\n") + "\n",
    };
  }

  function parseLocal(diff: string): FileDiffMetadata {
    const patches = parsePatchFiles(diff);
    return patches[0].files[0];
  }

  it("first hunk at line 1 → first hunk-header is inert (gapAbove === 0); no boundary-top emitted", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
 ctx1
-old
+new
`;
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers.length).toBe(1);
    expect(headers[0].hunkIndex).toBe(0);
    expect(headers[0].gapAbove).toBe(0);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "boundary-top")).toBe(false);
  });

  it("first hunk at line > 1 → first hunk-header.gapAbove === firstHunkStart - 1; no boundary-top row", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -10,1 +10,1 @@
-old10
+new10
`;
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers.length).toBe(1);
    expect(headers[0].hunkIndex).toBe(0);
    expect(headers[0].gapAbove).toBe(9); // lines 1..9 hidden above hunk starting at 10
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "boundary-top")).toBe(false);
    // A first-hunk file-top gap of 9 (< 40) is NOT large enough for gap-mid-top —
    // but more importantly, file-edges never get gap-mid-top even when large.
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
  });

  it("file-edges do not get gap-mid-top even when the file-top gap > 2N", () => {
    // First hunk starts at line 200; file-top gap = 199 (way > 40).
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -200,1 +200,1 @@
-old
+new
`;
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[0].gapAbove).toBe(199);
  });

  it("mid-file gap of 40 (= 2N) → ONE row (hunk-header); no gap-mid-top", () => {
    const { diff } = buildLargeGapDiff(40);
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const interactives = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> => r.kind === "interactive",
    );
    // No gap-mid-top because gap === 2N (threshold is strictly >).
    expect(interactives.some((r) => r.subKind === "gap-mid-top")).toBe(false);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(40);
  });

  it("mid-file gap of 41 (> 2N) → TWO rows: gap-mid-top immediately above hunk-header", () => {
    const { diff } = buildLargeGapDiff(41);
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(41);
    // gap-mid-top is emitted with boundaryRef = the hunk's index.
    const gmtIdx = rows.findIndex(
      (r) => r.kind === "interactive" && r.subKind === "gap-mid-top",
    );
    expect(gmtIdx).toBeGreaterThanOrEqual(0);
    // The very next row after gap-mid-top is the second hunk-header.
    const nextRow = rows[gmtIdx + 1];
    expect(nextRow.kind).toBe("hunk-header");
    if (nextRow.kind === "hunk-header") {
      expect(nextRow.hunkIndex).toBe(1);
    }
    if (rows[gmtIdx].kind === "interactive") {
      const interactive = rows[gmtIdx] as Extract<PlannedRow, { kind: "interactive" }>;
      expect(interactive.boundaryRef).toBe(1);
    }
  });

  it("hunk with gapAbove === 0 (adjacent hunks, no hidden context) → ONE inert hunk-header", () => {
    // Two adjacent hunks: hunk 1 ends at line 3, hunk 2 starts at line 4.
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -4,1 +4,1 @@
-old4
+new4
`;
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers.length).toBe(2);
    expect(headers[1].gapAbove).toBe(0);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
  });

  it("progressive expand: large → small → zero drops gap-mid-top then makes hunk-header inert", () => {
    const { diff, oldContent, newContent } = buildLargeGapDiff(50); // mid-gap = 50 > 40
    const file = parseLocal(diff);

    // STAGE 1: no expansion → gap-mid-top + hunk-header (interactive).
    let rows = planRows(file, [], "split", { oldContent, newContent });
    let headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(50);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(true);

    // STAGE 2: partial expansion brings remaining to 45 (still > 40) — both
    // rows re-emit with updated gapAbove.
    const stage2 = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 3, down: 2 }]]),
        },
      ],
    ]);
    rows = planRows(file, [], "split", { oldContent, newContent, expansion: stage2 });
    headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(45);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(true);

    // STAGE 3: bring remaining to 40 — gap-mid-top drops out, hunk-header
    // remains interactive (gapAbove > 0).
    const stage3 = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 5, down: 5 }]]),
        },
      ],
    ]);
    rows = planRows(file, [], "split", { oldContent, newContent, expansion: stage3 });
    headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(40);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);

    // STAGE 4: full expansion → hunk-header becomes inert.
    const stage4 = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 25, down: 25 }]]),
        },
      ],
    ]);
    rows = planRows(file, [], "split", { oldContent, newContent, expansion: stage4 });
    headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(0);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
  });
});
