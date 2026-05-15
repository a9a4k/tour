import { describe, it, expect } from "vitest";
import { resizeReanchorTarget } from "../../src/web/client/resize-reanchor-target.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";

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

describe("resizeReanchorTarget (web, issue #327)", () => {
  it("returns the cursor when the cursor is a RowAnchor on a resolvable row", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "src/a.ts",
      lineNumber: 12,
      side: "additions",
      preferredSide: "additions",
    };
    const target = resizeReanchorTarget({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/a.ts",
    });
    expect(target).toEqual({ kind: "cursor", cursor });
  });

  it("returns the cursor when the cursor is a CardAnchor (DOM-readiness is a runtime check)", () => {
    const cursor: Cursor = {
      kind: "card",
      commentId: "ann-1",
      preferredSide: "additions",
    };
    const target = resizeReanchorTarget({
      cursor,
      flatRows: [ROW_A, CARD_FLAT],
      activeFile: "src/a.ts",
    });
    expect(target).toEqual({ kind: "cursor", cursor });
  });

  it("falls back to the active file when there is no cursor", () => {
    const target = resizeReanchorTarget({
      cursor: null,
      flatRows: [ROW_A],
      activeFile: "src/b.ts",
    });
    expect(target).toEqual({ kind: "file", path: "src/b.ts" });
  });

  it("falls back to the active file when a row cursor cannot be resolved in flatRows", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "src/gone.ts",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };
    const target = resizeReanchorTarget({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/a.ts",
    });
    expect(target).toEqual({ kind: "file", path: "src/a.ts" });
  });

  it("returns null when no cursor and no active file (degenerate, empty bundle)", () => {
    const target = resizeReanchorTarget({
      cursor: null,
      flatRows: [],
      activeFile: null,
    });
    expect(target).toBeNull();
  });

  it("prefers the cursor over the active file when both are present", () => {
    const cursor: Cursor = {
      kind: "row",
      file: "src/a.ts",
      lineNumber: 12,
      side: "additions",
      preferredSide: "additions",
    };
    const target = resizeReanchorTarget({
      cursor,
      flatRows: [ROW_A],
      activeFile: "src/somewhere-else.ts",
    });
    expect(target).toEqual({ kind: "cursor", cursor });
  });
});
