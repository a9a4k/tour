import { describe, it, expect } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { flatRows } from "../../src/core/flat-rows.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import {
  validateCursor,
  cursorAtFirstFileRow,
  resolveCursorRowIdx,
  type Cursor,
} from "../../src/core/cursor-state.js";
import type { DiffFile } from "../../src/core/diff-model.js";

const SIMPLE_DIFF = `diff --git a/REPLACE b/REPLACE
index 1..2 100644
--- a/REPLACE
+++ b/REPLACE
@@ -1,3 +1,4 @@
 ctx
-old
+new
+added
`;

function fileFromName(name: string): DiffFile {
  return { name, type: "change", hunks: [] };
}

function plannedFor(layout: "split" | "unified"): PlannedRow[] {
  const meta = parsePatchFiles(SIMPLE_DIFF.replace(/REPLACE/g, "x.txt"))[0].files[0];
  return planRows(meta, [], layout);
}

/**
 * App-level smokes for cursor edge cases at state transitions. Each test
 * composes the same pure helpers app.tsx wires together (`flatRows` →
 * `validateCursor`/`cursorAtFirstFileRow`) — App's role is just plumbing,
 * so the contract sits at the helper layer.
 */
describe("fold invalidation: cursor's file becomes folded", () => {
  it("snaps cursor to the next file's first row in stream order", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const allUnfolded = flatRows([fa, fb], planned, () => false);
    const aRow = allUnfolded.find((r) => r.file === "a.txt")!;
    const cursor: Cursor = {
      file: aRow.file,
      lineNumber: aRow.lineNumber,
      side: aRow.side,
      preferredSide: aRow.side,
    };

    // Now fold a.txt. flatRows recomputes without a.txt's rows.
    const aFolded = flatRows([fa, fb], planned, (n) => n === "a.txt");
    const validated = validateCursor(cursor, aFolded, [fa, fb]);
    expect(validated?.file).toBe("b.txt");
  });

  it("returns null when no other file has annotatable rows", () => {
    const fa = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("split")]]);
    const cursor: Cursor = {
      file: "a.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    const allFolded = flatRows([fa], planned, () => true);
    expect(validateCursor(cursor, allFolded, [fa])).toBeNull();
  });

  it("non-cursor file folding leaves the cursor anchor untouched", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const allUnfolded = flatRows([fa, fb], planned, () => false);
    const aRow = allUnfolded.find((r) => r.file === "a.txt")!;
    const cursor: Cursor = {
      file: "a.txt",
      lineNumber: aRow.lineNumber,
      side: aRow.side,
      preferredSide: aRow.side,
    };

    // Fold b.txt (not the cursor's file). Cursor anchor should still resolve.
    const bFolded = flatRows([fa, fb], planned, (n) => n === "b.txt");
    const validated = validateCursor(cursor, bFolded, [fa, fb]);
    expect(validated).toEqual(cursor);
  });

  it("unfolding any file leaves the cursor untouched", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const bFolded = flatRows([fa, fb], planned, (n) => n === "b.txt");
    const aRow = bFolded.find((r) => r.file === "a.txt")!;
    const cursor: Cursor = {
      file: "a.txt",
      lineNumber: aRow.lineNumber,
      side: aRow.side,
      preferredSide: aRow.side,
    };

    const allUnfolded = flatRows([fa, fb], planned, () => false);
    const validated = validateCursor(cursor, allUnfolded, [fa, fb]);
    expect(validated).toEqual(cursor);
  });
});

describe("layout toggle preserves cursor anchor", () => {
  it("an anchor that resolves in split also resolves in unified", () => {
    const f = fileFromName("x.txt");
    const splitPlanned = new Map<string, PlannedRow[]>([["x.txt", plannedFor("split")]]);
    const unifiedPlanned = new Map<string, PlannedRow[]>([["x.txt", plannedFor("unified")]]);
    const splitFlat = flatRows([f], splitPlanned, () => false);
    const unifiedFlat = flatRows([f], unifiedPlanned, () => false);

    const ctxRow = splitFlat.find((r) => r.leftLineNumber === 1 && r.rightLineNumber === 1)!;
    const cursor: Cursor = {
      file: ctxRow.file,
      lineNumber: ctxRow.lineNumber,
      side: ctxRow.side,
      preferredSide: ctxRow.side,
    };

    expect(resolveCursorRowIdx(cursor, splitFlat)).toBeGreaterThanOrEqual(0);
    expect(resolveCursorRowIdx(cursor, unifiedFlat)).toBeGreaterThanOrEqual(0);
    expect(validateCursor(cursor, unifiedFlat, [f])).toEqual(cursor);
  });

  it("a deletions-side anchor preserved in split also resolves in unified", () => {
    const f = fileFromName("x.txt");
    const splitPlanned = new Map<string, PlannedRow[]>([["x.txt", plannedFor("split")]]);
    const unifiedPlanned = new Map<string, PlannedRow[]>([["x.txt", plannedFor("unified")]]);
    const splitFlat = flatRows([f], splitPlanned, () => false);
    const unifiedFlat = flatRows([f], unifiedPlanned, () => false);

    // Pick the paired change row's left side (deletions).
    const paired = splitFlat.find((r) => r.paired && r.leftLineNumber === 2)!;
    const cursor: Cursor = {
      file: paired.file,
      lineNumber: paired.leftLineNumber!,
      side: "deletions",
      preferredSide: "deletions",
    };

    expect(resolveCursorRowIdx(cursor, splitFlat)).toBeGreaterThanOrEqual(0);
    expect(resolveCursorRowIdx(cursor, unifiedFlat)).toBeGreaterThanOrEqual(0);
  });
});

