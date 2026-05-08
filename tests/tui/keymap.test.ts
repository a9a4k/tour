import { describe, it, expect } from "vitest";
import { dispatchKey, type KeyInput, type KeymapContext } from "../../src/tui/keymap.js";

const k = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyInput => ({
  name,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
});

const sidebar: KeymapContext = { sidebarFocused: true, fileCount: 3 };
const diffPane: KeymapContext = { sidebarFocused: false, fileCount: 3 };

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

  it("j is a no-op when there are no files", () => {
    expect(dispatchKey(k("j"), { sidebarFocused: true, fileCount: 0 }).type).toBe("noop");
  });

  it("space toggles collapse when sidebar focused with files", () => {
    expect(dispatchKey(k("space"), sidebar).type).toBe("toggle-collapse");
  });

  it("space is a no-op when sidebar is not focused", () => {
    expect(dispatchKey(k("space"), diffPane).type).toBe("noop");
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
