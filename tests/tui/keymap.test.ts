import { describe, it, expect } from "vitest";
import { dispatchKey, type KeyInput, type KeymapContext } from "../../src/tui/keymap.js";

const k = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyInput => ({
  name,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
});

const sidebar: KeymapContext = {
  sidebarFocused: true,
  rowCount: 3,
  selectedRowKind: "file",
  cursorExists: true,
  cursorOnInteractive: false,
};
const sidebarFolder: KeymapContext = {
  sidebarFocused: true,
  rowCount: 3,
  selectedRowKind: "folder",
  cursorExists: true,
  cursorOnInteractive: false,
};
const diffPane: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorExists: true,
  cursorOnInteractive: false,
};
const diffPaneNoCursor: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorExists: false,
  cursorOnInteractive: false,
};
const diffPaneInteractive: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorExists: true,
  cursorOnInteractive: true,
};

describe("dispatchKey", () => {
  it("q quits", () => {
    expect(dispatchKey(k("q"), sidebar).type).toBe("quit");
  });

  it("Ctrl+C quits", () => {
    expect(dispatchKey(k("c", { ctrl: true }), sidebar).type).toBe("quit");
  });

  it("plain c does not quit", () => {
    expect(dispatchKey(k("c"), sidebar).type).not.toBe("quit");
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

  it("j is a no-op when sidebar has no rows and cursor doesn't exist", () => {
    expect(
      dispatchKey(k("j"), {
        sidebarFocused: true,
        rowCount: 0,
        selectedRowKind: null,
        cursorExists: false,
        cursorOnInteractive: false,
      }).type,
    ).toBe("noop");
  });

  it("c on a file row toggles per-file diff collapse", () => {
    expect(dispatchKey(k("c"), sidebar).type).toBe("toggle-collapse");
  });

  it("c on a folder row toggles folder expand/collapse", () => {
    expect(dispatchKey(k("c"), sidebarFolder).type).toBe("toggle-folder");
  });

  it("c outside sidebar toggles replies collapse (sidebar collapse stays sidebar-only)", () => {
    expect(dispatchKey(k("c"), diffPane).type).toBe("toggle-replies-collapse");
  });

  it("Ctrl+C outside sidebar is not consumed as toggle-replies-collapse (still quits)", () => {
    expect(dispatchKey(k("c", { ctrl: true }), diffPane).type).toBe("quit");
  });

  it("c is a no-op when no row is selected and no cursor exists", () => {
    expect(
      dispatchKey(k("c"), {
        sidebarFocused: true,
        rowCount: 0,
        selectedRowKind: null,
        cursorExists: false,
        cursorOnInteractive: false,
      }).type,
    ).toBe("noop");
  });

  it("Space pages the diff pane down regardless of focus", () => {
    expect(dispatchKey(k("space"), sidebar).type).toBe("page-diff-down");
    expect(dispatchKey(k("space"), sidebarFolder).type).toBe("page-diff-down");
    expect(dispatchKey(k("space"), diffPane).type).toBe("page-diff-down");
  });

  it("Shift+Space pages the diff pane up regardless of focus", () => {
    expect(dispatchKey(k("space", { shift: true }), sidebar).type).toBe("page-diff-up");
    expect(dispatchKey(k("space", { shift: true }), sidebarFolder).type).toBe("page-diff-up");
    expect(dispatchKey(k("space", { shift: true }), diffPane).type).toBe("page-diff-up");
  });

  it("Ctrl+Space is not consumed as page-diff", () => {
    expect(dispatchKey(k("space", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("space", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("right on a folder row expands the folder", () => {
    expect(dispatchKey(k("right"), sidebarFolder).type).toBe("expand-folder");
  });

  it("right on a file row in sidebar is a no-op (sidebar has no right binding for files)", () => {
    expect(dispatchKey(k("right"), sidebar).type).toBe("noop");
  });

  it("left on a folder row collapses the folder", () => {
    expect(dispatchKey(k("left"), sidebarFolder).type).toBe("collapse-folder");
  });

  it("left on a file row collapses its parent folder", () => {
    expect(dispatchKey(k("left"), sidebar).type).toBe("collapse-parent");
  });

  it("right and left in the diff pane drive cursor side selection (not noop)", () => {
    expect(dispatchKey(k("right"), diffPane).type).toBe("cursor-side-right");
    expect(dispatchKey(k("left"), diffPane).type).toBe("cursor-side-left");
  });

  it("right and left are no-ops in the diff pane when no cursor exists", () => {
    expect(dispatchKey(k("right"), diffPaneNoCursor).type).toBe("noop");
    expect(dispatchKey(k("left"), diffPaneNoCursor).type).toBe("noop");
  });

  it("n returns next-annotation regardless of pane focus", () => {
    expect(dispatchKey(k("n"), sidebar).type).toBe("next-annotation");
    expect(dispatchKey(k("n"), diffPane).type).toBe("next-annotation");
  });

  it("p returns prev-annotation regardless of pane focus", () => {
    expect(dispatchKey(k("p"), sidebar).type).toBe("prev-annotation");
    expect(dispatchKey(k("p"), diffPane).type).toBe("prev-annotation");
  });

  it("Shift-L toggles layout regardless of pane focus (l → L rebind, ADR 0011)", () => {
    expect(dispatchKey(k("l", { shift: true }), sidebar).type).toBe("toggle-layout");
    expect(dispatchKey(k("l", { shift: true }), diffPane).type).toBe("toggle-layout");
    expect(dispatchKey(k("l", { shift: true }), sidebarFolder).type).toBe("toggle-layout");
  });

  it("plain l is no longer toggle-layout (rebound to Shift-L per ADR 0011)", () => {
    // In the diff pane, `l` becomes cursor-side-right; in the sidebar, it
    // is a no-op (no consumer). The previous "always toggle-layout"
    // behaviour is the regression we're guarding against.
    expect(dispatchKey(k("l"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("l"), sidebarFolder).type).toBe("noop");
    expect(dispatchKey(k("l"), diffPane).type).toBe("cursor-side-right");
  });

  it("Ctrl+Shift+L is not consumed as toggle-layout", () => {
    expect(dispatchKey(k("l", { ctrl: true, shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("l", { ctrl: true, shift: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+N is not consumed as next-annotation", () => {
    expect(dispatchKey(k("n", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("n", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+P is not consumed as prev-annotation", () => {
    expect(dispatchKey(k("p", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("p", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("t returns open-picker regardless of pane focus", () => {
    expect(dispatchKey(k("t"), sidebar).type).toBe("open-picker");
    expect(dispatchKey(k("t"), diffPane).type).toBe("open-picker");
    expect(dispatchKey(k("t"), sidebarFolder).type).toBe("open-picker");
  });

  it("Ctrl+T is not consumed as open-picker", () => {
    expect(dispatchKey(k("t", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("t", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("a returns open-top-level-composer regardless of pane focus", () => {
    expect(dispatchKey(k("a"), sidebar).type).toBe("open-top-level-composer");
    expect(dispatchKey(k("a"), diffPane).type).toBe("open-top-level-composer");
    expect(dispatchKey(k("a"), sidebarFolder).type).toBe("open-top-level-composer");
  });

  it("Ctrl+A is not consumed as open-top-level-composer", () => {
    expect(dispatchKey(k("a", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("a", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("r returns open-reply-composer regardless of pane focus", () => {
    expect(dispatchKey(k("r"), sidebar).type).toBe("open-reply-composer");
    expect(dispatchKey(k("r"), diffPane).type).toBe("open-reply-composer");
  });

  it("Ctrl+R is not consumed as open-reply-composer", () => {
    expect(dispatchKey(k("r", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("r", { ctrl: true }), diffPane).type).toBe("noop");
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

// ADR 0011: line cursor motion in the diff pane. j/k/up/down move the
// cursor; h/l/left/right toggle side. Sidebar focus or absent cursor
// suppresses these.
describe("dispatchKey — line cursor (ADR 0011)", () => {
  it("j and ArrowDown move the cursor down when diff pane focused and cursor exists", () => {
    expect(dispatchKey(k("j"), diffPane).type).toBe("cursor-down");
    expect(dispatchKey(k("down"), diffPane).type).toBe("cursor-down");
  });

  it("k and ArrowUp move the cursor up when diff pane focused and cursor exists", () => {
    expect(dispatchKey(k("k"), diffPane).type).toBe("cursor-up");
    expect(dispatchKey(k("up"), diffPane).type).toBe("cursor-up");
  });

  it("h and ArrowLeft set cursor side to deletions in the diff pane", () => {
    expect(dispatchKey(k("h"), diffPane).type).toBe("cursor-side-left");
    expect(dispatchKey(k("left"), diffPane).type).toBe("cursor-side-left");
  });

  it("l and ArrowRight set cursor side to additions in the diff pane", () => {
    expect(dispatchKey(k("l"), diffPane).type).toBe("cursor-side-right");
    expect(dispatchKey(k("right"), diffPane).type).toBe("cursor-side-right");
  });

  it("j/k/h/l in diff pane are no-ops when cursor doesn't exist", () => {
    expect(dispatchKey(k("j"), diffPaneNoCursor).type).toBe("noop");
    expect(dispatchKey(k("k"), diffPaneNoCursor).type).toBe("noop");
    expect(dispatchKey(k("h"), diffPaneNoCursor).type).toBe("noop");
    expect(dispatchKey(k("l"), diffPaneNoCursor).type).toBe("noop");
  });

  it("h does not interfere with sidebar focus (no sidebar binding for h)", () => {
    expect(dispatchKey(k("h"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("h"), sidebarFolder).type).toBe("noop");
  });

  it("Ctrl-j/k/h/l are not consumed as cursor motion", () => {
    expect(dispatchKey(k("j", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("k", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("h", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("l", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("sidebar j/k still drive file motion (focus-aware routing)", () => {
    expect(dispatchKey(k("j"), sidebar).type).toBe("move-file-down");
    expect(dispatchKey(k("k"), sidebar).type).toBe("move-file-up");
  });
});

// ADR 0013 / PRD #107: Enter dispatches primary-action when the cursor
// sits on an interactive row in the diff pane; Shift+Enter dispatches
// primary-action-all. Diff-row Enter is a noop (Enter is reserved for
// interactive-row actions, not an alias for `a`). Sidebar Enter retains
// select-file.
describe("dispatchKey — primary-action (PRD #107)", () => {
  it("Enter on a cursor-on-interactive row dispatches primary-action", () => {
    expect(dispatchKey(k("return"), diffPaneInteractive).type).toBe("primary-action");
  });

  it("Shift+Enter on a cursor-on-interactive row dispatches primary-action-all", () => {
    expect(dispatchKey(k("return", { shift: true }), diffPaneInteractive).type).toBe(
      "primary-action-all",
    );
  });

  it("Enter on a regular diff row dispatches noop (Enter is reserved for interactive-row actions)", () => {
    expect(dispatchKey(k("return"), diffPane).type).toBe("noop");
  });

  it("Shift+Enter on a regular diff row also dispatches noop", () => {
    expect(dispatchKey(k("return", { shift: true }), diffPane).type).toBe("noop");
  });

  it("sidebar-focused Enter retains select-file regardless of cursor-on-interactive bit", () => {
    // Even with cursorOnInteractive=true, sidebar focus wins — the
    // primary-action route is gated on `!sidebarFocused`.
    const sidebarWithInteractiveCursor = { ...sidebar, cursorOnInteractive: true };
    expect(dispatchKey(k("return"), sidebarWithInteractiveCursor).type).toBe("select-file");
  });

  it("Enter with no cursor anchored is a noop (no row to act on)", () => {
    expect(dispatchKey(k("return"), diffPaneNoCursor).type).toBe("noop");
  });

  it("Ctrl+Enter is not consumed as primary-action (modifier guard)", () => {
    expect(dispatchKey(k("return", { ctrl: true }), diffPaneInteractive).type).toBe(
      "noop",
    );
  });
});
