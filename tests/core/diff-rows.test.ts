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
