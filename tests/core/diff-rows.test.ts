import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import {
  fileExpandableGapCount,
  fileHasHiddenGap,
  hunkHeaderExpandPlan,
  planRows,
  type PlannedRow,
} from "../../src/core/diff-rows.js";
import type { Comment } from "../../src/core/types.js";

function parseFile(rawDiff: string): FileDiffMetadata {
  const patches = parsePatchFiles(rawDiff);
  if (patches.length === 0 || patches[0].files.length === 0) {
    throw new Error("expected at least one parsed file");
  }
  return patches[0].files[0];
}

function ann(overrides: Partial<Comment> & Pick<Comment, "id" | "side" | "line_start" | "line_end">): Comment {
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

  it("returns rows with no comments when comments list is empty", () => {
    const file = parseFile(SIMPLE_DIFF);
    const rows = planRows(file, [], "split");
    expect(rows.some((r) => r.kind === "comment")).toBe(false);
    expect(rows.some((r) => r.kind === "hunk-header")).toBe(true);
    expect(rows.some((r) => r.kind === "diff-row")).toBe(true);
  });

  it("inserts a single-line comment on additions directly after its anchor row", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    expect(prev.kind).toBe("diff-row");
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(2);
    }
    const annRow = rows[annIdx];
    if (annRow.kind === "comment") {
      expect(annRow.id).toBe("a1");
      expect(annRow.comment.id).toBe("a1");
    }
  });

  it("places the card after the row matching line_end for a multi-line comment on additions", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 3 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(3);
    } else {
      throw new Error("expected diff-row before comment");
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
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.leftLineNumber).toBe(3);
    } else {
      throw new Error("expected diff-row before comment");
    }
  });

  it("places multiple comments on different anchor rows independently", () => {
    const file = parseFile(SIMPLE_DIFF);
    const a1 = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
    const a2 = ann({ id: "a2", side: "additions", line_start: 3, line_end: 3 });
    const rows = planRows(file, [a1, a2], "split");
    const annIds = rows
      .filter((r): r is Extract<PlannedRow, { kind: "comment" }> => r.kind === "comment")
      .map((r) => r.id);
    expect(annIds).toEqual(["a1", "a2"]);
    const a1Idx = rows.findIndex((r) => r.kind === "comment" && r.id === "a1");
    const a2Idx = rows.findIndex((r) => r.kind === "comment" && r.id === "a2");
    const before1 = rows[a1Idx - 1];
    const before2 = rows[a2Idx - 1];
    if (before1.kind === "diff-row") expect(before1.rightLineNumber).toBe(2);
    if (before2.kind === "diff-row") expect(before2.rightLineNumber).toBe(3);
  });

  it("stacks multiple comments sharing the same line_end in created_at ascending order", () => {
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
      .filter((r): r is Extract<PlannedRow, { kind: "comment" }> => r.kind === "comment")
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
      .filter((r): r is Extract<PlannedRow, { kind: "comment" }> => r.kind === "comment")
      .map((r) => r.id);
    expect(annIds).toEqual(["a", "b"]);
  });

  // Issue #300: a comment whose `line_end` falls outside the planner's
  // emitted same-side diff rows used to be silently dropped, breaking n/p
  // navigation when the bundle bookmark counter `[K/M]` claimed the card
  // existed. The fallback ladder is: exact match → nearest preceding same-
  // side row → first same-side row → file's first emitted row.
  it("falls back to the nearest preceding same-side row when line_end is past the last in-hunk line (issue #300)", () => {
    const file = parseFile(SIMPLE_DIFF);
    // SIMPLE_DIFF's only hunk emits additions rows at lines 2 and 3.
    // line_end = 99 sits past every emitted addition line — the previous
    // behavior was to silently drop the card.
    const a = ann({ id: "ghost", side: "additions", line_start: 99, line_end: 99 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(3);
    } else {
      throw new Error("expected nearest preceding additions row before card");
    }
  });

  it("falls back to the nearest preceding additions row when line_end is between two hunks (issue #300)", () => {
    // Two hunks with a 10-line gap between them. line_end = 7 sits in the
    // unexpanded mid-file gap (lines 4..13 hidden). The card should anchor
    // to line 3 — the nearest preceding additions diff row.
    const diff = `diff --git a/x.txt b/x.txt
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
    const file = parseFile(diff);
    const a = ann({ id: "gap", side: "additions", line_start: 7, line_end: 7 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(3);
    } else {
      throw new Error("expected nearest preceding additions row before card");
    }
  });

  it("falls forward to the first same-side row when line_end precedes every emitted same-side row (issue #300)", () => {
    // The only hunk starts at line 5; nothing on the additions side appears
    // before line 5. line_end = 2 has no preceding same-side row, so the
    // card snaps forward onto the first additions row in the file (line 5).
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,1 +5,1 @@
-old5
+new5
`;
    const file = parseFile(diff);
    const a = ann({ id: "early", side: "additions", line_start: 2, line_end: 2 });
    const rows = planRows(file, [a], "split");
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.rightLineNumber).toBe(5);
    } else {
      throw new Error("expected first additions row before card");
    }
  });

  it("CardFlatRow.lineEnd preserves the comment's authored line_end after a fallback snap (issue #300)", () => {
    // Even when the card snaps to a fallback diff row, the CommentRow it
    // emits carries the original comment (line_end intact) so downstream
    // consumers (URL, click routing, agent reply targets) see the true
    // anchor — not the snap target.
    const file = parseFile(SIMPLE_DIFF);
    const a = ann({ id: "ghost", side: "additions", line_start: 99, line_end: 99 });
    const rows = planRows(file, [a], "split");
    const annRow = rows.find((r) => r.kind === "comment");
    if (annRow?.kind === "comment") {
      expect(annRow.comment.line_end).toBe(99);
      expect(annRow.comment.line_start).toBe(99);
    } else {
      throw new Error("expected comment row to be emitted");
    }
  });

  it("places a deletions-side comment after the matching row in unified layout", () => {
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
    const annIdx = rows.findIndex((r) => r.kind === "comment");
    expect(annIdx).toBeGreaterThan(0);
    const prev = rows[annIdx - 1];
    if (prev.kind === "diff-row") {
      expect(prev.type).toBe("deletion");
      expect(prev.leftLineNumber).toBe(1);
      expect(prev.rightLineNumber).toBeNull();
    } else {
      throw new Error("expected diff-row before comment");
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
    it("does not set any tint/gutter flags when comments list is empty", () => {
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

    it("sets right-only flags for an additions comment in split layout", () => {
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

    it("sets left-only flags for a deletions comment in split layout", () => {
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

    it("unions per-side flags when multiple comments cover the same rows", () => {
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

    it("unions flags when two additions comments have overlapping ranges", () => {
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

    it("produces a different flag distribution when toggling layout for the same comments", () => {
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

    it("sets flags on a single-line comment the same as on multi-line ones", () => {
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

  // issue #199: `planRows(file, comments, ...)` was matching comment
  // anchors by `(side, line_end)` without checking `ann.file`. Calling it
  // with the cross-file comment list — as the webapp does — leaked card
  // rows AND tint/gutter flags into every file whose line range overlapped
  // another file's comment `line_end`. Fix: filter at the top of
  // planRows so every downstream helper inherits a file-scoped list.
  describe("file-scoped comments (issue #199)", () => {
    // Two diffs whose line ranges overlap at line 2 on the additions side.
    const DIFF_A = `diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ a/a.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;
    const DIFF_B = `diff --git a/b.txt b/b.txt
index 1..2 100644
--- a/b.txt
+++ b/b.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;

    it("emits the card row in the comment's own file", () => {
      const fileA = parsePatchFiles(DIFF_A)[0].files[0];
      const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(fileA, [a], "split");
      const cards = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "comment" }> => r.kind === "comment",
      );
      expect(cards.map((c) => c.id)).toEqual(["a1"]);
    });

    it("emits zero card rows in a foreign file even when a comment's line_end falls inside it", () => {
      // Bug repro: pass a comment anchored to a.txt while planning b.txt.
      // The leak puts a phantom card row into b.txt's planned stream.
      const fileB = parsePatchFiles(DIFF_B)[0].files[0];
      const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(fileB, [a], "split");
      const cards = rows.filter((r) => r.kind === "comment");
      expect(cards.length).toBe(0);
    });

    it("does not set tint/gutter flags from a foreign file's comment", () => {
      // Same class of bug as the phantom card: applyCommentFlags matched
      // `(side, line)` without a file check. Verify diff-rows in b.txt stay
      // un-tinted when only a.txt has an overlapping-line comment.
      const fileB = parsePatchFiles(DIFF_B)[0].files[0];
      const a = ann({ id: "a1", file: "a.txt", side: "additions", line_start: 2, line_end: 3 });
      const rows = planRows(fileB, [a], "split");
      const diffRows = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row",
      );
      for (const r of diffRows) {
        expect(r.rightTinted).toBeFalsy();
        expect(r.leftTinted).toBeFalsy();
        expect(r.rightGutter).toBeFalsy();
        expect(r.leftGutter).toBeFalsy();
      }
    });

    it("still emits the card + tint in the home file when both files are in the comment list", () => {
      // Smoke test: planning a.txt with the same cross-file comment list
      // emits exactly the home-file card and its tint, unaffected by the
      // foreign comment that the webapp also forwards.
      const fileA = parsePatchFiles(DIFF_A)[0].files[0];
      const own = ann({ id: "own", file: "a.txt", side: "additions", line_start: 2, line_end: 2 });
      const foreign = ann({ id: "foreign", file: "b.txt", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(fileA, [own, foreign], "split");
      const cards = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "comment" }> => r.kind === "comment",
      );
      expect(cards.map((c) => c.id)).toEqual(["own"]);
      const tintedRight = rows.filter(
        (r): r is Extract<PlannedRow, { kind: "diff-row" }> => r.kind === "diff-row" && r.rightTinted === true,
      );
      expect(tintedRight.length).toBe(1);
      expect(tintedRight[0].rightLineNumber).toBe(2);
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

  it("emits an expand-down row for the file-bottom gap when last hunk doesn't reach EOF (issue #280)", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
    });
    // newContent has 16 lines; second hunk's last line is 15; gap = 1.
    // Issue #280: file-bottom is always `expand-down` (GitHub layout) —
    // size-independent.
    const bottom = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "expand-down" && r.boundaryRef === "bottom",
    );
    expect(bottom).toBeDefined();
    if (bottom?.kind === "interactive") {
      expect(bottom.boundaryRef).toBe("bottom");
      expect(bottom.gapAbove).toBe(1);
    }
  });

  it("emits gapAbove on the standalone expand-down row reflecting the remaining gap size (issue #280)", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,1 +1,1 @@
-old
+new
@@ -50,1 +50,1 @@
-old50
+new50
`;
    const file = parseFile(diff);
    const rows = planRows(file, [], "split");
    // Mid-file gap: lines 2..49 hidden = 48. > 40 so the planner emits
    // a standalone expand-down + hunk-header[primaryExpand 'up'].
    const down = rows.find(
      (r) => r.kind === "interactive" && r.subKind === "expand-down",
    );
    expect(down).toBeDefined();
    if (down?.kind === "interactive") expect(down.gapAbove).toBe(48);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].primaryExpand).toBe("up");
    expect(headers[1].gapAbove).toBe(48);
  });

  it("does NOT emit a file-bottom expand-down row when newContent is missing", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split");
    const bottom = rows.find(
      (r) =>
        r.kind === "interactive" &&
        r.boundaryRef === "bottom" &&
        r.subKind === "expand-down",
    );
    expect(bottom).toBeUndefined();
  });

  // Issue #160 / PRD #151 US-10: file-bottom affordance rows are pure
  // affordances (no @@-metadata, unlike hunk-header). Once Pierre has
  // revealed every line of the file-bottom gap, the row drops out —
  // leaving it visible with "0 hidden" is a cursor trap.
  it("does NOT emit a file-bottom directional row when the gap is fully absorbed", () => {
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
      (r) =>
        r.kind === "interactive" &&
        r.boundaryRef === "bottom" &&
        r.subKind === "expand-down",
    );
    expect(bottom).toBeUndefined();
  });

  it("emits expand-down with reduced count when file-bottom gap is partially absorbed (issue #280)", () => {
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
    // remaining = 3 → expand-down row carries gapAbove = 3 (issue #280:
    // file-bottom always uses Expand Down regardless of size).
    const bottom = rows.find(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> =>
        r.kind === "interactive" && r.boundaryRef === "bottom" && r.subKind === "expand-down",
    );
    expect(bottom).toBeDefined();
    expect(bottom?.gapAbove).toBe(3);
  });

  it("emits expand-down with the original count when no file-bottom expansion has occurred (issue #280)", () => {
    const file = parseFile(TWO_HUNK_DIFF);
    const rows = planRows(file, [], "split", {
      oldContent: OLD_CONTENT_TWO_HUNK,
      newContent: NEW_CONTENT_TWO_HUNK,
    });
    // file-bottom gap = 1 line → expand-down carries gapAbove = 1.
    const bottom = rows.find(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> =>
        r.kind === "interactive" && r.boundaryRef === "bottom" && r.subKind === "expand-down",
    );
    expect(bottom).toBeDefined();
    expect(bottom?.gapAbove).toBe(1);
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

    it("suppresses comment rows when collapsed (no diff rows means no anchors to attach to)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const a = ann({ id: "a1", side: "additions", line_start: 2, line_end: 2 });
      const rows = planRows(file, [a], "split", { classifierCollapsed: true });
      expect(rows.some((r) => r.kind === "comment")).toBe(false);
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
// PRD #270 / issue #271 replaces gap-mid-top with directional rows:
// `expand-up` / `expand-down` / `expand-all` emitted via `expandRowsForGap`.
describe("planRows gap-row family (PRD #151 / #270)", () => {
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

  it("first hunk at line > 1 → first hunk-header.gapAbove === firstHunkStart - 1; primaryExpand 'all' (small gap)", () => {
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
    // Issue #280: a first-hunk file-top gap of 9 (< 40) folds onto the
    // hunk-header banner's `primaryExpand: "all"`; no standalone
    // interactive row.
    expect(headers[0].primaryExpand).toBe("all");
    expect(rows.some((r) => r.kind === "interactive")).toBe(false);
  });

  it("file-top hunk with gap >= 40 emits a hunk-header with primaryExpand 'up' (issue #280)", () => {
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
    const interactives = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> => r.kind === "interactive",
    );
    // File-top: no standalone interactive rows (primaryExpand on banner only).
    expect(interactives.length).toBe(0);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[0].gapAbove).toBe(199);
    expect(headers[0].primaryExpand).toBe("up");
  });

  it("mid-file gap of 40 (= 2N) → standalone expand-down + hunk-header[primaryExpand 'up'] (threshold is `< 40`)", () => {
    const { diff } = buildLargeGapDiff(40);
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const interactives = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> => r.kind === "interactive",
    );
    expect(interactives.some((r) => r.subKind === "expand-down")).toBe(true);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(40);
    expect(headers[1].primaryExpand).toBe("up");
  });

  it("mid-file gap of 41 (>= 40) → standalone expand-down immediately above hunk-header[primaryExpand 'up'] (issue #280)", () => {
    const { diff } = buildLargeGapDiff(41);
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(41);
    expect(headers[1].primaryExpand).toBe("up");
    // One interactive row above the second hunk-header: expand-down.
    const headerIdx = rows.findIndex(
      (r) => r.kind === "hunk-header" && r.hunkIndex === 1,
    );
    const downRow = rows[headerIdx - 1];
    expect(downRow.kind).toBe("interactive");
    if (downRow.kind === "interactive") {
      expect(downRow.subKind).toBe("expand-down");
      expect(downRow.boundaryRef).toBe(1);
      expect(downRow.gapAbove).toBe(41);
    }
    // Row just before the expand-down should NOT be interactive — only
    // ONE leading row in the new model (issue #280).
    const beforeDown = rows[headerIdx - 2];
    if (beforeDown.kind === "interactive") {
      throw new Error("expected at most one interactive row above the hunk-header");
    }
  });

  it("mid-file gap of 39 (< 40) → ONE hunk-header[primaryExpand 'all'] row (issue #280)", () => {
    const { diff } = buildLargeGapDiff(39);
    const file = parseLocal(diff);
    const rows = planRows(file, [], "split");
    const interactives = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> => r.kind === "interactive",
    );
    // No standalone interactive rows for a sub-threshold mid-file gap.
    expect(interactives.length).toBe(0);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(39);
    expect(headers[1].primaryExpand).toBe("all");
  });

  it("hunk with gapAbove === 0 (adjacent hunks, no hidden context) → ONE inert hunk-header (primaryExpand null)", () => {
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
    expect(headers[1].primaryExpand).toBe(null);
    // No standalone interactive rows for an adjacent-hunks gap of 0.
    expect(rows.some((r) => r.kind === "interactive")).toBe(false);
  });

  it("progressive expand: large → small → zero downgrades expand-down+banner → banner only → inert (issue #280)", () => {
    const { diff, oldContent, newContent } = buildLargeGapDiff(50); // mid-gap = 50 >= 40
    const file = parseLocal(diff);

    const counts = (rows: PlannedRow[]) => ({
      down: rows.filter((r) => r.kind === "interactive" && r.subKind === "expand-down").length,
    });

    // STAGE 1: no expansion → standalone expand-down + hunk-header(primaryExpand 'up').
    let rows = planRows(file, [], "split", { oldContent, newContent });
    let headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(50);
    expect(headers[1].primaryExpand).toBe("up");
    expect(counts(rows)).toMatchObject({ down: 1 });

    // STAGE 2: partial expansion brings remaining to 45 (still >= 40) — same shape.
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
    expect(headers[1].primaryExpand).toBe("up");
    expect(counts(rows)).toMatchObject({ down: 1 });

    // STAGE 3: bring remaining to 39 (< 40) — expand-down drops out;
    // banner's primaryExpand becomes 'all'.
    const stage3 = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map([[1, { up: 5, down: 6 }]]),
        },
      ],
    ]);
    rows = planRows(file, [], "split", { oldContent, newContent, expansion: stage3 });
    headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(39);
    expect(headers[1].primaryExpand).toBe("all");
    expect(counts(rows)).toMatchObject({ down: 0 });

    // STAGE 4: full expansion → no interactive rows; banner inert (primaryExpand null).
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
    expect(headers[1].primaryExpand).toBe(null);
    expect(counts(rows)).toMatchObject({ down: 0 });
  });
});

// Issue #280: pure helper that decides what a hunk-header banner's
// primary expand cell carries + whether a standalone Expand Down row
// is emitted above the banner. The (gap-size × isFirst) decision is
// the slice's load-bearing logic — the planner is just a caller.
describe("hunkHeaderExpandPlan (issue #280)", () => {
  it("returns null + no leading expand-down when gapAbove === 0", () => {
    expect(hunkHeaderExpandPlan(0, false)).toEqual({
      primaryExpand: null,
      emitLeadingExpandDown: false,
    });
    expect(hunkHeaderExpandPlan(0, true)).toEqual({
      primaryExpand: null,
      emitLeadingExpandDown: false,
    });
  });

  it("returns 'all' for a small mid-file gap (gapAbove < 40)", () => {
    expect(hunkHeaderExpandPlan(1, false)).toEqual({
      primaryExpand: "all",
      emitLeadingExpandDown: false,
    });
    expect(hunkHeaderExpandPlan(20, false)).toEqual({
      primaryExpand: "all",
      emitLeadingExpandDown: false,
    });
    expect(hunkHeaderExpandPlan(39, false)).toEqual({
      primaryExpand: "all",
      emitLeadingExpandDown: false,
    });
  });

  it("returns 'all' for a small file-top gap (gapAbove < 40, isFirst)", () => {
    expect(hunkHeaderExpandPlan(9, true)).toEqual({
      primaryExpand: "all",
      emitLeadingExpandDown: false,
    });
    expect(hunkHeaderExpandPlan(39, true)).toEqual({
      primaryExpand: "all",
      emitLeadingExpandDown: false,
    });
  });

  it("returns 'up' + leading expand-down for a large mid-file gap (gapAbove >= 40, !isFirst)", () => {
    expect(hunkHeaderExpandPlan(40, false)).toEqual({
      primaryExpand: "up",
      emitLeadingExpandDown: true,
    });
    expect(hunkHeaderExpandPlan(100, false)).toEqual({
      primaryExpand: "up",
      emitLeadingExpandDown: true,
    });
  });

  it("returns 'up' + NO leading expand-down for a large file-top gap", () => {
    expect(hunkHeaderExpandPlan(40, true)).toEqual({
      primaryExpand: "up",
      emitLeadingExpandDown: false,
    });
    expect(hunkHeaderExpandPlan(199, true)).toEqual({
      primaryExpand: "up",
      emitLeadingExpandDown: false,
    });
  });

  it("threshold is strictly `< 40` for 'all'; exactly 40 selects the directional 'up' + leading down", () => {
    expect(hunkHeaderExpandPlan(39, false).primaryExpand).toBe("all");
    expect(hunkHeaderExpandPlan(40, false)).toEqual({
      primaryExpand: "up",
      emitLeadingExpandDown: true,
    });
  });

  it("guards against negative inputs (defensive: gapAbove <= 0 → null)", () => {
    expect(hunkHeaderExpandPlan(-1, false).primaryExpand).toBe(null);
  });
});

// Issue #297: the per-file Expand-all-hidden affordance moved from a
// standalone planner-emitted row to the TUI's file-header chrome,
// mirroring the web's file-header chrome treatment. The planner no
// longer emits any row carrying this affordance.
describe("per-file Expand-all is NOT emitted by the planner (issue #297)", () => {
  const NEW_CONTENT =
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

  const TWO_HUNK_WITH_GAP = `diff --git a/x.txt b/x.txt
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

  it("never emits a per-file Expand-all row, even with hidden gaps", () => {
    const file = parseFile(TWO_HUNK_WITH_GAP);
    const rows = planRows(file, [], "split", { newContent: NEW_CONTENT });
    // No interactive row should carry the retired `expand-file-all`
    // subkind, nor a planner-emitted "Expand all hidden" text body.
    expect(
      rows.some(
        (r) =>
          r.kind === "interactive" &&
          (r.subKind as string) === "expand-file-all",
      ),
    ).toBe(false);
    expect(
      rows.some(
        (r) =>
          r.kind === "interactive" &&
          typeof r.text === "string" &&
          r.text.includes("Expand all hidden"),
      ),
    ).toBe(false);
  });
});

// Issue #297: `fileHasHiddenGap` is now exported so the TUI's file-header
// chrome can decide when to render the `↕` Expand-all affordance from
// the same source of truth the planner used.
describe("fileHasHiddenGap (issue #297, public export)", () => {
  const NEW_CONTENT =
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

  const TWO_HUNK_WITH_GAP = `diff --git a/x.txt b/x.txt
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

  it("returns true when at least one mid-file or file-top gap is hidden", () => {
    const file = parseFile(TWO_HUNK_WITH_GAP);
    expect(fileHasHiddenGap(file, undefined, NEW_CONTENT)).toBe(true);
  });

  it("returns false when no gap remains hidden (first hunk at line 1, no file-bottom remainder)", () => {
    const noGap = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;
    const file = parseFile(noGap);
    expect(fileHasHiddenGap(file, undefined, undefined)).toBe(false);
  });

  it("returns false after every gap has been saturated by expansion", () => {
    const file = parseFile(TWO_HUNK_WITH_GAP);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map<number | "top" | "bottom", { up: number; down: number }>([
            [1, { up: 5, down: 5 }],
            ["bottom", { up: 0, down: 1 }],
          ]),
        },
      ],
    ]);
    expect(fileHasHiddenGap(file, expansion, NEW_CONTENT)).toBe(false);
  });

  it("returns true when only the file-bottom gap has remaining hidden content", () => {
    const noTopOrMidGap = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,1 +1,1 @@
-old
+new
`;
    const file = parseFile(noTopOrMidGap);
    const newContent = ["new", "tail1", "tail2"].join("\n") + "\n";
    expect(fileHasHiddenGap(file, undefined, newContent)).toBe(true);
  });
});

// Issue #298: the file-header chrome `↕` Expand-all affordance renders
// iff the file has ≥ 2 distinct expandable gaps. A single-gap file is
// already covered by its per-hunk banner button (or standalone
// expand-down for file-bottom); showing the chrome would stack a
// redundant second `↕`. The new pure helper counts the gaps that still
// have hidden content after current expansion.
describe("fileExpandableGapCount (issue #298)", () => {
  // Two hunks (5,3 and 14,2) over a 16-line newContent: file-top gap of
  // 4, mid-file gap of 6, file-bottom gap of 1 — three distinct gaps.
  const TWO_HUNK_THREE_GAPS = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,3 +5,3 @@
 ctx5
-old5
+new5
 ctx6
@@ -14,2 +14,2 @@
 ctx14
-old14
+new14
`;

  const NEW_CONTENT_THREE_GAPS =
    [
      "h1",
      "h2",
      "h3",
      "h4",
      "ctx5",
      "new5",
      "ctx6",
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

  it("returns 0 when the file has no hunks", () => {
    const noHunks: FileDiffMetadata = {
      name: "x.txt",
      type: "modified",
      hunks: [],
      additionLines: [],
      deletionLines: [],
    } as unknown as FileDiffMetadata;
    expect(fileExpandableGapCount(noHunks, undefined, undefined)).toBe(0);
  });

  it("returns 0 for a one-hunk file with no hidden content (hunk covers whole file)", () => {
    const noGap = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;
    const file = parseFile(noGap);
    // newContent's 3 lines all sit inside the hunk's coverage → no
    // file-top gap (additionStart=1) and no file-bottom gap remainder.
    const newContent = ["ctx", "new", "added"].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(0);
  });

  it("returns 1 for a one-hunk file with hidden content above only", () => {
    const aboveOnly = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,3 +5,3 @@
 ctx5
-old5
+new5
 ctx6
`;
    const file = parseFile(aboveOnly);
    // newContent: 7 lines total, hunk covers 5..7 → no file-bottom gap;
    // file-top gap = 4 lines (1..4).
    const newContent = ["h1", "h2", "h3", "h4", "ctx5", "new5", "ctx6"].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(1);
  });

  it("returns 1 for a one-hunk file with hidden content below only", () => {
    const belowOnly = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old2
+new2
 ctx3
`;
    const file = parseFile(belowOnly);
    // hunk covers lines 1..3; newContent has 5 lines → file-bottom gap = 2.
    const newContent = ["ctx1", "new2", "ctx3", "tail4", "tail5"].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(1);
  });

  it("returns 2 for a one-hunk file with hidden content above AND below", () => {
    const aboveAndBelow = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,3 +5,3 @@
 ctx5
-old5
+new5
 ctx6
`;
    const file = parseFile(aboveAndBelow);
    // file-top gap = 4 (lines 1..4); hunk covers 5..7; file-bottom gap = 3 (lines 8..10).
    const newContent =
      ["h1", "h2", "h3", "h4", "ctx5", "new5", "ctx6", "t8", "t9", "t10"].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(2);
  });

  it("returns 1 for two adjacent hunks (between-gap = 0) with only a file-top gap", () => {
    const twoAdjacent = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,3 +5,3 @@
 ctx5
-old5
+new5
 ctx6
@@ -8,2 +8,2 @@
-old8
+new8
 ctx9
`;
    const file = parseFile(twoAdjacent);
    // file-top gap = 4 (lines 1..4); hunks cover 5..9; no file-bottom gap.
    const newContent =
      ["h1", "h2", "h3", "h4", "ctx5", "new5", "ctx6", "new8", "ctx9"].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(1);
  });

  it("returns 1 for two hunks with hidden content only between them (no top / bottom gap)", () => {
    const onlyMidGap = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old2
+new2
 ctx3
@@ -14,2 +14,2 @@
 ctx14
-old14
+new14
`;
    const file = parseFile(onlyMidGap);
    // file-top gap = 0; mid gap (4..13) = 10; file-bottom gap = 0 — last
    // hunk covers 14..15 and newContent has exactly 15 lines.
    const newContent =
      [
        "ctx1",
        "new2",
        "ctx3",
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
      ].join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(1);
  });

  it("returns 3 for two hunks with hidden content above AND between AND below", () => {
    const file = parseFile(TWO_HUNK_THREE_GAPS);
    // file-top gap = 4 (lines 1..4); mid gap (8..13) = 6; file-bottom = 1 (line 16).
    expect(fileExpandableGapCount(file, undefined, NEW_CONTENT_THREE_GAPS)).toBe(3);
  });

  it("returns 4 for three+ hunks with multiple gaps", () => {
    const threeHunks = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -5,1 +5,1 @@
-old5
+new5
@@ -20,1 +20,1 @@
-old20
+new20
@@ -40,1 +40,1 @@
-old40
+new40
`;
    const file = parseFile(threeHunks);
    // file-top gap = 4 (1..4); mid 1 = 14 (6..19); mid 2 = 19 (21..39);
    // file-bottom: newContent has 45 lines → 5 (41..45). All four gaps present.
    const lines: string[] = [];
    for (let i = 1; i <= 45; i++) {
      if (i === 5) lines.push("new5");
      else if (i === 20) lines.push("new20");
      else if (i === 40) lines.push("new40");
      else lines.push(`l${i}`);
    }
    const newContent = lines.join("\n") + "\n";
    expect(fileExpandableGapCount(file, undefined, newContent)).toBe(4);
  });

  it("drops by 1 after partial expansion fully reveals one of three gaps", () => {
    const file = parseFile(TWO_HUNK_THREE_GAPS);
    // Starts at 3 gaps (top/mid/bottom). Saturate the file-top gap by
    // expanding 4 lines from the file-top boundary's `down` side.
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map<number | "top" | "bottom", { up: number; down: number }>([
            ["top", { up: 0, down: 4 }],
          ]),
        },
      ],
    ]);
    expect(fileExpandableGapCount(file, expansion, NEW_CONTENT_THREE_GAPS)).toBe(2);
  });

  it("drops to 0 once every gap is saturated", () => {
    const file = parseFile(TWO_HUNK_THREE_GAPS);
    const expansion = new Map([
      [
        "x.txt",
        {
          fileExpanded: false,
          boundaries: new Map<number | "top" | "bottom", { up: number; down: number }>([
            ["top", { up: 0, down: 4 }],
            [1, { up: 3, down: 3 }],
            ["bottom", { up: 0, down: 1 }],
          ]),
        },
      ],
    ]);
    expect(fileExpandableGapCount(file, expansion, NEW_CONTENT_THREE_GAPS)).toBe(0);
  });
});
