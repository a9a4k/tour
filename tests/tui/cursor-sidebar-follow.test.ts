import { describe, it, expect } from "vitest";
import { moveCursor, type Cursor } from "../../src/core/cursor-state.js";
import type { FlatRow } from "../../src/core/flat-rows.js";
import {
  buildTree,
  compress,
  revealAndLocate,
} from "../../src/core/file-tree.js";

interface F {
  name: string;
}
const f = (name: string): F => ({ name });

function pairedFlat(file: string, left: number, right: number): FlatRow {
  return {
    file,
    lineNumber: right,
    side: "additions",
    leftLineNumber: left,
    rightLineNumber: right,
    paired: true,
  };
}

/**
 * App-level integration smoke for the cross-file motion + sidebar-follows-cursor
 * composition (PRD #100 UX 6 / issue #102). Each test exercises the chain that
 * app.tsx wires together: `moveCursor(...)` produces a cursor with a new file,
 * and `revealAndLocate(...)` resolves it to a sidebar row (revealing collapsed
 * ancestors when needed).
 */
describe("cross-file cursor motion drives sidebar selection", () => {
  it("crossing file A→B updates the sidebar to point at file B", () => {
    const files = [f("src/a.txt"), f("src/b.txt")];
    const tree = compress(buildTree(files));
    const flat: FlatRow[] = [
      pairedFlat("src/a.txt", 1, 1),
      pairedFlat("src/a.txt", 2, 2),
      pairedFlat("src/b.txt", 1, 1),
    ];
    const cursor: Cursor = {
      file: "src/a.txt",
      lineNumber: 2,
      side: "additions",
      preferredSide: "additions",
    };

    const next = moveCursor(cursor, "down", flat);
    expect(next?.file).toBe("src/b.txt");

    const located = revealAndLocate(tree, new Set(), {}, next!.file);
    expect(located).not.toBeNull();
    expect(located!.rows[located!.rowIdx]).toMatchObject({
      kind: "file",
      path: "src/b.txt",
    });
  });

  it("revealing the cursor's collapsed-folder ancestor exposes the file row", () => {
    const files = [f("src/web/a.txt"), f("docs/note.md")];
    const tree = compress(buildTree(files));
    // Both ancestor folders are collapsed — the cursor lands inside a
    // hidden subtree.
    const collapsed = new Set(["src/web"]);
    const flat: FlatRow[] = [
      pairedFlat("docs/note.md", 1, 1),
      pairedFlat("src/web/a.txt", 1, 1),
    ];
    const cursor: Cursor = {
      file: "docs/note.md",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };

    const next = moveCursor(cursor, "down", flat);
    expect(next?.file).toBe("src/web/a.txt");

    const located = revealAndLocate(tree, collapsed, {}, next!.file);
    expect(located).not.toBeNull();
    expect(located!.collapsedFolders).not.toBe(collapsed);
    expect(located!.collapsedFolders.has("src/web")).toBe(false);
    expect(located!.rows[located!.rowIdx]).toMatchObject({
      kind: "file",
      path: "src/web/a.txt",
    });
  });

  it("crossing back into the previous file points the sidebar at it", () => {
    const files = [f("a.txt"), f("b.txt")];
    const tree = compress(buildTree(files));
    const flat: FlatRow[] = [
      pairedFlat("a.txt", 1, 1),
      pairedFlat("b.txt", 1, 1),
    ];
    const cursor: Cursor = {
      file: "b.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };

    const next = moveCursor(cursor, "up", flat);
    expect(next?.file).toBe("a.txt");

    const located = revealAndLocate(tree, new Set(), {}, next!.file);
    expect(located!.rows[located!.rowIdx]).toMatchObject({
      kind: "file",
      path: "a.txt",
    });
  });

  it("in-file motion does not change the resolved sidebar row", () => {
    const files = [f("a.txt"), f("b.txt")];
    const tree = compress(buildTree(files));
    const flat: FlatRow[] = [
      pairedFlat("a.txt", 1, 1),
      pairedFlat("a.txt", 2, 2),
      pairedFlat("b.txt", 1, 1),
    ];
    const cursor: Cursor = {
      file: "a.txt",
      lineNumber: 1,
      side: "additions",
      preferredSide: "additions",
    };

    const next = moveCursor(cursor, "down", flat);
    expect(next?.file).toBe(cursor.file);

    const before = revealAndLocate(tree, new Set(), {}, cursor.file)!;
    const after = revealAndLocate(tree, new Set(), {}, next!.file)!;
    expect(after.rowIdx).toBe(before.rowIdx);
  });
});
