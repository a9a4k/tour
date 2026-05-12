// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { validateWebappCursor } from "../../src/web/client/cursor-validation.js";
import { walkCursorRows } from "../../src/web/client/cursor-rows.js";
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

// Pierre expandUnchanged (PRD #106) regression: clicking a chevron injects
// new [data-line] cells. The DOM-based walker re-derives on every render,
// so the new rows automatically join the cursor's walkable set without
// any explicit notification or invalidation. Cursor anchor (already on a
// pre-existing row) is invariant under DOM insertions — only the row
// index in the derived sequence shifts. The test simulates Pierre's
// post-expansion DOM state and asserts the new cells become walkable.
describe("Pierre expandUnchanged: DOM-injected rows join the walkable set", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function el(tag: string, attrs: Record<string, string> = {}, children: Node[] = []): HTMLElement {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) node.appendChild(c);
    return node;
  }

  function fileBlock(name: string, cells: HTMLElement[]): HTMLElement {
    return el("div", { "data-file": name }, cells);
  }

  function cell(line: number, type: string): HTMLElement {
    return el("div", { "data-line": String(line), "data-line-type": type });
  }

  it("newly-injected unchanged context cells appear as additional FlatRows on next walk", () => {
    // Initial state: a single addition row (chevron not yet clicked).
    const anchor = cell(10, "addition");
    const block = fileBlock("x.ts", [anchor]);
    document.body.appendChild(block);
    const before = walkCursorRows(document.body);
    expect(before.map((r) => r.lineNumber)).toEqual([10]);

    // Pierre user clicks chevron → unchanged context cells are inserted
    // before the existing row. Re-walk picks them up; no invalidation
    // handshake required (the walker is stateless).
    block.insertBefore(cell(7, "context"), anchor);
    block.insertBefore(cell(8, "context"), anchor);
    block.insertBefore(cell(9, "context"), anchor);
    const after = walkCursorRows(document.body);
    expect(after.map((r) => r.lineNumber)).toEqual([7, 8, 9, 10]);
  });

  it("cursor anchor on a pre-existing row is invariant after chevron expansion (resolves on the new flat sequence)", () => {
    const anchor = cell(10, "addition");
    const block = fileBlock("x.ts", [anchor]);
    document.body.appendChild(block);
    const cursor = baseCursor({ file: "x.ts", lineNumber: 10, side: "additions" });

    // Inject unchanged-context rows (Pierre expandUnchanged).
    block.insertBefore(cell(7, "context"), anchor);
    block.insertBefore(cell(8, "context"), anchor);

    const flatAfter = walkCursorRows(document.body);
    const validated = validateWebappCursor(cursor, flatAfter, [{ name: "x.ts" }], () => false);
    expect(validated).toEqual(cursor);
  });
});
