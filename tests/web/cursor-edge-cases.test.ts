// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { validateWebappCursor } from "../../src/web/client/cursor-validation.js";
import type { RowAnchor } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";

function diffRow(parts: {
  file: string;
  lineNumber: number;
  side: "additions" | "deletions";
  paired?: boolean;
}): FlatRow {
  const paired = parts.paired ?? false;
  return {
    kind: "diff",
    file: parts.file,
    lineNumber: parts.lineNumber,
    side: parts.side,
    leftLineNumber: parts.side === "deletions" || paired ? parts.lineNumber : null,
    rightLineNumber: parts.side === "additions" || paired ? parts.lineNumber : null,
    paired,
  };
}

const baseCursor = (over: Partial<RowAnchor> & Pick<RowAnchor, "file" | "lineNumber" | "side">): RowAnchor => ({
  kind: "row",
  file: over.file,
  lineNumber: over.lineNumber,
  side: over.side,
  preferredSide: over.preferredSide ?? over.side,
});

// validateWebappCursor encodes the App-level policy that differentiates
// "file collapsed" (anchor preserved) from "file removed from bundle"
// (cursor null) — semantics that core/cursor-state.ts::validateCursor on
// its own can't express because it only sees `flatRows`. The webapp's
// `flatRowsList` excludes collapsed files; without the discriminator we'd
// either silently null out anchors on collapse or never null out on real
// removals.
describe("validateWebappCursor: file removed from bundle", () => {
  it("returns null when cursor's file is no longer in the bundle's file list", () => {
    const cursor = baseCursor({ file: "removed.ts", lineNumber: 1, side: "additions" });
    const rows: FlatRow[] = [diffRow({ file: "kept.ts", lineNumber: 1, side: "additions" })];
    const files = [{ name: "kept.ts" }];
    expect(validateWebappCursor(cursor, rows, files, () => false)).toBeNull();
  });

  it("returns null even when other files have rows (silent reset, no snap)", () => {
    const cursor = baseCursor({ file: "gone.ts", lineNumber: 5, side: "additions" });
    const rows: FlatRow[] = [
      diffRow({ file: "a.ts", lineNumber: 1, side: "additions" }),
      diffRow({ file: "b.ts", lineNumber: 1, side: "additions" }),
    ];
    const files = [{ name: "a.ts" }, { name: "b.ts" }];
    expect(validateWebappCursor(cursor, rows, files, () => false)).toBeNull();
  });

  it("returns null when input cursor is null", () => {
    expect(validateWebappCursor(null, [], [], () => false)).toBeNull();
  });
});

describe("validateWebappCursor: file collapsed but still in bundle", () => {
  it("preserves the cursor anchor when its file is collapsed (anchor invariant under collapse)", () => {
    const cursor = baseCursor({ file: "x.ts", lineNumber: 7, side: "additions" });
    // Collapsed files contribute zero rows to flatRowsList — the file is
    // still in `files` though, so the anchor remains semantically valid.
    const rows: FlatRow[] = [diffRow({ file: "y.ts", lineNumber: 1, side: "additions" })];
    const files = [{ name: "x.ts" }, { name: "y.ts" }];
    const result = validateWebappCursor(cursor, rows, files, (f) => f === "x.ts");
    expect(result).toEqual(cursor);
  });

  it("preserves the anchor on a deletion-side cursor when the file collapses", () => {
    const cursor = baseCursor({ file: "x.ts", lineNumber: 4, side: "deletions" });
    const rows: FlatRow[] = [];
    const files = [{ name: "x.ts" }];
    const result = validateWebappCursor(cursor, rows, files, (f) => f === "x.ts");
    expect(result).toEqual(cursor);
    expect(result?.preferredSide).toBe("deletions");
  });
});

