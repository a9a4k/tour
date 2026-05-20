import { describe, it, expect, vi } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import { SidebarRowTui } from "../../src/tui/SidebarRow.js";
import { CURSOR_GLYPH } from "../../src/tui/DiffLine.js";

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

function textElements(tree: unknown): AnyElement[] {
  return flatten(tree).filter((el) => el.type === "text");
}

function selectableMouseEvent() {
  return { target: { selectable: true }, button: 0, stopPropagation: vi.fn() };
}

function mouseHandlersOf(element: AnyElement) {
  return {
    down: element.props.onMouseDown as (event: unknown) => void,
    drag: element.props.onMouseDrag as (event: unknown) => void,
    up: element.props.onMouseUp as (event: unknown) => void,
  };
}

function folder(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "folder" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "folder" }> {
  return {
    kind: "folder",
    path: "src",
    displayName: "src",
    depth: 0,
    hasChildren: true,
    commentCount: 0,
    collapsed: false,
    ...overrides,
  };
}

function file(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "file" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "file" }> {
  const f: DiffFile = { name: "src/controller.ts", type: "change", hunks: [] };
  return {
    kind: "file",
    path: "src/controller.ts",
    displayName: "controller.ts",
    depth: 0,
    file: f,
    commentCount: 0,
    ...overrides,
  };
}

describe("SidebarRowTui Text selection", () => {
  it("keeps sidebar visible text selectable while excluding the cursor glyph", () => {
    const folderTree = SidebarRowTui({
      row: folder(),
      isSelected: true,
      sidebarFocused: true,
      sidebarContentWidth: 28,
      onActivate: vi.fn(),
    });
    const folderTexts = textElements(folderTree);
    expect(folderTexts.find((t) => t.props.children === "src")?.props.selectable).toBe(true);
    for (const visible of ["▾ ", " "]) {
      const nodes = folderTexts.filter((t) => t.props.children === visible);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.props.selectable).not.toBe(false);
    }
    for (const node of folderTexts.filter((t) => t.props.children === CURSOR_GLYPH)) {
      expect(node.props.selectable).toBe(false);
    }

    const fileTree = SidebarRowTui({
      row: file({ commentCount: 3 }),
      isSelected: true,
      sidebarFocused: true,
      sidebarContentWidth: 40,
      stats: { additions: 4, deletions: 2 },
      onActivate: vi.fn(),
    });
    const fileTexts = textElements(fileTree);
    expect(fileTexts.find((t) => t.props.children === "controller.ts")?.props.selectable)
      .toBe(true);
    for (const visible of ["M ", " +4", " -2", " [3]", " "]) {
      const nodes = fileTexts.filter((t) => t.props.children === visible);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.props.selectable).not.toBe(false);
    }
    for (const node of fileTexts.filter((t) => t.props.children === CURSOR_GLYPH)) {
      expect(node.props.selectable).toBe(false);
    }
  });

  it("keeps label drags read-only while plain label clicks still activate the row", () => {
    const onActivate = vi.fn();
    const tree = SidebarRowTui({
      row: file(),
      isSelected: false,
      sidebarFocused: true,
      sidebarContentWidth: 40,
      stats: { additions: 0, deletions: 0 },
      onActivate,
    });
    if (!isElement(tree)) throw new Error("expected sidebar row element");
    const handlers = mouseHandlersOf(tree);

    const drag = selectableMouseEvent();
    handlers.down(drag);
    handlers.drag(drag);
    handlers.up(drag);
    expect(onActivate).not.toHaveBeenCalled();
    expect(drag.stopPropagation).toHaveBeenCalled();

    const click = selectableMouseEvent();
    handlers.down(click);
    handlers.up(click);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
