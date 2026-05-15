export interface KeyInput {
  name: string;
  ctrl: boolean;
  shift: boolean;
}

export interface KeymapContext {
  sidebarFocused: boolean;
  rowCount: number;
  selectedRowKind: "folder" | "file" | null;
  /** Whether the cursor sits on an interactive row (hunk-separator, file
   *  boundary, collapsed-file). Only when this is true does Enter
   *  dispatch primary-action in the diff pane (PRD #107). On a regular
   *  diff row Enter is a noop. */
  cursorOnInteractive: boolean;
  /** Whether the cursor sits on a Comment card (PRD #192 / ADR 0022).
   *  Routes the row-kind-aware dispatch: `r` and `s` fire only when this
   *  is true; `c` fires only when this is false (and the cursor isn't on
   *  an interactive row either). On a card / row mismatch the action is
   *  a labelled no-op the App shell surfaces via the footer hint. */
  cursorOnCard: boolean;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "toggle-pane" }
  | { type: "focus-sidebar" }
  | { type: "move-file-down" }
  | { type: "move-file-up" }
  | { type: "select-file" }
  | { type: "expand-folder" }
  | { type: "collapse-folder" }
  | { type: "collapse-parent" }
  | { type: "toggle-replies-collapse" }
  | { type: "next-comment" }
  | { type: "prev-comment" }
  | { type: "toggle-layout" }
  | { type: "open-picker" }
  | { type: "open-top-level-composer" }
  | { type: "open-reply-composer" }
  | { type: "send-to-agent" }
  | { type: "page-diff-down" }
  | { type: "page-diff-up" }
  | { type: "half-page-diff-down" }
  | { type: "half-page-diff-up" }
  | { type: "cursor-down" }
  | { type: "cursor-up" }
  | { type: "cursor-home" }
  | { type: "cursor-end" }
  | { type: "cursor-side-left" }
  | { type: "cursor-side-right" }
  | { type: "primary-action" }
  | { type: "expand-file-all" }
  | { type: "yank-file-path" }
  | { type: "noop" }
  | { type: "noop-reply-on-row" }
  | { type: "noop-send-on-row" }
  | { type: "noop-comment-on-card" };

