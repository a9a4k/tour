import { describe, it, expect } from "vitest";
import { resolveOpenTarget } from "../../src/core/open-target-resolver.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { Comment } from "../../src/core/types.js";

// PRD #349 / ADR 0032 / issue #354 — slice 3 extends the slice-1 resolver
// with permissive resolution. Card cursor → annotation `line_end`;
// sidebar file → (file, 1); folder selection / null → null. Both
// surfaces inherit via the shared resolver.

function rowCursor(file: string, line: number, side: "additions" | "deletions" = "additions"): Cursor {
  return {
    kind: "row",
    file,
    lineNumber: line,
    side,
    preferredSide: side,
  };
}

function cardCursor(commentId: string): Cursor {
  return { kind: "card", commentId, preferredSide: "additions" };
}

const mkComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: "ann1",
  file: "src/foo.ts",
  side: "additions",
  line_start: 10,
  line_end: 12,
  body: "body",
  author: "me",
  author_kind: "human",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("resolveOpenTarget — diff pane, row cursor", () => {
  it("row cursor on additions side returns (file, line)", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: rowCursor("src/foo.ts", 42, "additions"),
        sidebarSelectedRow: null,
        comments: [],
      }),
    ).toEqual({ file: "src/foo.ts", line: 42 });
  });

  it("row cursor on deletions side returns (file, line) — naive open, no line mapping (ADR 0032)", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: rowCursor("src/foo.ts", 17, "deletions"),
        sidebarSelectedRow: null,
        comments: [],
      }),
    ).toEqual({ file: "src/foo.ts", line: 17 });
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
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: interactive,
        sidebarSelectedRow: null,
        comments: [],
      }),
    ).toBeNull();
  });
});

describe("resolveOpenTarget — diff pane, card cursor (slice 3)", () => {
  it("card cursor on a valid annotation returns (file, line_end)", () => {
    const ann = mkComment({ id: "ann1", file: "pkg/x/Bar.ts", line_start: 10, line_end: 12 });
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: cardCursor("ann1"),
        sidebarSelectedRow: null,
        comments: [ann],
      }),
    ).toEqual({ file: "pkg/x/Bar.ts", line: 12 });
  });

  it("multi-line annotation: target line is line_end, not line_start or midpoint", () => {
    // Anchored range 5..9 (5 lines). Card renders below the range; line_end
    // is the line the reader's eye lands on before the card.
    const ann = mkComment({ id: "ann1", file: "pkg/x/Bar.ts", line_start: 5, line_end: 9 });
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: cardCursor("ann1"),
        sidebarSelectedRow: null,
        comments: [ann],
      }),
    ).toEqual({ file: "pkg/x/Bar.ts", line: 9 });
  });

  it("single-line annotation: line_start === line_end → that line", () => {
    const ann = mkComment({ id: "ann1", file: "pkg/x/Bar.ts", line_start: 7, line_end: 7 });
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: cardCursor("ann1"),
        sidebarSelectedRow: null,
        comments: [ann],
      }),
    ).toEqual({ file: "pkg/x/Bar.ts", line: 7 });
  });

  it("card cursor whose commentId is missing from comments → null", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: cardCursor("ann-orphan"),
        sidebarSelectedRow: null,
        comments: [mkComment({ id: "ann1" })],
      }),
    ).toBeNull();
  });
});

describe("resolveOpenTarget — sidebar pane (slice 3)", () => {
  it("sidebar + file selection → (file, 1)", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "sidebar",
        cursor: null,
        sidebarSelectedRow: { kind: "file", path: "pkg/a/Foo.tsx" },
        comments: [],
      }),
    ).toEqual({ file: "pkg/a/Foo.tsx", line: 1 });
  });

  it("sidebar + folder selection → null", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "sidebar",
        cursor: null,
        sidebarSelectedRow: { kind: "folder" },
        comments: [],
      }),
    ).toBeNull();
  });

  it("sidebar + null selection → null", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "sidebar",
        cursor: null,
        sidebarSelectedRow: null,
        comments: [],
      }),
    ).toBeNull();
  });

  it("sidebar pane ignores cursor entirely — file selection wins even when diff cursor is on a card", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "sidebar",
        cursor: cardCursor("ann1"),
        sidebarSelectedRow: { kind: "file", path: "pkg/a/Foo.tsx" },
        comments: [mkComment({ id: "ann1", file: "other/Bar.ts" })],
      }),
    ).toEqual({ file: "pkg/a/Foo.tsx", line: 1 });
  });
});

describe("resolveOpenTarget — degenerate state", () => {
  it("diff pane + null cursor → null", () => {
    expect(
      resolveOpenTarget({
        paneFocus: "diff",
        cursor: null,
        sidebarSelectedRow: { kind: "file", path: "ignored.ts" },
        comments: [],
      }),
    ).toBeNull();
  });
});
