import { describe, it, expect } from "vitest";
import { dispatchKey, type KeyInput, type KeymapContext } from "../../src/tui/keymap.js";

const k = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyInput => ({
  name,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
});

const sidebar: KeymapContext = { sidebarFocused: true, rowCount: 3, selectedRowKind: "file" };
const sidebarFolder: KeymapContext = { sidebarFocused: true, rowCount: 3, selectedRowKind: "folder" };
const diffPane: KeymapContext = { sidebarFocused: false, rowCount: 3, selectedRowKind: "file" };

describe("dispatchKey", () => {
  it("q quits", () => {
    expect(dispatchKey(k("q"), sidebar).type).toBe("quit");
  });

  it("Ctrl+C quits", () => {
    expect(dispatchKey(k("c", { ctrl: true }), sidebar).type).toBe("quit");
  });

  it("plain c does not quit", () => {
    expect(dispatchKey(k("c"), sidebar).type).toBe("noop");
  });

  it("Tab toggles pane", () => {
    expect(dispatchKey(k("tab"), sidebar).type).toBe("toggle-pane");
  });

  it("Shift+Tab focuses sidebar", () => {
    expect(dispatchKey(k("tab", { shift: true }), diffPane).type).toBe("focus-sidebar");
  });

  it("j and ArrowDown both move down when sidebar focused", () => {
    expect(dispatchKey(k("j"), sidebar).type).toBe("move-file-down");
    expect(dispatchKey(k("down"), sidebar).type).toBe("move-file-down");
  });

  it("k and ArrowUp both move up when sidebar focused", () => {
    expect(dispatchKey(k("k"), sidebar).type).toBe("move-file-up");
    expect(dispatchKey(k("up"), sidebar).type).toBe("move-file-up");
  });

  it("Return selects file when sidebar focused", () => {
    expect(dispatchKey(k("return"), sidebar).type).toBe("select-file");
  });

  it("j is a no-op when sidebar is not focused", () => {
    expect(dispatchKey(k("j"), diffPane).type).toBe("noop");
  });

  it("j is a no-op when there are no rows", () => {
    expect(dispatchKey(k("j"), { sidebarFocused: true, rowCount: 0, selectedRowKind: null }).type).toBe("noop");
  });

  it("space on a file row toggles per-file diff collapse", () => {
    expect(dispatchKey(k("space"), sidebar).type).toBe("toggle-collapse");
  });

  it("space on a folder row toggles folder expand/collapse", () => {
    expect(dispatchKey(k("space"), sidebarFolder).type).toBe("toggle-folder");
  });

  it("space is a no-op when sidebar is not focused", () => {
    expect(dispatchKey(k("space"), diffPane).type).toBe("noop");
  });

  it("right on a folder row expands the folder", () => {
    expect(dispatchKey(k("right"), sidebarFolder).type).toBe("expand-folder");
  });

  it("right on a file row is a no-op", () => {
    expect(dispatchKey(k("right"), sidebar).type).toBe("noop");
  });

  it("left on a folder row collapses the folder", () => {
    expect(dispatchKey(k("left"), sidebarFolder).type).toBe("collapse-folder");
  });

  it("left on a file row collapses its parent folder", () => {
    expect(dispatchKey(k("left"), sidebar).type).toBe("collapse-parent");
  });

  it("right and left are no-ops when sidebar is not focused", () => {
    expect(dispatchKey(k("right"), diffPane).type).toBe("noop");
    expect(dispatchKey(k("left"), diffPane).type).toBe("noop");
  });

  it("n returns next-annotation regardless of pane focus", () => {
    expect(dispatchKey(k("n"), sidebar).type).toBe("next-annotation");
    expect(dispatchKey(k("n"), diffPane).type).toBe("next-annotation");
  });

  it("p returns prev-annotation regardless of pane focus", () => {
    expect(dispatchKey(k("p"), sidebar).type).toBe("prev-annotation");
    expect(dispatchKey(k("p"), diffPane).type).toBe("prev-annotation");
  });

  it("l returns toggle-layout regardless of pane focus", () => {
    expect(dispatchKey(k("l"), sidebar).type).toBe("toggle-layout");
    expect(dispatchKey(k("l"), diffPane).type).toBe("toggle-layout");
    expect(dispatchKey(k("l"), sidebarFolder).type).toBe("toggle-layout");
  });

  it("Ctrl+L is not consumed as toggle-layout", () => {
    expect(dispatchKey(k("l", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("l", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+N is not consumed as next-annotation", () => {
    expect(dispatchKey(k("n", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("n", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+P is not consumed as prev-annotation", () => {
    expect(dispatchKey(k("p", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("p", { ctrl: true }), diffPane).type).toBe("noop");
  });

  // Regression: opentui's KeyEvent uses .name (lowercase node-readline style),
  // not the browser KeyboardEvent's .key (TitleCase like "Tab", "ArrowDown").
  // If someone re-introduces the browser shape, this test catches it.
  it("does not match browser-style key names", () => {
    expect(dispatchKey(k("Tab"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("ArrowDown"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("Return"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("Q"), sidebar).type).toBe("noop");
  });
});