export function dispatchKey(key: KeyInput, ctx: KeymapContext): KeyAction {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { type: "quit" };
  }

  if (key.name === "tab") {
    return key.shift ? { type: "focus-sidebar" } : { type: "toggle-pane" };
  }

  // Half-page paging on Space / Shift+Space / `b` (PRD #138, issue #139).
  if (!key.ctrl && key.name === "space") {
    return key.shift ? { type: "half-page-diff-up" } : { type: "half-page-diff-down" };
  }
  if (!key.ctrl && !key.shift && key.name === "b") {
    return { type: "half-page-diff-up" };
  }

  // Hardware PageDown / PageUp stay at full-viewport step (PRD #138).
  if (!key.ctrl && key.name === "pagedown") return { type: "page-diff-down" };
  if (!key.ctrl && key.name === "pageup") return { type: "page-diff-up" };

  // Hardware Home / End jump the cursor to the first / last cursor-eligible
  // row in the diff stream (PRD #126, issue #130). Scoped to diff-pane
  // focus — sidebar focus suppresses them.
  if (!ctx.sidebarFocused && !key.ctrl && key.name === "home") {
    return { type: "cursor-home" };
  }
  if (!ctx.sidebarFocused && !key.ctrl && key.name === "end") {
    return { type: "cursor-end" };
  }

  // Capital-letter bindings are reserved for Tour-wide state (ADR 0030):
  // `L` toggles layout (ADR 0011), `T` opens the picker, `C` toggles the
  // replies-collapse across every Thread. Lowercase letters bind cursor-
  // target actions on the same axis (e.g. `c` for comment, `t` is unbound).
  if (!key.ctrl && key.shift && key.name === "l") {
    return { type: "toggle-layout" };
  }
  if (!key.ctrl && key.shift && key.name === "t") {
    return { type: "open-picker" };
  }
  if (!ctx.sidebarFocused && !key.ctrl && key.shift && key.name === "c") {
    return { type: "toggle-replies-collapse" };
  }

  if (!key.ctrl && !key.shift) {
    if (key.name === "n") return { type: "next-comment" };
    if (key.name === "p") return { type: "prev-comment" };
    // Issue #297: `e` dispatches per-file Expand-all on the cursored
    // file. The keyboard path mirrors the file-header's `↕` mouse
    // affordance — both end on `expansion.expandFileAll(cursor.file)`.
    // Available in both panes so the user can fire it from either the
    // sidebar (cursor anchored on a file row) or the diff pane (cursor
    // anchored on any row inside the file). When no file is in scope
    // (empty tour, null cursor + sidebar focused on a folder), the
    // App-side handler is a labelled no-op.
    if (key.name === "e") return { type: "expand-file-all" };
    // Issue #326: `y` yanks the focused file's repo-relative path to the
    // system clipboard via OSC 52. Available in both panes — diff-pane
    // resolves the file from the cursor, sidebar from the selection.
    // The App-side handler is a labelled no-op when no file is in scope
    // (sidebar parked on a folder, null cursor on a degenerate state).
    if (key.name === "y") return { type: "yank-file-path" };
    // Row-kind-aware action dispatch (PRD #192 / ADR 0022). The unified
    // cursor routes action keys by row kind: `c` (issue #337, ADR 0029)
    // is a row-only action, `r` and `s` are card-only actions. Mismatches
    // map to labelled no-ops the App shell surfaces via the footer hint —
    // silent vs. wrong-target trade-off resolved by saying so. `c` is
    // scoped to the diff pane: sidebar `c` is a plain noop (its prior
    // toggle-folder/toggle-collapse binding is retired; `h`/`l` cover
    // those operations per issue #337).
    if (!ctx.sidebarFocused && key.name === "c") {
      if (ctx.cursorOnCard) return { type: "noop-comment-on-card" };
      return { type: "open-top-level-composer" };
    }
    if (key.name === "r") {
      if (!ctx.cursorOnCard) return { type: "noop-reply-on-row" };
      return { type: "open-reply-composer" };
    }
    if (key.name === "s") {
      if (!ctx.cursorOnCard) return { type: "noop-send-on-row" };
      return { type: "send-to-agent" };
    }
  }

  // Diff-pane Enter (ADR 0013 / ADR 0025): only fires when the cursor
  // sits on an interactive row. The Shift modifier carries no special
  // meaning — per PRD #270 Slice 5 the per-file Expand-all button is
  // the whole-file escape hatch; Shift+Enter behaves identically to
  // plain Enter.
  if (
    !ctx.sidebarFocused &&
    !key.ctrl &&
    ctx.cursorOnInteractive &&
    key.name === "return"
  ) {
    return { type: "primary-action" };
  }

  if (ctx.sidebarFocused && ctx.rowCount > 0) {
    if (key.name === "j" || key.name === "down") return { type: "move-file-down" };
    if (key.name === "k" || key.name === "up") return { type: "move-file-up" };
    if (key.name === "return") return { type: "select-file" };
    if ((key.name === "right" || key.name === "l") && ctx.selectedRowKind === "folder") {
      return { type: "expand-folder" };
    }
    if (key.name === "left" || key.name === "h") {
      if (ctx.selectedRowKind === "folder") return { type: "collapse-folder" };
      if (ctx.selectedRowKind === "file") return { type: "collapse-parent" };
    }
  }

  // Diff-pane line cursor (ADR 0011 + ADR 0011 Revisions).
  if (!ctx.sidebarFocused && !key.ctrl && !key.shift) {
    if (key.name === "j" || key.name === "down") return { type: "cursor-down" };
    if (key.name === "k" || key.name === "up") return { type: "cursor-up" };
    if (key.name === "h" || key.name === "left") return { type: "cursor-side-left" };
    if (key.name === "l" || key.name === "right") return { type: "cursor-side-right" };
  }

  return { type: "noop" };
}