describe("validateWebappCursor: anchor still resolves", () => {
  it("returns the cursor unchanged when its (file, line, side) is in the new flatRows", () => {
    const cursor = baseCursor({ file: "x.ts", lineNumber: 2, side: "additions" });
    const rows: FlatRow[] = [
      diffRow({ file: "x.ts", lineNumber: 1, side: "additions" }),
      diffRow({ file: "x.ts", lineNumber: 2, side: "additions" }),
    ];
    const files = [{ name: "x.ts" }];
    expect(validateWebappCursor(cursor, rows, files, () => false)).toEqual(cursor);
  });

  it("snaps to the file's first row when the anchor's specific line is gone", () => {
    // E.g. the diff was rewritten; the file is still here but the line
    // the cursor was on is no longer in the flat sequence.
    const cursor = baseCursor({ file: "x.ts", lineNumber: 99, side: "additions" });
    const rows: FlatRow[] = [
      diffRow({ file: "x.ts", lineNumber: 1, side: "additions" }),
      diffRow({ file: "x.ts", lineNumber: 2, side: "additions" }),
    ];
    const files = [{ name: "x.ts" }];
    const v = validateWebappCursor(cursor, rows, files, () => false);
    expect(v?.file).toBe("x.ts");
    expect(v?.lineNumber).toBe(1);
  });
});

// Bundle reload (SSE watcher fires on annotation change) — the typical
// case is "annotations changed but the diff content is identical", in
// which case the cursor's anchor still resolves and we leave it alone.
describe("validateWebappCursor: bundle reload preserves cursor", () => {
  it("preserves cursor when an annotation is appended and the diff is unchanged", () => {
    const before: FlatRow[] = [
      diffRow({ file: "x.ts", lineNumber: 1, side: "additions" }),
      diffRow({ file: "x.ts", lineNumber: 2, side: "additions" }),
    ];
    const cursor = baseCursor({ file: "x.ts", lineNumber: 2, side: "additions" });
    const files = [{ name: "x.ts" }];
    // After-reload flat sequence is identical (annotations don't shape rows).
    const after = before;
    expect(validateWebappCursor(cursor, after, files, () => false)).toEqual(cursor);
  });

  it("preserves cursor when an unrelated file gains/loses rows", () => {
    const cursor = baseCursor({ file: "x.ts", lineNumber: 2, side: "additions" });
    const before: FlatRow[] = [diffRow({ file: "x.ts", lineNumber: 2, side: "additions" })];
    const after: FlatRow[] = [
      diffRow({ file: "x.ts", lineNumber: 2, side: "additions" }),
      diffRow({ file: "y.ts", lineNumber: 1, side: "additions" }),
    ];
    const files = [{ name: "x.ts" }, { name: "y.ts" }];
    expect(validateWebappCursor(cursor, after, files, () => false)).toEqual(cursor);
    // Sanity: also a no-op against the pre-reload list.
    expect(validateWebappCursor(cursor, before, files.slice(0, 1), () => false)).toEqual(cursor);
  });
});

// Layout toggle (Shift-L): the cursor's anchor is invariant — only how
// the diff renders changes (split vs unified pairing). validateCursor's
// resolve-by-(file, lineNumber, side) holds across both layouts.
describe("validateWebappCursor: layout toggle preserves anchor", () => {
  it("anchor that resolves in split also resolves in unified (paired-row identity)", () => {
    const cursor = baseCursor({ file: "x.ts", lineNumber: 2, side: "additions" });
    const splitRows: FlatRow[] = [
      diffRow({ file: "x.ts", lineNumber: 1, side: "additions", paired: true }),
      diffRow({ file: "x.ts", lineNumber: 2, side: "additions", paired: true }),
    ];
    const unifiedRows: FlatRow[] = [...splitRows];
    const files = [{ name: "x.ts" }];
    expect(validateWebappCursor(cursor, splitRows, files, () => false)).toEqual(cursor);
    expect(validateWebappCursor(cursor, unifiedRows, files, () => false)).toEqual(cursor);
  });
});

