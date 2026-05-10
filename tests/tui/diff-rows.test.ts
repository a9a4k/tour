import { describe, it, expect, vi } from "vitest";

// @opentui/core eagerly loads tree-sitter highlights `.scm` assets at
// module-init, which esbuild can't transform under vitest. The TUI only
// needs RGBA / SyntaxStyle / pathToFiletype from this module at runtime;
// stub them here so importing DiffRows (which transitively pulls in
// `./syntax.js`) doesn't hit the .scm loader.
vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { DiffRows } from "../../src/tui/DiffRows.js";
import { DiffLine } from "../../src/tui/DiffLine.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import { theme } from "../../src/core/theme.js";

// DiffRows is a function component; calling it returns a React element
// tree (a fragment of intrinsic types). Walk the tree to verify that
// each PlannedRow's type translates into the right `diffBg` prop on the
// DiffLine cells (issue #74).

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

function flatten(node: unknown, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const c of node) flatten(c, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  flatten(node.props.children, out);
  return out;
}

function diffLineCellsOf(tree: unknown): AnyElement[] {
  // DiffLine appears as a `createElement(DiffLine, ...)` node — its body
  // isn't expanded until React renders. Match by the function reference.
  return flatten(tree).filter((el) => el.type === DiffLine);
}

function parseFile(rawDiff: string): FileDiffMetadata {
  const patches = parsePatchFiles(rawDiff);
  return patches[0].files[0];
}

