export interface KeyInput {
  name: string;
  ctrl: boolean;
  shift: boolean;
}

export interface KeymapContext {
  sidebarFocused: boolean;
  rowCount: number;
  selectedRowKind: "folder" | "file" | null;
  /** Whether the line cursor sits on an interactive row (hunk-separator,
   *  file boundary, collapsed-file indicator). Only when this is true do
   *  Enter / Shift+Enter dispatch primary-action / primary-action-all in
   *  the diff pane (PRD #107). On a regular diff row Enter is a noop. */
  cursorOnInteractive: boolean;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "toggle-pane" }
  | { type: "focus-sidebar" }
  | { type: "move-file-down" }
  | { type: "move-file-up" }
  | { type: "select-file" }
  | { type: "toggle-collapse" }
  | { type: "toggle-folder" }
  | { type: "expand-folder" }
  | { type: "collapse-folder" }
  | { type: "collapse-parent" }
  | { type: "toggle-replies-collapse" }
  | { type: "next-annotation" }
  | { type: "prev-annotation" }
  | { type: "toggle-layout" }
  | { type: "open-picker" }
  | { type: "open-top-level-composer" }
  | { type: "open-reply-composer" }
  | { type: "page-diff-down" }
  | { type: "page-diff-up" }
  | { type: "cursor-down" }
  | { type: "cursor-up" }
  | { type: "cursor-side-left" }
  | { type: "cursor-side-right" }
  | { type: "primary-action" }
  | { type: "primary-action-all" }
  | { type: "noop" };

export function dispatchKey(key: KeyInput, ctx: KeymapContext): KeyAction {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { type: "quit" };
  }

  if (key.name === "tab") {
    return key.shift ? { type: "focus-sidebar" } : { type: "toggle-pane" };
  }

  if (!key.ctrl && key.name === "space") {
    return key.shift ? { type: "page-diff-up" } : { type: "page-diff-down" };
  }

  // Layout toggle moved from `l` to Shift-L (ADR 0011): the lowercase pair
  // `h`/`l` is now reserved for cursor side selection in the diff pane.
  if (!key.ctrl && key.shift && key.name === "l") {
    return { type: "toggle-layout" };
  }

  if (!key.ctrl && !key.shift) {
    if (key.name === "n") return { type: "next-annotation" };
    if (key.name === "p") return { type: "prev-annotation" };
    if (key.name === "t") return { type: "open-picker" };
    if (key.name === "a") return { type: "open-top-level-composer" };
    if (key.name === "r") return { type: "open-reply-composer" };
  }

  // Diff-pane Enter / Shift+Enter (ADR 0013): only fires when the cursor
  // sits on an interactive row (hunk-separator, file boundary, collapsed-
  // file indicator). On a regular diff row Enter is a noop — `Enter` is
  // reserved for interactive-row actions, not an alias for `a`. The
  // sidebar-focused `Enter` route below still wins (see below).
  if (
    !ctx.sidebarFocused &&
    !key.ctrl &&
    ctx.cursorOnInteractive &&
    key.name === "return"
  ) {
    return key.shift ? { type: "primary-action-all" } : { type: "primary-action" };
  }

  if (ctx.sidebarFocused && ctx.rowCount > 0) {
    if (key.name === "j" || key.name === "down") return { type: "move-file-down" };
    if (key.name === "k" || key.name === "up") return { type: "move-file-up" };
    if (key.name === "return") return { type: "select-file" };
    if (!key.ctrl && !key.shift && key.name === "c") {
      if (ctx.selectedRowKind === "folder") return { type: "toggle-folder" };
      if (ctx.selectedRowKind === "file") return { type: "toggle-collapse" };
    }
    if (key.name === "right" && ctx.selectedRowKind === "folder") {
      return { type: "expand-folder" };
    }
    if (key.name === "left") {
      if (ctx.selectedRowKind === "folder") return { type: "collapse-folder" };
      if (ctx.selectedRowKind === "file") return { type: "collapse-parent" };
    }
  }

  // Diff-pane line cursor (ADR 0011 + ADR 0011 Revisions). Fires whenever
  // the diff pane has focus — even when no cursor is materialized, since
  // first interaction promotes a null cursor into the seeded state via
  // the App's handler (lazy materialization, ADR 0012-aligned). h/l also
  // handle side toggle on paired rows; setCursorSide is layout-aware and
  // degrades to a preferredSide-only update on single-side rows.
  if (!ctx.sidebarFocused && !key.ctrl && !key.shift) {
    if (key.name === "j" || key.name === "down") return { type: "cursor-down" };
    if (key.name === "k" || key.name === "up") return { type: "cursor-up" };
    if (key.name === "h" || key.name === "left") return { type: "cursor-side-left" };
    if (key.name === "l" || key.name === "right") return { type: "cursor-side-right" };
  }

  // Outside the sidebar, `c` collapses just the Replies in every Thread —
  // the parent Annotation stays visible. Whole-Thread collapse is reachable
  // via the existing sidebar file-level collapse.
  if (!ctx.sidebarFocused && !key.ctrl && !key.shift && key.name === "c") {
    return { type: "toggle-replies-collapse" };
  }

  return { type: "noop" };
}
