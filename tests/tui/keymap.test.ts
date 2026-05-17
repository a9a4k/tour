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
  cursorOnInteractive: false,
  cursorOnCard: false,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
};
const sidebarFolder: KeymapContext = {
  sidebarFocused: true,
  rowCount: 3,
  selectedRowKind: "folder",
  cursorOnInteractive: false,
  cursorOnCard: false,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
};
const diffPane: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorOnInteractive: false,
  cursorOnCard: false,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
};
const diffPaneInteractive: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorOnInteractive: true,
  cursorOnCard: false,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
};
const diffPaneOnCard: KeymapContext = {
  sidebarFocused: false,
  rowCount: 3,
  selectedRowKind: "file",
  cursorOnInteractive: false,
  cursorOnCard: true,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
};
const sidebarOnCard: KeymapContext = {
  sidebarFocused: true,
  rowCount: 3,
  selectedRowKind: "file",
  cursorOnInteractive: false,
  cursorOnCard: true,
  composerOpen: false,
  pickerOpen: false,
  deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
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

  it("Shift+C does not quit (Ctrl is the only modifier that quits on c)", () => {
    expect(dispatchKey(k("c", { shift: true }), sidebar).type).not.toBe("quit");
  });

  // PRD #343 / ADR 0031 / issue #345: Tab and Shift-Tab are hard-removed
  // from the TUI keymap on pre-1.0 semver. Esc replaces them as the
  // pane-focus toggle, with modal-unwind taking precedence (composer /
  // picker close first). Folder-row Enter dispatches toggle-folder
  // (aligns with the W3C ARIA tree-widget convention).
  it("Tab is no longer recognized (returns noop after #345)", () => {
    expect(dispatchKey(k("tab"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("tab"), diffPane).type).toBe("noop");
  });

  it("Shift+Tab is no longer recognized (returns noop after #345)", () => {
    expect(dispatchKey(k("tab", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("tab", { shift: true }), diffPane).type).toBe("noop");
  });

  it("Esc with no modal toggles pane focus (PRD #343)", () => {
    expect(dispatchKey(k("escape"), sidebar).type).toBe("pane-focus-toggle");
    expect(dispatchKey(k("escape"), sidebarFolder).type).toBe("pane-focus-toggle");
    expect(dispatchKey(k("escape"), diffPane).type).toBe("pane-focus-toggle");
    expect(dispatchKey(k("escape"), diffPaneOnCard).type).toBe("pane-focus-toggle");
  });

  it("Esc with composer open returns close-modal (modal-unwind precedence)", () => {
    expect(dispatchKey(k("escape"), { ...diffPane, composerOpen: true }).type).toBe(
      "close-modal",
    );
    expect(dispatchKey(k("escape"), { ...sidebar, composerOpen: true }).type).toBe(
      "close-modal",
    );
  });

  it("Esc with picker open returns close-modal (modal-unwind precedence)", () => {
    expect(dispatchKey(k("escape"), { ...diffPane, pickerOpen: true }).type).toBe(
      "close-modal",
    );
    expect(dispatchKey(k("escape"), { ...sidebar, pickerOpen: true }).type).toBe(
      "close-modal",
    );
  });

  it("Esc with the delete-confirm modal open returns close-modal (ADR 0036 Slice D)", () => {
    expect(
      dispatchKey(k("escape"), { ...diffPane, deleteConfirmOpen: true }).type,
    ).toBe("close-modal");
    expect(
      dispatchKey(k("escape"), { ...sidebar, deleteConfirmOpen: true }).type,
    ).toBe("close-modal");
  });

  it("Esc with both composer and picker open returns close-modal (single modal axis)", () => {
    // Defence in depth: both modals can never co-exist in production
    // (composer is suppressed while picker is open and vice versa), but
    // the keymap doesn't depend on that invariant — it simply routes
    // Esc to the modal-close action when either flag is set.
    expect(
      dispatchKey(k("escape"), { ...diffPane, composerOpen: true, pickerOpen: true }).type,
    ).toBe("close-modal");
  });

  it("Ctrl+Esc is not consumed as pane-focus-toggle (modifier guard)", () => {
    expect(dispatchKey(k("escape", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("escape", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Enter on a folder row in sidebar dispatches toggle-folder (PRD #343)", () => {
    expect(dispatchKey(k("return"), sidebarFolder).type).toBe("toggle-folder");
  });

  it("Enter on a file row in sidebar still dispatches select-file (regression guard)", () => {
    expect(dispatchKey(k("return"), sidebar).type).toBe("select-file");
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

  it("j is a no-op when sidebar has no rows", () => {
    expect(
      dispatchKey(k("j"), {
        sidebarFocused: true,
        rowCount: 0,
        selectedRowKind: null,
        cursorOnInteractive: false,
        cursorOnCard: false,
        composerOpen: false,
        pickerOpen: false,
        deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
      }).type,
    ).toBe("noop");
  });

  // Issue #337 / ADR 0029: lowercase `c` is the cursor-target comment
  // binding (formerly `a`); the prior sidebar `c` arm (toggle-folder /
  // toggle-collapse) is retired because `h`/`l` already cover those.
  // The diff-pane `c` arm (toggle-replies-collapse) moves to capital
  // `C` per ADR 0030 (lowercase = cursor-target, capital = global).
  // PRD #397 / ADR 0038: the global `Shift+C` collapse-replies verb is
  // retired in favour of per-Thread `toggle-thread-collapse`. Same
  // binding, narrower semantics — acts only on the cursored Card.
  it("c on a file row in the sidebar is a plain noop (prior toggle-collapse retired)", () => {
    expect(dispatchKey(k("c"), sidebar).type).toBe("noop");
  });

  it("c on a folder row in the sidebar is a plain noop (prior toggle-folder retired)", () => {
    expect(dispatchKey(k("c"), sidebarFolder).type).toBe("noop");
  });

  it("c in the diff pane on a row dispatches open-top-level-composer (formerly bound to `a`)", () => {
    expect(dispatchKey(k("c"), diffPane).type).toBe("open-top-level-composer");
  });

  it("c in the diff pane on a card dispatches noop-comment-on-card (card-vs-row mismatch)", () => {
    expect(dispatchKey(k("c"), diffPaneOnCard).type).toBe("noop-comment-on-card");
  });

  it("Shift+C in the diff pane dispatches toggle-all-threads-collapse (issue #406 — global toggle)", () => {
    expect(dispatchKey(k("c", { shift: true }), diffPane).type).toBe(
      "toggle-all-threads-collapse",
    );
    expect(dispatchKey(k("c", { shift: true }), diffPaneOnCard).type).toBe(
      "toggle-all-threads-collapse",
    );
  });

  it("Shift+C in the sidebar is a noop (toggle-all-threads-collapse is diff-pane only)", () => {
    expect(dispatchKey(k("c", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("c", { shift: true }), sidebarFolder).type).toBe("noop");
  });

  it("Ctrl+C outside sidebar still quits (Ctrl wins over Shift+C and bare `c`)", () => {
    expect(dispatchKey(k("c", { ctrl: true }), diffPane).type).toBe("quit");
  });

  it("c is a noop when sidebar has no rows and diff pane is also empty", () => {
    expect(
      dispatchKey(k("c"), {
        sidebarFocused: true,
        rowCount: 0,
        selectedRowKind: null,
        cursorOnInteractive: false,
        cursorOnCard: false,
        composerOpen: false,
        pickerOpen: false,
        deleteConfirmOpen: false,
  cursorOnDeletedStub: false,
      }).type,
    ).toBe("noop");
  });

  // PRD #138 / issue #139: Space / Shift+Space / `b` step a half viewport;
  // hardware PageDown / PageUp continue to step a full viewport.
  it("Space half-pages the diff pane down regardless of focus", () => {
    expect(dispatchKey(k("space"), sidebar).type).toBe("half-page-diff-down");
    expect(dispatchKey(k("space"), sidebarFolder).type).toBe("half-page-diff-down");
    expect(dispatchKey(k("space"), diffPane).type).toBe("half-page-diff-down");
  });

  it("Shift+Space half-pages the diff pane up regardless of focus", () => {
    expect(dispatchKey(k("space", { shift: true }), sidebar).type).toBe(
      "half-page-diff-up",
    );
    expect(dispatchKey(k("space", { shift: true }), sidebarFolder).type).toBe(
      "half-page-diff-up",
    );
    expect(dispatchKey(k("space", { shift: true }), diffPane).type).toBe(
      "half-page-diff-up",
    );
  });

  it("`b` half-pages the diff pane up regardless of focus", () => {
    expect(dispatchKey(k("b"), sidebar).type).toBe("half-page-diff-up");
    expect(dispatchKey(k("b"), sidebarFolder).type).toBe("half-page-diff-up");
    expect(dispatchKey(k("b"), diffPane).type).toBe("half-page-diff-up");
  });

  it("Ctrl+b is not consumed as half-page-up (modifier guard)", () => {
    expect(dispatchKey(k("b", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("b", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Shift+B (capital) is not consumed as half-page-up (modifier guard)", () => {
    expect(dispatchKey(k("b", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("b", { shift: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+Space is not consumed as page-diff", () => {
    expect(dispatchKey(k("space", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("space", { ctrl: true }), diffPane).type).toBe("noop");
  });

  // Hardware PageDown / PageUp mirror Space / Shift-Space (PRD #126, issue #129).
  it("PageDown pages the diff pane down regardless of focus", () => {
    expect(dispatchKey(k("pagedown"), sidebar).type).toBe("page-diff-down");
    expect(dispatchKey(k("pagedown"), sidebarFolder).type).toBe("page-diff-down");
    expect(dispatchKey(k("pagedown"), diffPane).type).toBe("page-diff-down");
  });

  it("PageUp pages the diff pane up regardless of focus", () => {
    expect(dispatchKey(k("pageup"), sidebar).type).toBe("page-diff-up");
    expect(dispatchKey(k("pageup"), sidebarFolder).type).toBe("page-diff-up");
    expect(dispatchKey(k("pageup"), diffPane).type).toBe("page-diff-up");
  });

  it("Shift+PageDown still pages down (direction is intrinsic to the key)", () => {
    expect(dispatchKey(k("pagedown", { shift: true }), diffPane).type).toBe("page-diff-down");
  });

  it("Shift+PageUp still pages up (direction is intrinsic to the key)", () => {
    expect(dispatchKey(k("pageup", { shift: true }), diffPane).type).toBe("page-diff-up");
  });

  it("Ctrl+PageDown / Ctrl+PageUp are not consumed", () => {
    expect(dispatchKey(k("pagedown", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("pageup", { ctrl: true }), diffPane).type).toBe("noop");
  });

  // Hardware Home / End jump the cursor to the first / last cursor-eligible
  // row in the diff stream (PRD #126, issue #130). Scoped to diff-pane
  // focus — sidebar focus suppresses them (the existing focus-routing
  // rule extended to the new keys). Direction is intrinsic, so the shift
  // modifier is ignored. Ctrl-modified is unbound.
  it("Home in the diff pane dispatches cursor-home", () => {
    expect(dispatchKey(k("home"), diffPane).type).toBe("cursor-home");
  });

  it("End in the diff pane dispatches cursor-end", () => {
    expect(dispatchKey(k("end"), diffPane).type).toBe("cursor-end");
  });

  it("Home in the sidebar is a no-op (focus-routing rule)", () => {
    expect(dispatchKey(k("home"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("home"), sidebarFolder).type).toBe("noop");
  });

  it("End in the sidebar is a no-op (focus-routing rule)", () => {
    expect(dispatchKey(k("end"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("end"), sidebarFolder).type).toBe("noop");
  });

  it("Shift+Home still dispatches cursor-home (direction is intrinsic to the key)", () => {
    expect(dispatchKey(k("home", { shift: true }), diffPane).type).toBe("cursor-home");
  });

  it("Shift+End still dispatches cursor-end (direction is intrinsic to the key)", () => {
    expect(dispatchKey(k("end", { shift: true }), diffPane).type).toBe("cursor-end");
  });

  it("Ctrl+Home / Ctrl+End are not consumed", () => {
    expect(dispatchKey(k("home", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("end", { ctrl: true }), diffPane).type).toBe("noop");
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

  // Issue #155: `h` / `l` are vim-style aliases for the left / right arrows
  // in the sidebar tree view. All existing arrow-key semantics (folder vs
  // file row kinds, expand-folder, collapse-folder, collapse-parent) are
  // preserved unchanged; the diff-pane bindings of `h` / `l` to
  // cursor-side-left / cursor-side-right remain gated on `!sidebarFocused`.
  it("l on a folder row expands the folder (vim alias for right arrow)", () => {
    expect(dispatchKey(k("l"), sidebarFolder).type).toBe("expand-folder");
  });

  it("h on a folder row collapses the folder (vim alias for left arrow)", () => {
    expect(dispatchKey(k("h"), sidebarFolder).type).toBe("collapse-folder");
  });

  it("h on a file row collapses its parent folder (vim alias for left arrow)", () => {
    expect(dispatchKey(k("h"), sidebar).type).toBe("collapse-parent");
  });

  it("l on a file row in sidebar is a no-op (matches right-arrow on files)", () => {
    expect(dispatchKey(k("l"), sidebar).type).toBe("noop");
  });

  it("right and left in the diff pane drive cursor side selection (not noop)", () => {
    // Lazy materialization (ADR 0011 Revisions): the keymap dispatches
    // motion actions unconditionally — the App's handler promotes a
    // null cursor into the seeded state on first interaction.
    expect(dispatchKey(k("right"), diffPane).type).toBe("cursor-side-right");
    expect(dispatchKey(k("left"), diffPane).type).toBe("cursor-side-left");
  });

  it("n returns next-comment regardless of pane focus", () => {
    expect(dispatchKey(k("n"), sidebar).type).toBe("next-comment");
    expect(dispatchKey(k("n"), diffPane).type).toBe("next-comment");
  });

  it("p returns prev-comment regardless of pane focus", () => {
    expect(dispatchKey(k("p"), sidebar).type).toBe("prev-comment");
    expect(dispatchKey(k("p"), diffPane).type).toBe("prev-comment");
  });

  it("Shift-L toggles layout regardless of pane focus (l → L rebind, ADR 0011)", () => {
    expect(dispatchKey(k("l", { shift: true }), sidebar).type).toBe("toggle-layout");
    expect(dispatchKey(k("l", { shift: true }), diffPane).type).toBe("toggle-layout");
    expect(dispatchKey(k("l", { shift: true }), sidebarFolder).type).toBe("toggle-layout");
  });

  it("plain l is no longer toggle-layout (rebound to Shift-L per ADR 0011)", () => {
    // In the diff pane, `l` becomes cursor-side-right; in the sidebar, it
    // expands the folder on folder rows (issue #155 vim alias) and is a
    // no-op on file rows (mirrors right-arrow behaviour). The previous
    // "always toggle-layout" behaviour is the regression we're guarding
    // against.
    expect(dispatchKey(k("l"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("l"), sidebarFolder).type).toBe("expand-folder");
    expect(dispatchKey(k("l"), diffPane).type).toBe("cursor-side-right");
  });

  it("Ctrl+Shift+L is not consumed as toggle-layout", () => {
    expect(dispatchKey(k("l", { ctrl: true, shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("l", { ctrl: true, shift: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+N is not consumed as next-comment", () => {
    expect(dispatchKey(k("n", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("n", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+P is not consumed as prev-comment", () => {
    expect(dispatchKey(k("p", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("p", { ctrl: true }), diffPane).type).toBe("noop");
  });

  // Issue #337 / ADR 0030: open-picker moved from bare `t` to Shift+T
  // (capital = Tour-wide state). Bare `t` is a plain noop after the
  // cutover — no alias, no footer status.
  it("Shift+T returns open-picker regardless of pane focus (ADR 0030)", () => {
    expect(dispatchKey(k("t", { shift: true }), sidebar).type).toBe("open-picker");
    expect(dispatchKey(k("t", { shift: true }), diffPane).type).toBe("open-picker");
    expect(dispatchKey(k("t", { shift: true }), sidebarFolder).type).toBe("open-picker");
  });

  it("bare t is a plain noop after the t → T cutover (issue #337)", () => {
    expect(dispatchKey(k("t"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("t"), diffPane).type).toBe("noop");
    expect(dispatchKey(k("t"), sidebarFolder).type).toBe("noop");
    expect(dispatchKey(k("t"), diffPaneOnCard).type).toBe("noop");
  });

  // Issue #297: per-file Expand-all keyboard binding. Mirrors the
  // file-header's `↕` mouse affordance — both end on
  // `expansion.expandFileAll(cursor.file)`. Available in both panes so
  // the user can fire it from the sidebar (cursor on a file row) or
  // the diff pane (cursor on any row inside the file).
  it("e dispatches expand-file-all regardless of pane focus", () => {
    expect(dispatchKey(k("e"), sidebar).type).toBe("expand-file-all");
    expect(dispatchKey(k("e"), diffPane).type).toBe("expand-file-all");
    expect(dispatchKey(k("e"), sidebarFolder).type).toBe("expand-file-all");
  });

  it("Ctrl+E is not consumed as expand-file-all", () => {
    expect(dispatchKey(k("e", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("e", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Shift+E is not consumed as expand-file-all", () => {
    expect(dispatchKey(k("e", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("e", { shift: true }), diffPane).type).toBe("noop");
  });

  // Issue #326 / PRD #356 / issue #357: `y` dispatches `yank-at-cursor`
  // in both panes; the App-side handler routes on the resolver's
  // `YankTarget` kind (line text on a diff row, file path on a card /
  // interactive row / sidebar file row, none on degenerate states).
  it("y dispatches yank-at-cursor regardless of pane focus", () => {
    expect(dispatchKey(k("y"), sidebar).type).toBe("yank-at-cursor");
    expect(dispatchKey(k("y"), diffPane).type).toBe("yank-at-cursor");
    expect(dispatchKey(k("y"), sidebarFolder).type).toBe("yank-at-cursor");
    expect(dispatchKey(k("y"), diffPaneOnCard).type).toBe("yank-at-cursor");
    expect(dispatchKey(k("y"), sidebarOnCard).type).toBe("yank-at-cursor");
  });

  it("Ctrl+Y is not consumed as yank-at-cursor (modifier guard)", () => {
    expect(dispatchKey(k("y", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("y", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Shift+Y is not consumed as yank-at-cursor (uppercase reserved for variant; not in scope)", () => {
    expect(dispatchKey(k("y", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("y", { shift: true }), diffPane).type).toBe("noop");
  });

  // PRD #349 / ADR 0032 / issue #352: `o` opens the cursor's file at
  // its line in the configured editor. Available in both panes
  // (resolution layer surfaces null-cursor / folder hints via the
  // footer); modifier combinations are guarded.
  it("o dispatches open-in-editor regardless of pane focus", () => {
    expect(dispatchKey(k("o"), sidebar).type).toBe("open-in-editor");
    expect(dispatchKey(k("o"), diffPane).type).toBe("open-in-editor");
    expect(dispatchKey(k("o"), sidebarFolder).type).toBe("open-in-editor");
    expect(dispatchKey(k("o"), diffPaneOnCard).type).toBe("open-in-editor");
    expect(dispatchKey(k("o"), sidebarOnCard).type).toBe("open-in-editor");
  });

  it("Ctrl+O is not consumed as open-in-editor (modifier guard)", () => {
    expect(dispatchKey(k("o", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("o", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Shift+O is not consumed as open-in-editor (uppercase reserved per ADR 0030)", () => {
    expect(dispatchKey(k("o", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("o", { shift: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+T is not consumed as open-picker", () => {
    expect(dispatchKey(k("t", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("t", { ctrl: true }), diffPane).type).toBe("noop");
  });

  it("Ctrl+Shift+T is not consumed as open-picker (modifier guard)", () => {
    expect(dispatchKey(k("t", { ctrl: true, shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("t", { ctrl: true, shift: true }), diffPane).type).toBe("noop");
  });

  // Issue #337 / ADR 0029: bare `a` is unbound after the a → c cutover.
  // The comment-composer binding moves to lowercase `c`; bare `a` returns
  // a plain noop with no footer status — hard cutover, no alias.
  it("bare a is a plain noop after the a → c cutover (issue #337)", () => {
    expect(dispatchKey(k("a"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("a"), diffPane).type).toBe("noop");
    expect(dispatchKey(k("a"), sidebarFolder).type).toBe("noop");
    expect(dispatchKey(k("a"), diffPaneOnCard).type).toBe("noop");
    expect(dispatchKey(k("a"), sidebarOnCard).type).toBe("noop");
  });

  it("Ctrl+A / Shift+A do not fire any action (modifier-free binding was retired)", () => {
    expect(dispatchKey(k("a", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("a", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("a", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("a", { shift: true }), diffPane).type).toBe("noop");
  });

  it("r returns open-reply-composer when the cursor is on a card (PRD #192)", () => {
    expect(dispatchKey(k("r"), sidebarOnCard).type).toBe("open-reply-composer");
    expect(dispatchKey(k("r"), diffPaneOnCard).type).toBe("open-reply-composer");
  });

  it("r on a row returns noop-reply-on-row (PRD #192 — labelled no-op via footer)", () => {
    expect(dispatchKey(k("r"), sidebar).type).toBe("noop-reply-on-row");
    expect(dispatchKey(k("r"), diffPane).type).toBe("noop-reply-on-row");
  });

  it("Ctrl+R is not consumed as open-reply-composer", () => {
    expect(dispatchKey(k("r", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("r", { ctrl: true }), diffPane).type).toBe("noop");
  });

  // Issue #390 / ADR 0021 addendum: the request-reply verb moved from
  // bare `s` to `R` (shift-r) — same letter as `r: reply`, case-shifted
  // to mark "different actor" (the reply-agent runs the dispatch in a
  // separate session). Action type stays `send-to-agent` so the
  // reducer / runtime contracts are unchanged.
  it("Shift+R returns send-to-agent when cursor is on a card (issue #390, PRD #181 + #192)", () => {
    expect(dispatchKey(k("r", { shift: true }), sidebarOnCard).type).toBe(
      "send-to-agent",
    );
    expect(dispatchKey(k("r", { shift: true }), diffPaneOnCard).type).toBe(
      "send-to-agent",
    );
  });

  it("Shift+R on a row returns noop-send-on-row (PRD #192 — card-only action)", () => {
    expect(dispatchKey(k("r", { shift: true }), sidebar).type).toBe(
      "noop-send-on-row",
    );
    expect(dispatchKey(k("r", { shift: true }), diffPane).type).toBe(
      "noop-send-on-row",
    );
  });

  // Issue #390: bare `s` is no longer bound to the request-reply verb.
  // It falls through to the default noop so no surprise dispatch happens.
  it("bare s is unbound (issue #390 — request-reply moved to Shift+R)", () => {
    expect(dispatchKey(k("s"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("s"), sidebarOnCard).type).toBe("noop");
    expect(dispatchKey(k("s"), diffPane).type).toBe("noop");
    expect(dispatchKey(k("s"), diffPaneOnCard).type).toBe("noop");
  });

  // ADR 0036 Slice D / issue #388: `d` opens the delete-confirm modal on
  // the cursored Comment. Card-only in the diff pane; off-card / sidebar
  // surfaces a labelled no-op, mirroring `r` / `R`. Reply-level cursor
  // stops (ADR 0037) let this verb target parents and Replies uniformly.
  it("d in the diff pane on a card opens the delete-confirm modal", () => {
    expect(dispatchKey(k("d"), diffPaneOnCard).type).toBe("open-delete-confirm");
  });

  it("d in the diff pane on a row returns noop-delete-on-row", () => {
    expect(dispatchKey(k("d"), diffPane).type).toBe("noop-delete-on-row");
  });

  it("d on a `[deleted]` stub returns noop-delete-on-stub (the write seam refuses already-deleted targets)", () => {
    const stub: KeymapContext = { ...diffPaneOnCard, cursorOnDeletedStub: true };
    expect(dispatchKey(k("d"), stub).type).toBe("noop-delete-on-stub");
  });

  it("d in the sidebar is a plain noop (no Comment cursor in the sidebar)", () => {
    expect(dispatchKey(k("d"), sidebar).type).toBe("noop");
    expect(dispatchKey(k("d"), sidebarFolder).type).toBe("noop");
    expect(dispatchKey(k("d"), sidebarOnCard).type).toBe("noop");
  });

  it("Ctrl+D / Shift+D do not fire open-delete-confirm (modifier-free binding only)", () => {
    expect(dispatchKey(k("d", { ctrl: true }), diffPaneOnCard).type).toBe("noop");
    expect(dispatchKey(k("d", { shift: true }), diffPaneOnCard).type).toBe("noop");
    expect(dispatchKey(k("d", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("d", { shift: true }), diffPane).type).toBe("noop");
  });

  // Issue #337 / ADR 0029: the row-only labelled-noop now lives on `c`,
  // not `a` (bare `a` is unbound). `c` is scoped to the diff pane —
  // sidebar+card → plain noop (the cursor lives in the diff pane, but
  // the user has Tab-focused the sidebar; the row-only contract no
  // longer fires under sidebar focus).
  it("c on a card in the diff pane returns noop-comment-on-card (PRD #192 — row-only)", () => {
    expect(dispatchKey(k("c"), diffPaneOnCard).type).toBe("noop-comment-on-card");
  });

  it("c on a card while sidebar is focused is a plain noop (sidebar `c` is unbound)", () => {
    expect(dispatchKey(k("c"), sidebarOnCard).type).toBe("noop");
  });

  it("Ctrl+R / Ctrl+S / Shift+S do not fire send-to-agent (issue #390 — only Shift+R fires)", () => {
    // Ctrl-decorated Shift+R is not the request-reply gesture.
    expect(dispatchKey(k("r", { ctrl: true, shift: true }), diffPaneOnCard).type).toBe(
      "noop",
    );
    expect(dispatchKey(k("r", { ctrl: true, shift: true }), sidebar).type).toBe(
      "noop",
    );
    // Bare `s` and modifier-decorated `s` are all unbound for the
    // request-reply action after the issue #390 rebind.
    expect(dispatchKey(k("s", { ctrl: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("s", { shift: true }), sidebar).type).toBe("noop");
    expect(dispatchKey(k("s", { ctrl: true }), diffPane).type).toBe("noop");
    expect(dispatchKey(k("s", { shift: true }), diffPane).type).toBe("noop");
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
// cursor; h/l/left/right toggle side. Sidebar focus suppresses these;
// per ADR 0011 Revisions, motion fires unconditionally in the diff
// pane and the App's handler lazily materializes a null cursor.
describe("dispatchKey — line cursor (ADR 0011)", () => {
  it("j and ArrowDown move the cursor down when diff pane focused", () => {
    expect(dispatchKey(k("j"), diffPane).type).toBe("cursor-down");
    expect(dispatchKey(k("down"), diffPane).type).toBe("cursor-down");
  });

  it("k and ArrowUp move the cursor up when diff pane focused", () => {
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

  it("h in the sidebar drives tree collapse (vim alias for left arrow, issue #155)", () => {
    expect(dispatchKey(k("h"), sidebar).type).toBe("collapse-parent");
    expect(dispatchKey(k("h"), sidebarFolder).type).toBe("collapse-folder");
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

// ADR 0013 / PRD #107 / ADR 0025: Enter dispatches primary-action when
// the cursor sits on an interactive row in the diff pane. The Shift
// modifier carries no special meaning (PRD #270 Slice 5 / issue #275 —
// the per-file Expand-all chrome button is the whole-file escape
// hatch); Shift+Enter behaves identically to plain Enter.
//
// Issue #406 / ADR 0038 amended: Enter on a Card cursor dispatches
// `toggle-thread-collapse` (the per-Thread gesture moved from `Shift+C`
// to `Enter`). Diff-row Enter is still a noop. Sidebar Enter retains
// its select-file / toggle-folder routing.
describe("dispatchKey — Enter routing (PRD #107 / issue #406)", () => {
  it("Enter on a cursor-on-interactive row dispatches primary-action", () => {
    expect(dispatchKey(k("return"), diffPaneInteractive).type).toBe("primary-action");
  });

  it("Shift+Enter on a cursor-on-interactive row dispatches primary-action (Shift carries no special meaning per issue #275)", () => {
    expect(dispatchKey(k("return", { shift: true }), diffPaneInteractive).type).toBe(
      "primary-action",
    );
  });

  it("Enter on a Card cursor dispatches toggle-thread-collapse (issue #406 — moved from Shift+C)", () => {
    expect(dispatchKey(k("return"), diffPaneOnCard).type).toBe(
      "toggle-thread-collapse",
    );
  });

  it("Shift+Enter on a Card cursor also dispatches toggle-thread-collapse (Shift carries no special meaning)", () => {
    expect(dispatchKey(k("return", { shift: true }), diffPaneOnCard).type).toBe(
      "toggle-thread-collapse",
    );
  });

  it("Enter on a regular diff row dispatches noop (Enter is reserved for interactive-row / Card actions)", () => {
    expect(dispatchKey(k("return"), diffPane).type).toBe("noop");
  });

  it("Shift+Enter on a regular diff row also dispatches noop", () => {
    expect(dispatchKey(k("return", { shift: true }), diffPane).type).toBe("noop");
  });

  it("sidebar-focused Enter retains select-file regardless of cursor-on-interactive / cursor-on-card bits", () => {
    // Even with cursorOnInteractive=true or cursorOnCard=true, sidebar
    // focus wins — the diff-pane Enter route is gated on
    // `!sidebarFocused`.
    const sidebarWithInteractiveCursor = { ...sidebar, cursorOnInteractive: true };
    expect(dispatchKey(k("return"), sidebarWithInteractiveCursor).type).toBe("select-file");
    expect(dispatchKey(k("return"), sidebarOnCard).type).toBe("select-file");
  });

  it("Ctrl+Enter is not consumed as primary-action / toggle-thread-collapse (modifier guard)", () => {
    expect(dispatchKey(k("return", { ctrl: true }), diffPaneInteractive).type).toBe(
      "noop",
    );
    expect(dispatchKey(k("return", { ctrl: true }), diffPaneOnCard).type).toBe(
      "noop",
    );
  });
});