describe("sidebar file click moves cursor to clicked file's first row", () => {
  it("clicking file B sets cursor at B's first annotatable row", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const flat = flatRows([fa, fb], planned, () => false);
    const cursor = cursorAtFirstFileRow("b.txt", flat);
    const firstB = flat.find((r) => r.file === "b.txt")!;
    expect(cursor?.file).toBe("b.txt");
    expect(cursor?.lineNumber).toBe(firstB.lineNumber);
  });

  it("clicking a folded file sets cursor to null (no annotatable rows)", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const flat = flatRows([fa, fb], planned, (n) => n === "b.txt");
    expect(cursorAtFirstFileRow("b.txt", flat)).toBeNull();
  });
});

// Bundle reload (watcher fired) preserves cursor position.
// validateCursor only mutates the cursor when the anchor is genuinely
// lost (e.g. the agent removed the file from the bundle); in the typical
// "agent appended an annotation" case the anchor still resolves and the
// cursor stays put.
describe("bundle reload preserves cursor", () => {
  it("preserves cursor when the agent appends an annotation (anchor still resolves)", () => {
    const f = fileFromName("x.txt");
    const planned = new Map<string, PlannedRow[]>([["x.txt", plannedFor("split")]]);
    const before = flatRows([f], planned, () => false);
    const ctxRow = before[0];
    const cursor: Cursor = {
      file: ctxRow.file,
      lineNumber: ctxRow.lineNumber,
      side: ctxRow.side,
      preferredSide: ctxRow.side,
    };

    // Reload yields the same flat sequence (the diff content didn't change;
    // only annotations did, which doesn't alter flatRows since annotation
    // rows are skipped). Cursor must be returned unchanged.
    const after = flatRows([f], planned, () => false);
    expect(validateCursor(cursor, after, [f])).toEqual(cursor);
  });

  it("snaps cursor when a file is removed from the new bundle", () => {
    const fa = fileFromName("a.txt");
    const fb = fileFromName("b.txt");
    const planned = new Map<string, PlannedRow[]>([
      ["a.txt", plannedFor("split")],
      ["b.txt", plannedFor("split")],
    ]);
    const before = flatRows([fa, fb], planned, () => false);
    const aRow = before.find((r) => r.file === "a.txt")!;
    const cursor: Cursor = {
      file: "a.txt",
      lineNumber: aRow.lineNumber,
      side: aRow.side,
      preferredSide: aRow.side,
    };

    // New bundle drops a.txt (e.g. agent rewrote the tour without it).
    const afterPlanned = new Map<string, PlannedRow[]>([["b.txt", plannedFor("split")]]);
    const after = flatRows([fb], afterPlanned, () => false);
    const validated = validateCursor(cursor, after, [fb]);
    // a.txt isn't in the new files list, so the snap can't anchor the
    // pre-fold file and the cursor goes null per the contract.
    expect(validated).toBeNull();
  });
});

// Cursor must be null in degraded states so `a` is a silent no-op
// (composer-state already returns null for cursor-null + no current
// annotation, but the seeding effect in app.tsx must not materialize a
// cursor when there are no rows).
describe("cursor null in degraded states", () => {
  it("empty tour (no files) → cursor stays null", () => {
    expect(flatRows([], new Map(), () => false)).toEqual([]);
  });

  it("all-folded tour → cursor stays null", () => {
    const fa = fileFromName("a.txt");
    const planned = new Map<string, PlannedRow[]>([["a.txt", plannedFor("split")]]);
    const allFolded = flatRows([fa], planned, () => true);
    expect(allFolded).toEqual([]);
  });

  it("snapshot-lost contract: empty plannedRowsByFile yields empty flat sequence", () => {
    // App.tsx's snapshotLost branch hides the diff pane, but flatRows
    // independently degrades to [] when no file has planned rows — which
    // is the path the cursor seed checks before materializing.
    const fa = fileFromName("a.txt");
    const empty = new Map<string, PlannedRow[]>();
    expect(flatRows([fa], empty, () => false)).toEqual([]);
  });
});
