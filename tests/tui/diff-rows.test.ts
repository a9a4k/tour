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
  onCursorClick?: (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => void;
}): unknown {
  return DiffRows({
    fileName: args.fileName ?? "x.txt",
    rows: args.rows,
    layout: args.layout,
    cursorCardId: null,
    cursor: args.cursor ?? null,
    onCursorClick: args.onCursorClick,
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
      const cursor = { kind: "row" as const,
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
      const cursor = { kind: "row" as const,
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
      const cursor = { kind: "row" as const,
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
      const cursor = { kind: "row" as const,
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

  describe("mouse click → cursor (issue #104)", () => {
    function findIdElement(tree: unknown, id: string): AnyElement | undefined {
      return flatten(tree).find((el) => el.props["id"] === id);
    }

    it("split: clicking the left column of a paired row dispatches with deletions side + leftLineNumber", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(ctxIdx, ctxIdx + 1),
        layout: "split",
        onCursorClick,
      });
      const leftWrapper = findIdElement(
        tree,
        `diff-row-x.txt-deletions-${ctxRow.leftLineNumber}`,
      );
      expect(leftWrapper).toBeDefined();
      const handler = leftWrapper!.props["onMouseDown"];
      expect(typeof handler).toBe("function");
      (handler as () => void)();
      expect(onCursorClick).toHaveBeenCalledTimes(1);
      expect(onCursorClick).toHaveBeenCalledWith("x.txt", "deletions", ctxRow.leftLineNumber);
    });

    it("split: clicking the right column of a paired row dispatches with additions side + rightLineNumber", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(ctxIdx, ctxIdx + 1),
        layout: "split",
        onCursorClick,
      });
      const rightWrapper = findIdElement(
        tree,
        `diff-row-x.txt-additions-${ctxRow.rightLineNumber}`,
      );
      expect(rightWrapper).toBeDefined();
      const handler = rightWrapper!.props["onMouseDown"];
      expect(typeof handler).toBe("function");
      (handler as () => void)();
      expect(onCursorClick).toHaveBeenCalledTimes(1);
      expect(onCursorClick).toHaveBeenCalledWith("x.txt", "additions", ctxRow.rightLineNumber);
    });

    it("split: a pure-addition change row dispatches additions on either column (single-side row force)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pureAddIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber === null &&
          r.rightLineNumber !== null,
      );
      const pureAddRow = rows[pureAddIdx];
      if (pureAddRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(pureAddIdx, pureAddIdx + 1),
        layout: "split",
        onCursorClick,
      });
      // The right (populated) wrapper carries the row id and must dispatch
      // with the only valid side.
      const rightWrapper = findIdElement(
        tree,
        `diff-row-x.txt-additions-${pureAddRow.rightLineNumber}`,
      );
      expect(rightWrapper).toBeDefined();
      (rightWrapper!.props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenLastCalledWith(
        "x.txt",
        "additions",
        pureAddRow.rightLineNumber,
      );

      // Find the empty left half (no row id, but the column box still renders
      // and should map any click to the populated side).
      const splitRowBox = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["minHeight"] === 1,
      );
      expect(splitRowBox).toBeDefined();
      const halves = (splitRowBox!.props["children"] as AnyElement[]).filter(isElement);
      expect(halves.length).toBe(2);
      const leftHalf = halves[0];
      const leftHandler = leftHalf.props["onMouseDown"];
      // Clicking the empty half should still position the cursor at the
      // only valid side rather than being a dead zone.
      expect(typeof leftHandler).toBe("function");
      (leftHandler as () => void)();
      expect(onCursorClick).toHaveBeenLastCalledWith(
        "x.txt",
        "additions",
        pureAddRow.rightLineNumber,
      );
    });

    it("split: a pure-deletion change row dispatches deletions on either column", () => {
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
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber !== null &&
          r.rightLineNumber === null,
      );
      const pureDelRow = rows[pureDelIdx];
      if (pureDelRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(pureDelIdx, pureDelIdx + 1),
        layout: "split",
        onCursorClick,
      });
      const splitRowBox = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["minHeight"] === 1,
      );
      const halves = (splitRowBox!.props["children"] as AnyElement[]).filter(isElement);
      // Both halves must dispatch with deletions side + leftLineNumber.
      (halves[0].props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenLastCalledWith(
        "x.txt",
        "deletions",
        pureDelRow.leftLineNumber,
      );
      (halves[1].props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenLastCalledWith(
        "x.txt",
        "deletions",
        pureDelRow.leftLineNumber,
      );
    });

    it("unified: addition row click dispatches additions side + rightLineNumber", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const addIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "addition");
      const addRow = rows[addIdx];
      if (addRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(addIdx, addIdx + 1),
        layout: "unified",
        onCursorClick,
      });
      const wrapper = findIdElement(
        tree,
        `diff-row-x.txt-additions-${addRow.rightLineNumber}`,
      );
      (wrapper!.props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenCalledWith(
        "x.txt",
        "additions",
        addRow.rightLineNumber,
      );
    });

    it("unified: deletion row click dispatches deletions side + leftLineNumber", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const delIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "deletion");
      const delRow = rows[delIdx];
      if (delRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(delIdx, delIdx + 1),
        layout: "unified",
        onCursorClick,
      });
      const wrapper = findIdElement(
        tree,
        `diff-row-x.txt-deletions-${delRow.leftLineNumber}`,
      );
      (wrapper!.props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenCalledWith(
        "x.txt",
        "deletions",
        delRow.leftLineNumber,
      );
    });

    it("unified: context row click dispatches additions side (CONTEXT.md convention)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(ctxIdx, ctxIdx + 1),
        layout: "unified",
        onCursorClick,
      });
      const wrapper = findIdElement(
        tree,
        `diff-row-x.txt-additions-${ctxRow.rightLineNumber}`,
      );
      (wrapper!.props["onMouseDown"] as () => void)();
      expect(onCursorClick).toHaveBeenCalledWith(
        "x.txt",
        "additions",
        ctxRow.rightLineNumber,
      );
    });

    it("hunk-header rows do NOT receive a click handler", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const hunkIdx = rows.findIndex((r) => r.kind === "hunk-header");
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(hunkIdx, hunkIdx + 1),
        layout: "split",
        onCursorClick,
      });
      // Walk every element; none should carry an onMouseDown handler.
      for (const el of flatten(tree)) {
        expect(el.props["onMouseDown"]).toBeUndefined();
      }
    });

    it("annotation card rows do NOT receive a click handler on their wrapper", () => {
      const annDiff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
 ctx
-old
+new
`;
      const file = parseFile(annDiff);
      const annotation = {
        id: "ann-1",
        tour_id: "t",
        file: "x.txt",
        side: "additions" as const,
        line_start: 2,
        line_end: 2,
        body: "n",
        author: "u",
        created_at: "2025-01-01T00:00:00Z",
      };
      const rows = planRows(file, [annotation], "split");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      expect(annIdx).toBeGreaterThanOrEqual(0);
      const onCursorClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "split",
        onCursorClick,
      });
      // No element in the annotation row's subtree should carry onMouseDown
      // tied to onCursorClick.
      for (const el of flatten(tree)) {
        const handler = el.props["onMouseDown"];
        if (typeof handler === "function") {
          (handler as () => void)();
        }
      }
      expect(onCursorClick).not.toHaveBeenCalled();
    });

    it("split: dispatched cursor + side compose into a top-level composer at the clicked anchor (smoke)", async () => {
      const { buildTopLevelComposer } = await import("../../src/tui/composer-state.js");
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const ctxRow = rows[ctxIdx];
      if (ctxRow.kind !== "diff-row") throw new Error("expected diff-row");

      // Simulate the App-level wiring: capture the click into a Cursor and
      // pass that cursor into buildTopLevelComposer.
      let clickedCursor: import("../../src/core/cursor-state.js").Cursor | null = null;
      const onCursorClick = (
        f: string,
        s: "additions" | "deletions",
        ln: number,
      ) => {
        clickedCursor = { kind: "row", file: f, lineNumber: ln, side: s, preferredSide: s };
      };
      const tree = callDiffRows({
        rows: rows.slice(ctxIdx, ctxIdx + 1),
        layout: "split",
        onCursorClick,
      });
      const leftWrapper = findIdElement(
        tree,
        `diff-row-x.txt-deletions-${ctxRow.leftLineNumber}`,
      );
      (leftWrapper!.props["onMouseDown"] as () => void)();

      const composer = buildTopLevelComposer({
        cursor: clickedCursor,
        currentAnnotation: null,
      });
      expect(composer).not.toBeNull();
      expect(composer!.kind).toBe("top-level");
      if (composer!.kind !== "top-level") throw new Error("expected top-level");
      expect(composer!.file).toBe("x.txt");
      expect(composer!.side).toBe("deletions");
      expect(composer!.line_start).toBe(ctxRow.leftLineNumber);
      expect(composer!.line_end).toBe(ctxRow.leftLineNumber);
    });
  });

  // ADR 0013 / PRD #107: cursor's `❯` glyph + full-row bg renders on
  // interactive rows consistent with #100's cursor visual treatment.
  // The interactive row text body comes from the planner; this slice's
  // responsibility is only the cursor visual.
  describe("interactive-row cursor visual (PRD #107)", () => {
    function findIdElement(tree: unknown, id: string): AnyElement | undefined {
      return flatten(tree).find((el) => el.props["id"] === id);
    }

    it("renders an interactive row with cursorActive=true when cursor matches (file, subKind, boundaryRef)", () => {
      const rows: PlannedRow[] = [
        {
          kind: "interactive",
          subKind: "hunk-separator",
          boundaryRef: 1,
          text: "··· 12 hidden ···",
        },
      ];
      const cursor = { kind: "row" as const,
        file: "x.txt",
        lineNumber: 0,
        side: "additions" as const,
        preferredSide: "additions" as const,
        interactive: { subKind: "hunk-separator" as const, boundaryRef: 1 },
      };
      const tree = callDiffRows({ rows, layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["cursorActive"]).toBe(true);
    });

    it("does not light up an interactive row when the cursor's interactive anchor differs", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "hunk-separator", boundaryRef: 1 },
      ];
      const cursor = { kind: "row" as const,
        file: "x.txt",
        lineNumber: 0,
        side: "additions" as const,
        preferredSide: "additions" as const,
        interactive: { subKind: "hunk-separator" as const, boundaryRef: 99 },
      };
      const tree = callDiffRows({ rows, layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBeFalsy();
    });

    it("does not light up an interactive row when cursor is on a different file", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "boundary-top", boundaryRef: "top" },
      ];
      const cursor = { kind: "row" as const,
        file: "y.txt",
        lineNumber: 0,
        side: "additions" as const,
        preferredSide: "additions" as const,
        interactive: { subKind: "boundary-top" as const, boundaryRef: "top" as const },
      };
      const tree = callDiffRows({ rows, layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBeFalsy();
    });

    it("does not light up when cursor is a regular diff cursor (no interactive field)", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "hunk-separator", boundaryRef: 0 },
      ];
      const cursor = { kind: "row" as const,
        file: "x.txt",
        lineNumber: 5,
        side: "additions" as const,
        preferredSide: "additions" as const,
      };
      const tree = callDiffRows({ rows, layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBeFalsy();
    });

    it("emits a stable id `interactive-row-${file}-${subKind}-${boundaryRef}` on the row wrapper", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "hunk-separator", boundaryRef: 1 },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      const wrapper = findIdElement(tree, "interactive-row-x.txt-hunk-separator-1");
      expect(wrapper).toBeDefined();
    });

    it("mouse click dispatches onInteractiveClick(file, subKind, boundaryRef)", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "boundary-bottom", boundaryRef: "bottom" },
      ];
      const onInteractiveClick = vi.fn();
      const tree = DiffRows({
        fileName: "x.txt",
        rows,
        layout: "split",
        cursorCardId: null,
        cursor: null,
        onInteractiveClick,
      });
      const wrapper = findIdElement(tree, "interactive-row-x.txt-boundary-bottom-bottom");
      expect(wrapper).toBeDefined();
      const handler = wrapper!.props["onMouseDown"];
      expect(typeof handler).toBe("function");
      (handler as () => void)();
      expect(onInteractiveClick).toHaveBeenCalledWith(
        "x.txt",
        "boundary-bottom",
        "bottom",
      );
    });

    // PRD #108 issue #113: classifier-collapsed file's synthetic indicator
    // row renders through the same generic interactive-row pipeline.
    it("renders a collapsed-file row with the planner's `··· N lines hidden — Enter to expand ···` text", () => {
      const rows: PlannedRow[] = [
        {
          kind: "interactive",
          subKind: "collapsed-file",
          boundaryRef: "top",
          text: "··· 42 lines hidden — Enter to expand ···",
        },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["text"]).toBe("··· 42 lines hidden — Enter to expand ···");
    });

    it("lights up cursor on a collapsed-file row when the cursor's interactive anchor matches", () => {
      const rows: PlannedRow[] = [
        {
          kind: "interactive",
          subKind: "collapsed-file",
          boundaryRef: "top",
          text: "··· 42 lines hidden — Enter to expand ···",
        },
      ];
      const cursor = { kind: "row" as const,
        file: "x.txt",
        lineNumber: 0,
        side: "additions" as const,
        preferredSide: "additions" as const,
        interactive: { subKind: "collapsed-file" as const, boundaryRef: "top" as const },
      };
      const tree = callDiffRows({ rows, layout: "split", cursor });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["cursorActive"]).toBe(true);
    });

    it("emits the collapsed-file row id `interactive-row-${file}-collapsed-file-top`", () => {
      const rows: PlannedRow[] = [
        {
          kind: "interactive",
          subKind: "collapsed-file",
          boundaryRef: "top",
          text: "··· 1 lines hidden — Enter to expand ···",
        },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      const wrapper = findIdElement(tree, "interactive-row-x.txt-collapsed-file-top");
      expect(wrapper).toBeDefined();
    });

    it("interactive row does not pass diffBg / annotation tint props (it has no source content)", () => {
      const rows: PlannedRow[] = [
        { kind: "interactive", subKind: "hunk-separator", boundaryRef: 0 },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells[0].props["diffBg"]).toBeUndefined();
      expect(cells[0].props["gutterTinted"]).toBe(false);
      expect(cells[0].props["contentTinted"]).toBe(false);
      expect(cells[0].props["gutterAccent"]).toBe(false);
    });
  });

  // PRD #108 (issue #112). Hunk-header rows render `··· N hidden ···` after
  // the existing `@@ ...` text when there's still hidden content in the gap
  // above this hunk. The suffix is suppressed when the gap is fully
  // expanded (or for hunks with no preceding gap).
  describe("hunk-header expansion suffix (PRD #108)", () => {
    function findText(tree: unknown, predicate: (s: string) => boolean): AnyElement | undefined {
      return flatten(tree).find(
        (el) => typeof el.props.children === "string" && predicate(el.props.children as string),
      );
    }

    it("renders an interactive hunk-header with `··· N hidden ···` suffix when gapAbove > 0", () => {
      // Mid-file, small gap (≤ 40) → symmetric `↕` glyph.
      const rows: PlannedRow[] = [
        {
          kind: "hunk-header",
          header: "@@ -10,3 +10,3 @@",
          hunkIndex: 1,
          gapAbove: 12,
        },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      // Interactive hunk-header renders through the DiffLine pipeline (with
      // cursor visual); body text lands on DiffLine's `text` prop.
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      const text = cells[0].props["text"] as string;
      expect(text).toContain("12 hidden");
      expect(text).toContain("@@ -10,3 +10,3 @@");
    });

    it("renders an inert hunk-header (plain muted text, no DiffLine wrapper) when gapAbove === 0", () => {
      const rows: PlannedRow[] = [
        {
          kind: "hunk-header",
          header: "@@ -1,3 +1,3 @@",
          hunkIndex: 0,
          gapAbove: 0,
        },
      ];
      const tree = callDiffRows({ rows, layout: "split" });
      const node = findText(tree, (s) => s.startsWith("@@"));
      expect(node).toBeDefined();
      expect(node!.props.children).toBe("@@ -1,3 +1,3 @@");
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
