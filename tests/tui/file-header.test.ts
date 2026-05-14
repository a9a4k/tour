import { describe, it, expect, vi } from "vitest";

// @opentui/core eagerly loads tree-sitter highlights `.scm` assets at
// module-init under vitest (see tests/tui/diff-rows.test.ts for the
// same shim). `FileHeader` doesn't actually need anything from
// @opentui/core, but the theme module pulls it in transitively.
vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import {
  FileHeader,
  fileHeaderExpandAllId,
  EXPAND_ALL_GLYPH,
} from "../../src/tui/FileHeader.js";

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

function findIdElement(node: unknown, id: string): AnyElement | undefined {
  return flatten(node).find((el) => el.props["id"] === id);
}

function textElements(node: unknown): AnyElement[] {
  return flatten(node).filter((el) => el.type === "text");
}

describe("FileHeader (issue #297 — per-file Expand-all in file-header chrome)", () => {
  it("renders the file label as a `<text>` child", () => {
    const tree = FileHeader({
      fileName: "x.txt",
      label: " M x.txt ",
      hasMultipleHiddenGaps: false,
    });
    const texts = textElements(tree).map((t) => t.props["children"]);
    expect(texts).toContain(" M x.txt ");
  });

  // Issue #298: the chrome affordance is gated on ≥ 2 hidden gaps;
  // single-gap and zero-gap files leave it hidden so the per-hunk
  // banner button (or standalone expand-down for file-bottom) is the
  // only visible expand affordance and the chrome doesn't stack a
  // redundant second `↕`.
  it("does NOT render the ↕ Expand-all affordance when the file has fewer than 2 hidden gaps", () => {
    const tree = FileHeader({
      fileName: "x.txt",
      label: " M x.txt ",
      hasMultipleHiddenGaps: false,
    });
    expect(findIdElement(tree, fileHeaderExpandAllId("x.txt"))).toBeUndefined();
    const texts = textElements(tree).map((t) => t.props["children"]);
    expect(texts).not.toContain(EXPAND_ALL_GLYPH);
  });

  it("renders the ↕ Expand-all affordance when the file has at least 2 hidden gaps", () => {
    const tree = FileHeader({
      fileName: "x.txt",
      label: " M x.txt ",
      hasMultipleHiddenGaps: true,
    });
    expect(findIdElement(tree, fileHeaderExpandAllId("x.txt"))).toBeDefined();
    const texts = textElements(tree).map((t) => t.props["children"]);
    expect(texts).toContain(EXPAND_ALL_GLYPH);
  });

  it("invokes onExpandAll(fileName) when the affordance is clicked", () => {
    const onExpandAll = vi.fn();
    const tree = FileHeader({
      fileName: "src/a.ts",
      label: " M src/a.ts ",
      hasMultipleHiddenGaps: true,
      onExpandAll,
    });
    const wrapper = findIdElement(tree, fileHeaderExpandAllId("src/a.ts"));
    expect(wrapper).toBeDefined();
    const handler = wrapper!.props["onMouseDown"];
    expect(typeof handler).toBe("function");
    (handler as () => void)();
    expect(onExpandAll).toHaveBeenCalledWith("src/a.ts");
  });

  it("omits the click handler entirely when onExpandAll is not provided", () => {
    const tree = FileHeader({
      fileName: "x.txt",
      label: " M x.txt ",
      hasMultipleHiddenGaps: true,
    });
    const wrapper = findIdElement(tree, fileHeaderExpandAllId("x.txt"));
    expect(wrapper).toBeDefined();
    expect(wrapper!.props["onMouseDown"]).toBeUndefined();
  });
});
