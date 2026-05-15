import { describe, it, expect } from "vitest";
import { resizeReanchorTargetId } from "../../src/tui/resize-reanchor-target.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";

// Issue #318: priority test for the `[`/`]` resize re-anchor target.
// 1. Cursor row (via cursorRowDomId) wins.
// 2. Active file's card (`file-card-${name}`) is the no-cursor fallback.
// 3. Neither → null (caller no-ops).

const ROW_A: FlatRow = {
  kind: "diff",
  file: "src/a.ts",
  lineNumber: 12,
  side: "additions",
  leftLineNumber: null,
  rightLineNumber: 12,
  paired: false,
};

const CARD_FLAT: FlatRow = {
  kind: "card",
  file: "src/a.ts",
  side: "additions",
  lineEnd: 12,
  commentId: "ann-1",
};

describe("resizeReanchorTargetId", () => {
  it("returns the cursor's row id when the cursor is a RowAnchor on a resolvable row", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "src/a.ts",
      lineNumber: 12,
      side: "additions",
      preferredSide: "additions",
    };
    const id = resizeReanchorTargetId({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/a.ts",
    });
    expect(id).toBe("diff-row-src/a.ts-additions-12");
  });

  it("returns the cursor's comment id when the cursor is a CardAnchor", () => {
    const cursor: Cursor = {
      kind: "card",
      commentId: "ann-1",
      preferredSide: "additions",
    };
    const id = resizeReanchorTargetId({
      cursor,
      flatRows: [ROW_A, CARD_FLAT],
      activeFile: "src/a.ts",
    });
    expect(id).toBe("comment-ann-1");
  });

  it("falls back to the active file's card when there is no cursor", () => {
    const id = resizeReanchorTargetId({
      cursor: null,
      flatRows: [ROW_A],
      activeFile: "src/b.ts",
    });
    expect(id).toBe("file-card-src/b.ts");
  });

  it("falls back to the active file's card when the cursor row cannot be resolved in flatRows", () => {
    // RowAnchor pointing at a file that's not in flatRows (degenerate
    // / stale cursor): cursorRowDomId returns null, so the helper
    // falls through to the activeFile branch.
    const cursor: Cursor = {
      kind: "row",
      file: "src/gone.ts",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    const id = resizeReanchorTargetId({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/a.ts",
    });
    expect(id).toBe("file-card-src/a.ts");
  });

  it("returns null when no cursor and no active file (degenerate, empty bundle)", () => {
    const id = resizeReanchorTargetId({
      cursor: null,
      flatRows: [],
      activeFile: null,
    });
    expect(id).toBeNull();
  });

  it("prefers the cursor row over the active file when both are present", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "src/a.ts",
      lineNumber: 12,
      side: "additions",
      preferredSide: "additions",
    };
    const id = resizeReanchorTargetId({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/somewhere-else.ts",
    });
    expect(id).toBe("diff-row-src/a.ts-additions-12");
  });
});
