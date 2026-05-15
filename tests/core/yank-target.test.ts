import { describe, it, expect } from "vitest";
import { resolveYankTarget, type YankTarget } from "../../src/core/yank-target.js";
import type { Cursor } from "../../src/core/cursor-state.js";
import type { Comment } from "../../src/core/types.js";
import type { BundleFile } from "../../src/core/tour-bundle.js";

// PRD #356 / issue #357 contract: `resolveYankTarget` collapses the
// (paneFocus × cursor × sidebar selection × comments × bundle) inputs
// into a single discriminated union the surface handlers switch on. The
// resolver is pure — no I/O, no surface coupling — so the tests below
// pin the resolution table from the PRD row-by-row.

const FILE_OLD = "line1-old\nline2-old\nline3-old\n";
const FILE_NEW = "line1-new\nline2-new\nline3-new\n";

const bundleFile = (overrides: Partial<BundleFile> = {}): BundleFile => ({
  name: "src/foo.ts",
  type: "modify",
  hunks: [],
  oldContent: FILE_OLD,
  newContent: FILE_NEW,
  classification: { kind: "code" } as BundleFile["classification"],
  orphanWindows: [],
  ...overrides,
});

const bundleMap = (...files: BundleFile[]): ReadonlyMap<string, BundleFile> =>
  new Map(files.map((f) => [f.name, f]));

const rowCursor = (overrides: Partial<Extract<Cursor, { kind: "row" }>> = {}): Cursor => ({
  kind: "row",
  file: "src/foo.ts",
  lineNumber: 2,
  side: "additions",
  preferredSide: "additions",
  ...overrides,
});

const cardCursor = (commentId: string): Cursor => ({
  kind: "card",
  commentId,
  preferredSide: "additions",
});

const mkComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: "ann1",
  file: "src/foo.ts",
  side: "additions",
  line_start: 1,
  line_end: 1,
  body: "hi",
  author: "me",
  author_kind: "human",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("resolveYankTarget — sidebar pane", () => {
  it("sidebar + file selection → kind: path with selection.path", () => {
    const out = resolveYankTarget({
      paneFocus: "sidebar",
      cursor: null,
      sidebarSelectedRow: { kind: "file", path: "pkg/a/Foo.tsx" },
      comments: [],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "pkg/a/Foo.tsx" });
  });

  it("sidebar + folder selection with non-empty path → kind: path with selection.path (issue #371)", () => {
    const out = resolveYankTarget({
      paneFocus: "sidebar",
      cursor: null,
      sidebarSelectedRow: { kind: "folder", path: "src/web/client" },
      comments: [],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/web/client" });
  });

  it("sidebar + folder selection with empty path (root sentinel) → kind: none, reason: no-selection", () => {
    const out = resolveYankTarget({
      paneFocus: "sidebar",
      cursor: null,
      sidebarSelectedRow: { kind: "folder", path: "" },
      comments: [],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "none", reason: "no-selection" });
  });

  it("sidebar + null selection → kind: none, reason: no-selection", () => {
    const out = resolveYankTarget({
      paneFocus: "sidebar",
      cursor: null,
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "none", reason: "no-selection" });
  });

  it("sidebar yank ignores cursor entirely (cursor on a card in diff doesn't leak)", () => {
    const out = resolveYankTarget({
      paneFocus: "sidebar",
      cursor: cardCursor("ann1"),
      sidebarSelectedRow: { kind: "file", path: "pkg/a/Foo.tsx" },
      comments: [mkComment({ id: "ann1", file: "other/Bar.ts" })],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "pkg/a/Foo.tsx" });
  });
});

describe("resolveYankTarget — diff pane, null cursor", () => {
  it("diff + null cursor → kind: none, reason: no-cursor", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: null,
      sidebarSelectedRow: { kind: "file", path: "ignored.ts" },
      comments: [],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "none", reason: "no-cursor" });
  });
});

