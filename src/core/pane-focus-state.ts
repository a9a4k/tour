// Cross-surface pane-focus slice (PRD #343 / ADR 0031). Routes keyboard
// input between the sidebar tree and the diff pane on both surfaces.
// Sibling to `cursor` in core/tour-session.ts; the reducer there embeds
// this slice's three actions (`paneFocus.setSidebar`, `paneFocus.setDiff`,
// `paneFocus.toggle`).
//
// This module is pure-data: no React, no DOM, no store imports. The
// reducer transitions, the auto-flip predicate, and the seed-effect
// helper are testable without spinning up a surface — issue #344's slice
// 1 is the foundation that slices 2/3 (TUI keymap rewire + webapp
// adapter) cash in.

export type PaneFocus = "sidebar" | "diff";

export type PaneFocusAction =
  | { type: "paneFocus.setSidebar" }
  | { type: "paneFocus.setDiff" }
  | { type: "paneFocus.toggle" };

export function reducePaneFocus(state: PaneFocus, action: PaneFocusAction): PaneFocus {
  switch (action.type) {
    case "paneFocus.setSidebar":
      return "sidebar";
    case "paneFocus.setDiff":
      return "diff";
    case "paneFocus.toggle":
      return state === "sidebar" ? "diff" : "sidebar";
  }
}

// Auto-flip predicate: maps action kinds to the pane they target. The
// surfaces consult this on every keymap dispatch to decide whether to
// also issue a `paneFocus.set*` action alongside the action's primary
// effect. The kinds are named after their conceptual gesture, not after
// a specific keystroke — `comment-jump` covers both `n`/`p` on either
// surface; `click-diff` covers diff-row clicks and card clicks; etc.
//
// Locked from PRD #343's auto-flip matrix:
//
//   comment-jump | click-diff | select-file   → diff
//   click-sidebar                              → sidebar
//   open-picker | toggle-layout | expand-file-all | yank-file-path | quit
//     | toggle-folder | expand-folder | collapse-folder | collapse-parent
//     | move-file-up | move-file-down
//     | cursor-up | cursor-down | cursor-side-left | cursor-side-right
//                                              → null (no flip)
//
// Returning `null` means "no flip needed" — either the action is
// pane-agnostic / pane-internal, or the current pane already matches the
// action's target so no `paneFocus.set*` is needed.
export type AutoFlipActionKind =
  // Cascades that flip paneFocus to diff
  | "comment-jump"
  | "click-diff"
  | "select-file"
  // Cascades that flip paneFocus to sidebar
  | "click-sidebar"
  // Pane-agnostic
  | "open-picker"
  | "toggle-layout"
  | "expand-file-all"
  | "yank-file-path"
  | "quit"
  // Sidebar-internal
  | "toggle-folder"
  | "expand-folder"
  | "collapse-folder"
  | "collapse-parent"
  | "move-file-up"
  | "move-file-down"
  // Cursor motion in diff
  | "cursor-up"
  | "cursor-down"
  | "cursor-side-left"
  | "cursor-side-right";

export function autoFlipPaneFocus(
  kind: AutoFlipActionKind,
  current: PaneFocus,
): PaneFocus | null {
  switch (kind) {
    case "comment-jump":
    case "click-diff":
    case "select-file":
      return current === "diff" ? null : "diff";
    case "click-sidebar":
      return current === "sidebar" ? null : "sidebar";
    default:
      return null;
  }
}

// Seed-effect conditional driven by the existing TUI rule
// (src/tui/app.tsx:568-584): Tour with Comments → diff (cursor seeds at
// first Comment via initialCursor); Tour with no Comments → sidebar
// (cursor stays null; sidebar lands at the first file row). Surfaces
// dispatch the matching `paneFocus.set*` action alongside their existing
// cursor seed on `bundle.tour.id` change.
export function seedPaneFocus(hasTopLevelComments: boolean): PaneFocus {
  return hasTopLevelComments ? "diff" : "sidebar";
}