function callDiffRows(args: {
  rows: PlannedRow[];
  layout: "split" | "unified";
  cursor?: import("../../src/core/cursor-state.js").Cursor | null;
  fileName?: string;
}): unknown {
  return DiffRows({
    fileName: args.fileName ?? "x.txt",
    rows: args.rows,
    layout: args.layout,
    currentAnnotationId: null,
    cursor: args.cursor ?? null,
  });
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

describe("DiffRows diff-type backgrounds (issue #74)", () => {
  describe("split layout", () => {
    it("paints deletion bg on left and addition bg on right of a paired change row", () => {
      // SIMPLE_DIFF has one paired change (`-old` / `+new`) and a trailing
      // pure addition (`+added`). Find the paired change row by both line
      // numbers being non-null and type='change'.
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pairedIdx = rows.findIndex(
        (r) => r.kind === "diff-row" && r.type === "change" && r.leftLineNumber !== null && r.rightLineNumber !== null,
      );
      expect(pairedIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pairedIdx, pairedIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["diffBg"]).toBe("deletion");
      expect(cells[1].props["diffBg"]).toBe("addition");
    });

    it("paints addition bg only on the populated right cell of a pure-addition change row (left empty cell stays unbgd)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pureAddIdx = rows.findIndex(
        (r) => r.kind === "diff-row" && r.type === "change" && r.leftLineNumber === null && r.rightLineNumber !== null,
      );
      expect(pureAddIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureAddIdx, pureAddIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["diffBg"]).toBeUndefined();
      expect(cells[1].props["diffBg"]).toBe("addition");
    });

    it("paints deletion bg only on the populated left cell of a pure-deletion change row", () => {
      const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,1 @@
 ctx
-only-del
`;
      const file = parseFile(diff);
      const rows = planRows(file, [], "split");
      const pureDelIdx = rows.findIndex(
        (r) => r.kind === "diff-row" && r.type === "change" && r.leftLineNumber !== null && r.rightLineNumber === null,
      );
      expect(pureDelIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureDelIdx, pureDelIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["diffBg"]).toBe("deletion");
      expect(cells[1].props["diffBg"]).toBeUndefined();
    });

    it("paints no diff bg on context rows in either cell", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      expect(ctxIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["diffBg"]).toBeUndefined();
      expect(cells[1].props["diffBg"]).toBeUndefined();
    });
  });

  describe("unified layout", () => {
    it("paints addition bg on a unified addition row", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const addIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "addition");
      expect(addIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(addIdx, addIdx + 1), layout: "unified" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["diffBg"]).toBe("addition");
    });

    it("paints deletion bg on a unified deletion row", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const delIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "deletion");
      expect(delIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(delIdx, delIdx + 1), layout: "unified" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["diffBg"]).toBe("deletion");
    });

    it("paints no diff bg on a unified context row", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      expect(ctxIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "unified" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["diffBg"]).toBeUndefined();
    });
  });

  describe("cursor row matching (ADR 0011)", () => {
    it("lights up the right (additions) cell on a paired row when cursor is on the additions side", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const lineNumber = ctxRow.rightLineNumber!;
      const cursor = {
        file: "x.txt",
        lineNumber,
        side: "additions" as const,
        preferredSide: "additions" as const,
      };
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBeFalsy();
      expect(cells[1].props["cursorActive"]).toBe(true);
    });

    it("lights up the left (deletions) cell on a paired row when cursor is on the deletions side", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const lineNumber = ctxRow.leftLineNumber!;
      const cursor = {
        file: "x.txt",
        lineNumber,
        side: "deletions" as const,
        preferredSide: "deletions" as const,
      };
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBe(true);
      expect(cells[1].props["cursorActive"]).toBeFalsy();
    });

    it("does not light up any cell when cursor is on a different file", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const cursor = {
        file: "y.txt",
        lineNumber: 1,
        side: "additions" as const,
        preferredSide: "additions" as const,
      };
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      for (const cell of cells) expect(cell.props["cursorActive"]).toBeFalsy();
    });

    it("does not light up any cell when cursor is null", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split", cursor: null });
      const cells = diffLineCellsOf(tree);
      for (const cell of cells) expect(cell.props["cursorActive"]).toBeFalsy();
    });

    it("lights up the unified row when cursor matches either side", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const cursor = {
        file: "x.txt",
        lineNumber: ctxRow.rightLineNumber!,
        side: "additions" as const,
        preferredSide: "additions" as const,
      };
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "unified", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["cursorActive"]).toBe(true);
    });

    it("emits a stable id `diff-row-${file}-${side}-${lineNumber}` on each addressable side wrapper (split)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const ids = flatten(tree)
        .map((el) => el.props["id"])
        .filter((id): id is string => typeof id === "string");
      expect(ids).toContain(`diff-row-x.txt-deletions-${ctxRow.leftLineNumber}`);
      expect(ids).toContain(`diff-row-x.txt-additions-${ctxRow.rightLineNumber}`);
    });

    it("emits a stable id on the unified row wrapper", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const addIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "addition");
      const addRow = rows[addIdx];
      if (addRow.kind !== "diff-row") throw new Error("expected diff-row");
      const tree = callDiffRows({ rows: rows.slice(addIdx, addIdx + 1), layout: "unified" });
      const ids = flatten(tree)
        .map((el) => el.props["id"])
        .filter((id): id is string => typeof id === "string");
      expect(ids).toContain(`diff-row-x.txt-additions-${addRow.rightLineNumber}`);
    });
  });

  it("uses semantic diff-bg props sourced from the theme (no hard-coded hex passed to DiffLine)", () => {
    // The DiffRows wrapper passes the semantic "addition"/"deletion" tag;
    // the actual color is resolved inside DiffLine from the theme. Assert
    // here that the prop value is a recognized semantic tag, not a hex
    // literal — this protects against drift back to hard-coding bg colors
    // in the row renderer.
    const file = parseFile(SIMPLE_DIFF);
    const rows = planRows(file, [], "unified");
    const addIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "addition");
    const tree = callDiffRows({ rows: rows.slice(addIdx, addIdx + 1), layout: "unified" });
    const cells = diffLineCellsOf(tree);
    const bg = cells[0].props["diffBg"];
    expect(["addition", "deletion", undefined]).toContain(bg);
    // Independently verify the theme exposes the expected value DiffLine
    // will resolve "addition" to.
    expect(theme.bg.successRange.tui).toBe("#142a20");
  });
});
