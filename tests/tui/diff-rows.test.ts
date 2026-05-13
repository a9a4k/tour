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
  onCardClick?: (annotationId: string) => void;
}): unknown {
  return DiffRows({
    fileName: args.fileName ?? "x.txt",
    rows: args.rows,
    layout: args.layout,
    cursorCardId: null,
    cursor: args.cursor ?? null,
    onCursorClick: args.onCursorClick,
    onCardClick: args.onCardClick,
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

  // Issue #257 — TUI split layout's gutter previously omitted the +/-
  // sign character that the unified layout has via `unifiedSign`. Color-
  // blind / tint-only signalling was insufficient. Mirror the webapp's
  // #221 behaviour: split rows carry `+` on the additions side and `-`
  // on the deletions side; context rows carry a blank sign; the empty
  // side of a single-side change row carries no sign (blank padding).
  describe("split-layout +/- sign column (#257)", () => {
    it("paired change row: left gutter shows '-' sign, right gutter shows '+' sign", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pairedIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber !== null &&
          r.rightLineNumber !== null,
      );
      expect(pairedIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pairedIdx, pairedIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["gutter"]).toContain("-");
      expect(cells[0].props["gutter"]).not.toContain("+");
      expect(cells[1].props["gutter"]).toContain("+");
      expect(cells[1].props["gutter"]).not.toContain("-");
    });

    it("pure-addition change row: right gutter shows '+', left gutter has no sign", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pureAddIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber === null &&
          r.rightLineNumber !== null,
      );
      expect(pureAddIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureAddIdx, pureAddIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["gutter"]).not.toContain("+");
      expect(cells[0].props["gutter"]).not.toContain("-");
      expect(cells[1].props["gutter"]).toContain("+");
      expect(cells[1].props["gutter"]).not.toContain("-");
    });

    it("pure-deletion change row: left gutter shows '-', right gutter has no sign", () => {
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
      expect(pureDelIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureDelIdx, pureDelIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["gutter"]).toContain("-");
      expect(cells[0].props["gutter"]).not.toContain("+");
      expect(cells[1].props["gutter"]).not.toContain("+");
      expect(cells[1].props["gutter"]).not.toContain("-");
    });

    it("context row: neither gutter shows a sign", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      expect(ctxIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["gutter"]).not.toContain("+");
      expect(cells[0].props["gutter"]).not.toContain("-");
      expect(cells[1].props["gutter"]).not.toContain("+");
      expect(cells[1].props["gutter"]).not.toContain("-");
    });

    it("all split diff-row gutters share a single width across the file (sign column reserved on every row)", () => {
      // Mix of context + paired + pure-add rows in one file. Every split
      // cell's gutter string must be the same length so code text aligns
      // across kinds. Drives keeping a blank sign on context / empty
      // sides rather than dropping the sign column.
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const diffRowIdxs = rows
        .map((r, i) => (r.kind === "diff-row" ? i : -1))
        .filter((i) => i >= 0);
      expect(diffRowIdxs.length).toBeGreaterThan(0);
      const tree = callDiffRows({
        rows: diffRowIdxs.map((i) => rows[i]),
        layout: "split",
      });
      const cells = diffLineCellsOf(tree);
      const widths = new Set(cells.map((c) => (c.props["gutter"] as string).length));
      expect(widths.size).toBe(1);
    });
  });

  // Issue #258 — TUI split layout previously sat the two halves flush
  // against each other with no visible separator. Mirror the webapp's
  // #251: render a `│` (BOX DRAWINGS LIGHT VERTICAL, U+2502) in
  // theme.border.muted at the column boundary on every diff row. The
  // divider lives only in split layout; banner rows (hunk-header /
  // interactive) skip the per-half composition entirely so the rule
  // naturally breaks at each banner.
  describe("split-layout vertical divider between halves (#258)", () => {
    const isDivider = (el: AnyElement): boolean =>
      typeof el.props.children === "string" && (el.props.children as string) === "│";

    it("renders a `│` divider in theme.border.muted on a context row", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const divider = flatten(tree).find(isDivider);
      expect(divider).toBeDefined();
      expect(divider!.props.fg).toBe(theme.border.muted);
    });

    it("renders a `│` divider on paired change, pure-addition, and pure-deletion rows", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pairedIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber !== null &&
          r.rightLineNumber !== null,
      );
      const treePaired = callDiffRows({ rows: rows.slice(pairedIdx, pairedIdx + 1), layout: "split" });
      expect(flatten(treePaired).some(isDivider)).toBe(true);

      const pureAddIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber === null &&
          r.rightLineNumber !== null,
      );
      const treePureAdd = callDiffRows({ rows: rows.slice(pureAddIdx, pureAddIdx + 1), layout: "split" });
      expect(flatten(treePureAdd).some(isDivider)).toBe(true);

      const delFile = parseFile(`diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,1 @@
 ctx
-only-del
`);
      const delRows = planRows(delFile, [], "split");
      const pureDelIdx = delRows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber !== null &&
          r.rightLineNumber === null,
      );
      const treePureDel = callDiffRows({
        rows: delRows.slice(pureDelIdx, pureDelIdx + 1),
        layout: "split",
      });
      expect(flatten(treePureDel).some(isDivider)).toBe(true);
    });

    it("does NOT render a divider in unified layout (one rendered column → no column boundary)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const tree = callDiffRows({ rows, layout: "unified" });
      expect(flatten(tree).some(isDivider)).toBe(false);
    });

    it("does NOT render a divider on banner rows (hunk-header / interactive); rule breaks at banners", () => {
      const interactiveHunkRow: PlannedRow = {
        kind: "hunk-header",
        header: "@@ -10,3 +10,3 @@",
        hunkIndex: 1,
        gapAbove: 12,
      };
      const treeInteractive = callDiffRows({ rows: [interactiveHunkRow], layout: "split" });
      expect(flatten(treeInteractive).some(isDivider)).toBe(false);

      const inertHunkRow: PlannedRow = {
        kind: "hunk-header",
        header: "@@ -1,3 +1,3 @@",
        hunkIndex: 0,
        gapAbove: 0,
      };
      const treeInert = callDiffRows({ rows: [inertHunkRow], layout: "split" });
      expect(flatten(treeInert).some(isDivider)).toBe(false);

      const collapsedRow: PlannedRow = {
        kind: "interactive",
        subKind: "collapsed-file",
        boundaryRef: "top",
        text: "··· 42 lines hidden — Enter to expand ···",
      };
      const treeGeneric = callDiffRows({ rows: [collapsedRow], layout: "split" });
      expect(flatten(treeGeneric).some(isDivider)).toBe(false);
    });

    it("divider sits between the two 50%-width halves in the split row composition", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const splitRowBox = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["minHeight"] === 1,
      );
      expect(splitRowBox).toBeDefined();
      const children = (splitRowBox!.props["children"] as AnyElement[]).filter(isElement);
      // left half (50%) + divider (width=1) + right half (50%)
      expect(children.length).toBe(3);
      expect(children[0].props["width"]).toBe("50%");
      expect(children[1].props["width"]).toBe(1);
      expect(children[2].props["width"]).toBe("50%");
      // divider carries the `│` text inside its 1-cell box
      const dividerText = flatten(children[1]).find(
        (el) => typeof el.props.children === "string" && el.props.children === "│",
      );
      expect(dividerText).toBeDefined();
      expect(dividerText!.props.fg).toBe(theme.border.muted);
    });
  });

  // Issue #260 — TUI split layout previously rendered the empty side
  // of a pure-addition / pure-deletion row as plain canvas, making the
  // row read as a half-row floating against the page. Mirror webapp
  // #227: paint the empty side's gutter + code cell in
  // theme.canvas.inset so each row reads as "one side intentionally
  // blank" rather than "content here, void there". Signal: pass
  // `emptySide=true` to the DiffLine on the side whose lineNumber is
  // null on a change row.
  describe("split-layout empty-side neutral fill (#260)", () => {
    it("pure-addition row: left (empty) cell carries emptySide=true; right (populated) cell carries emptySide=false", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pureAddIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber === null &&
          r.rightLineNumber !== null,
      );
      expect(pureAddIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureAddIdx, pureAddIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["emptySide"]).toBe(true);
      expect(cells[1].props["emptySide"]).toBeFalsy();
    });

    it("pure-deletion row: right (empty) cell carries emptySide=true; left (populated) cell carries emptySide=false", () => {
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
      expect(pureDelIdx).toBeGreaterThanOrEqual(0);
      const tree = callDiffRows({ rows: rows.slice(pureDelIdx, pureDelIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["emptySide"]).toBeFalsy();
      expect(cells[1].props["emptySide"]).toBe(true);
    });

    it("paired change row: neither side carries emptySide=true (both halves populated)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const pairedIdx = rows.findIndex(
        (r) =>
          r.kind === "diff-row" &&
          r.type === "change" &&
          r.leftLineNumber !== null &&
          r.rightLineNumber !== null,
      );
      const tree = callDiffRows({ rows: rows.slice(pairedIdx, pairedIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["emptySide"]).toBeFalsy();
      expect(cells[1].props["emptySide"]).toBeFalsy();
    });

    it("context row: neither side carries emptySide=true (rule does not apply)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "split");
      const ctxIdx = rows.findIndex((r) => r.kind === "diff-row" && r.type === "context");
      const tree = callDiffRows({ rows: rows.slice(ctxIdx, ctxIdx + 1), layout: "split" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(2);
      expect(cells[0].props["emptySide"]).toBeFalsy();
      expect(cells[1].props["emptySide"]).toBeFalsy();
    });

    it("unified layout: never carries emptySide=true (concept does not apply — one rendered column)", () => {
      const file = parseFile(SIMPLE_DIFF);
      const rows = planRows(file, [], "unified");
      const tree = callDiffRows({ rows, layout: "unified" });
      const cells = diffLineCellsOf(tree);
      for (const c of cells) expect(c.props["emptySide"]).toBeFalsy();
    });

    it("banner rows (hunk-header / interactive) do not carry emptySide=true", () => {
      const interactiveHunkRow: PlannedRow = {
        kind: "hunk-header",
        header: "@@ -10,3 +10,3 @@",
        hunkIndex: 1,
        gapAbove: 12,
      };
      const treeInteractive = callDiffRows({ rows: [interactiveHunkRow], layout: "split" });
      const interactiveCells = diffLineCellsOf(treeInteractive);
      for (const c of interactiveCells) expect(c.props["emptySide"]).toBeFalsy();

      const collapsedRow: PlannedRow = {
        kind: "interactive",
        subKind: "collapsed-file",
        boundaryRef: "top",
        text: "··· 42 lines hidden — Enter to expand ···",
      };
      const treeGeneric = callDiffRows({ rows: [collapsedRow], layout: "split" });
      const genericCells = diffLineCellsOf(treeGeneric);
      for (const c of genericCells) expect(c.props["emptySide"]).toBeFalsy();
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
      // and should map any click to the populated side). The split row now
      // carries a 1-cell `│` divider between the two halves (#258); filter
      // by `width="50%"` to isolate the half columns.
      const splitRowBox = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["minHeight"] === 1,
      );
      expect(splitRowBox).toBeDefined();
      const halves = (splitRowBox!.props["children"] as AnyElement[]).filter(
        (c) => isElement(c) && c.props["width"] === "50%",
      );
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
      // Filter by width="50%" to skip the 1-cell `│` divider between
      // halves (#258).
      const halves = (splitRowBox!.props["children"] as AnyElement[]).filter(
        (c) => isElement(c) && c.props["width"] === "50%",
      );
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

  // Issue #261: ADR 0022 unified the cursor; CardAnchor is first-class and
  // mouse-click on a card must place the cursor on it, mirroring the
  // webapp's `setCursorFromCardClick`. The annotation branch in DiffRows
  // wires `onMouseDown` on the card's wrapper, calling `onCardClick` with
  // the row's annotation id. In split layout, only the card half carries
  // the handler — the empty sibling stays a no-op.
  describe("mouse click on annotation card → cursor (issue #261)", () => {
    const ANN_DIFF = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
 ctx
-old
+new
`;

    function makeAnn(side: "additions" | "deletions"): import("../../src/core/types.js").Annotation {
      return {
        id: `ann-${side}`,
        tour_id: "t",
        file: "x.txt",
        side,
        line_start: side === "additions" ? 2 : 1,
        line_end: side === "additions" ? 2 : 1,
        body: "n",
        author: "u",
        created_at: "2025-01-01T00:00:00Z",
      };
    }

    it("unified: clicking the card wrapper dispatches onCardClick with the annotation id", () => {
      const file = parseFile(ANN_DIFF);
      const ann = makeAnn("additions");
      const rows = planRows(file, [ann], "unified");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      expect(annIdx).toBeGreaterThanOrEqual(0);
      const onCardClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "unified",
        onCardClick,
      });
      const withHandler = flatten(tree).find(
        (el) => typeof el.props["onMouseDown"] === "function",
      );
      expect(withHandler).toBeDefined();
      (withHandler!.props["onMouseDown"] as () => void)();
      expect(onCardClick).toHaveBeenCalledTimes(1);
      expect(onCardClick).toHaveBeenCalledWith(ann.id);
    });

    it("split (additions card): right half wrapper fires onCardClick; left empty half is a no-op", () => {
      const file = parseFile(ANN_DIFF);
      const ann = makeAnn("additions");
      const rows = planRows(file, [ann], "split");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      const onCardClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "split",
        onCardClick,
      });
      // The annotation row in split layout is a flexDirection="row" box
      // holding two 50%-width halves. The card sits in the side that
      // matches the annotation's side; the opposite half is empty.
      const splitWrapper = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["width"] === "100%",
      );
      expect(splitWrapper).toBeDefined();
      const halves = (splitWrapper!.props["children"] as AnyElement[]).filter(
        (c) => isElement(c) && c.props["width"] === "50%",
      );
      expect(halves.length).toBe(2);
      const [leftHalf, rightHalf] = halves;
      expect(leftHalf.props["onMouseDown"]).toBeUndefined();
      expect(typeof rightHalf.props["onMouseDown"]).toBe("function");
      (rightHalf.props["onMouseDown"] as () => void)();
      expect(onCardClick).toHaveBeenCalledTimes(1);
      expect(onCardClick).toHaveBeenCalledWith(ann.id);
    });

    it("split (deletions card): left half wrapper fires onCardClick; right empty half is a no-op", () => {
      const file = parseFile(ANN_DIFF);
      const ann = makeAnn("deletions");
      const rows = planRows(file, [ann], "split");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      const onCardClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "split",
        onCardClick,
      });
      const splitWrapper = flatten(tree).find(
        (el) => el.props["flexDirection"] === "row" && el.props["width"] === "100%",
      );
      const halves = (splitWrapper!.props["children"] as AnyElement[]).filter(
        (c) => isElement(c) && c.props["width"] === "50%",
      );
      const [leftHalf, rightHalf] = halves;
      expect(typeof leftHalf.props["onMouseDown"]).toBe("function");
      expect(rightHalf.props["onMouseDown"]).toBeUndefined();
      (leftHalf.props["onMouseDown"] as () => void)();
      expect(onCardClick).toHaveBeenCalledTimes(1);
      expect(onCardClick).toHaveBeenCalledWith(ann.id);
    });

    it("does not invoke onCursorClick on the annotation card wrapper", () => {
      const file = parseFile(ANN_DIFF);
      const ann = makeAnn("additions");
      const rows = planRows(file, [ann], "split");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      const onCursorClick = vi.fn();
      const onCardClick = vi.fn();
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "split",
        onCursorClick,
        onCardClick,
      });
      for (const el of flatten(tree)) {
        const handler = el.props["onMouseDown"];
        if (typeof handler === "function") (handler as () => void)();
      }
      expect(onCursorClick).not.toHaveBeenCalled();
      expect(onCardClick).toHaveBeenCalled();
    });

    it("annotation branch does not wire onMouseDown when onCardClick is omitted", () => {
      const file = parseFile(ANN_DIFF);
      const ann = makeAnn("additions");
      const rows = planRows(file, [ann], "split");
      const annIdx = rows.findIndex((r) => r.kind === "annotation");
      const tree = callDiffRows({
        rows: rows.slice(annIdx, annIdx + 1),
        layout: "split",
      });
      for (const el of flatten(tree)) {
        // The card itself is a function component; only intrinsic wrapper
        // boxes can carry onMouseDown. No wrapper in the subtree should
        // declare one when the App-shell hasn't supplied onCardClick.
        expect(el.props["onMouseDown"]).toBeUndefined();
      }
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
      // GitHub paints the whole hunk-header line in continuous fg.muted
      // grey — the inert TUI path follows the same treatment.
      expect(node!.props.fg).toBe(theme.fg.muted);
    });

    // Issue #259: previously the interactive hunk-header ran the
    // function-context tail through the syntax highlighter (keyword `import`
    // painted red, identifiers blue, etc), making the banner read as code
    // and pulling attention from the diff rows below. GitHub renders the
    // entire hunk-header line in one continuous fg.muted grey. The TUI
    // matches by passing `mutedText` to DiffLine, which skips the syntax
    // pipeline and tints the content text in theme.fg.muted.
    it("interactive hunk-header passes mutedText=true to DiffLine — no syntax highlight on the function-context tail (issue #259)", () => {
      const rows: PlannedRow[] = [
        {
          kind: "hunk-header",
          header: "@@ -65,6 +65,46 @@ import {",
          hunkIndex: 1,
          gapAbove: 5,
        },
      ];
      const tree = callDiffRows({ rows, layout: "split", fileName: "x.ts" });
      const cells = diffLineCellsOf(tree);
      expect(cells.length).toBe(1);
      expect(cells[0].props["mutedText"]).toBe(true);
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
    expect(theme.bg.successRange.tui).toBe("#1c4328");
  });
});
