import { describe, it, expect } from "vitest";
import { resolveOpenTarget } from "../../src/core/open-target-resolver.js";
import type { Cursor } from "../../src/core/cursor-state.js";

// PRD #349 / ADR 0032 / issue #352 — slice 1 covers the row-cursor case
// only. Card cursor, sidebar fallback, folder selection, and null cursor
// all return null in this slice. Permissive resolution (card → annotation
// line_end, sidebar file → line 1) lands in #351.

function rowCursor(file: string, line: number, side: "additions" | "deletions" = "additions"): Cursor {
  return {
    kind: "row",
    file,
    lineNumber: line,
    side,
    preferredSide: side,
  };
}

describe("resolveOpenTarget — row cursor (slice 1)", () => {
  it("row cursor on additions side returns (file, line)", () => {
    expect(resolveOpenTarget(rowCursor("src/foo.ts", 42, "additions"))).toEqual({
      file: "src/foo.ts",
      line: 42,
    });
  });

  it("row cursor on deletions side returns (file, line) — naive open, no line mapping (ADR 0032)", () => {
    expect(resolveOpenTarget(rowCursor("src/foo.ts", 17, "deletions"))).toEqual({
      file: "src/foo.ts",
      line: 17,
    });
  });

  it("interactive row cursor (file boundary, hunk separator, collapsed-file) returns null", () => {
    const interactive: Cursor = {
      kind: "row",
      file: "src/foo.ts",
      lineNumber: 0,
      side: "additions",
      preferredSide: "additions",
      interactive: { subKind: "boundary-top", boundaryRef: "top" },
    };
    expect(resolveOpenTarget(interactive)).toBeNull();
  });
});

describe("resolveOpenTarget — non-row stubs (placeholder for #351)", () => {
  it("card cursor returns null (slice 1 stub)", () => {
    const card: Cursor = { kind: "card", commentId: "abc", preferredSide: "additions" };
    expect(resolveOpenTarget(card)).toBeNull();
  });

  it("null cursor returns null", () => {
    expect(resolveOpenTarget(null)).toBeNull();
  });
});