describe("resolveYankTarget — diff pane, row cursor on a source line", () => {
  it("additions side → text from newContent (1-indexed) at lineNumber", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({
      kind: "line",
      text: "line2-new",
      file: "src/foo.ts",
    });
  });

  it("deletions side → text from oldContent at lineNumber", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "deletions", lineNumber: 3 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({
      kind: "line",
      text: "line3-old",
      file: "src/foo.ts",
    });
  });

  it("unicode line content round-trips unchanged (no encoding / no truncation)", () => {
    const newContent = "first\nαβγ — “smart quotes” 🚀\nthird\n";
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile({ newContent })),
    });
    expect(out).toEqual<YankTarget>({
      kind: "line",
      text: "αβγ — “smart quotes” 🚀",
      file: "src/foo.ts",
    });
  });

  it("empty-line content round-trips as empty string (not a path fallback)", () => {
    const newContent = "first\n\nthird\n";
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile({ newContent })),
    });
    expect(out).toEqual<YankTarget>({
      kind: "line",
      text: "",
      file: "src/foo.ts",
    });
  });

  it("whitespace-only line content round-trips unchanged", () => {
    const newContent = "first\n   \t  \nthird\n";
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile({ newContent })),
    });
    expect(out).toEqual<YankTarget>({
      kind: "line",
      text: "   \t  ",
      file: "src/foo.ts",
    });
  });

  it("text does not include a trailing newline (round-trips raw)", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 1 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect((out as { text: string }).text.endsWith("\n")).toBe(false);
  });
});

describe("resolveYankTarget — diff pane, row cursor on interactive row", () => {
  it("hunk-separator → kind: path with cursor.file (line content not applicable)", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({
        interactive: { subKind: "hunk-separator", boundaryRef: 1 },
        lineNumber: 0,
      }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });

  it("expand-down → kind: path with cursor.file", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({
        interactive: { subKind: "expand-down", boundaryRef: "bottom" },
        lineNumber: 0,
      }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });

  it("boundary-top → kind: path with cursor.file", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({
        interactive: { subKind: "boundary-top", boundaryRef: "top" },
        lineNumber: 0,
      }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });

  it("collapsed-file → kind: path with cursor.file", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({
        interactive: { subKind: "collapsed-file", boundaryRef: "top" },
        lineNumber: 0,
      }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });
});

describe("resolveYankTarget — diff pane, row cursor where active side has no resolvable line", () => {
  it("cursor.file missing from bundleFiles map → kind: path fallback", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ file: "unknown.ts", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "unknown.ts" });
  });

  it("additions cursor on a file with no newContent (deletion-only file) → kind: path", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(
        bundleFile({ newContent: undefined, type: "delete" }),
      ),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });

  it("deletions cursor on a file with no oldContent (added file) → kind: path", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "deletions", lineNumber: 2 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(
        bundleFile({ oldContent: undefined, type: "add" }),
      ),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });

  it("lineNumber out of range → kind: path fallback", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: rowCursor({ side: "additions", lineNumber: 99 }),
      sidebarSelectedRow: null,
      comments: [],
      bundleFiles: bundleMap(bundleFile()),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "src/foo.ts" });
  });
});

describe("resolveYankTarget — diff pane, card cursor", () => {
  it("card cursor on a valid Comment → kind: path with comment.file", () => {
    const ann = mkComment({ id: "ann1", file: "pkg/x/Bar.ts" });
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: cardCursor("ann1"),
      sidebarSelectedRow: null,
      comments: [ann],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "path", path: "pkg/x/Bar.ts" });
  });

  it("card cursor whose annotationId is missing from comments → kind: none, reason: no-cursor", () => {
    const out = resolveYankTarget({
      paneFocus: "diff",
      cursor: cardCursor("ann-orphan"),
      sidebarSelectedRow: null,
      comments: [mkComment({ id: "ann1" })],
      bundleFiles: bundleMap(),
    });
    expect(out).toEqual<YankTarget>({ kind: "none", reason: "no-cursor" });
  });
});
