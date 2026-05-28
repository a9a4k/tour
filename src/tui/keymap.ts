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
   *  Routes the row-kind-aware dispatch: `r` and `s` fire only when this is true; `c` fires
   *  only when this is false (and the cursor isn't on an interactive
   *  row either). On a card / row mismatch the action is a labelled
   *  no-op the App shell surfaces via the footer hint. */
  cursorOnCard: boolean;
  /** Whether the cursor sits on a `[deleted]` stub (ADR 0036's C4
   *  cascade: a deleted parent kept in the projection because ≥1 reply
   *  survives). Routes `d` on a stub to a labelled no-op instead of
   *  opening the delete-confirm modal — the `createDelete` seam would
   *  reject the write at submit time, so refusing earlier is the cleaner
   *  UX. Reply-level cursor stops (ADR 0037) never sit on a stub
   *  themselves — deleted leaf replies are filtered from the projection
   *  by the fold — so this flag is only ever true on a parent stub. */
  cursorOnDeletedStub: boolean;
  /** Whether the comment composer is open (any non-closed kind). Routes
   *  Esc to `close-modal` instead of `pane-focus-toggle` per the
   *  modal-unwind precedence rule (PRD #343 / ADR 0031). */
  composerOpen: boolean;
  /** Whether the Tour picker is open. Same modal-unwind precedence as
   *  `composerOpen`. */
  pickerOpen: boolean;
  /** Whether the delete-confirm modal is open (ADR 0036 Slice D / issue
   *  #388). Same modal-unwind precedence as `composerOpen`. */
  deleteConfirmOpen: boolean;
  sidebarVisible: boolean;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "pane-focus-toggle" }
  | { type: "show-sidebar-and-focus" }
  | { type: "toggle-sidebar-visibility" }
  | { type: "close-modal" }
  | { type: "move-file-down" }
  | { type: "move-file-up" }
  | { type: "select-file" }
  | { type: "toggle-folder" }
  | { type: "expand-folder" }
  | { type: "collapse-folder" }
  | { type: "collapse-parent" }
  | { type: "toggle-thread-collapse" }
  | { type: "toggle-all-threads-collapse" }
  | { type: "next-comment" }
  | { type: "prev-comment" }
  | { type: "toggle-layout" }
  | { type: "open-picker" }
  | { type: "open-top-level-composer" }
  | { type: "open-reply-composer" }
  | { type: "open-edit-composer" }
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
  | { type: "yank-at-cursor" }
  | { type: "open-in-editor" }
  | { type: "open-delete-confirm" }
  | { type: "noop" }
  | { type: "noop-reply-on-row" }
  | { type: "noop-send-on-row" }
  | { type: "noop-comment-on-card" }
  | { type: "noop-delete-on-row" }
  | { type: "noop-delete-on-stub" }
  | { type: "noop-edit-on-stub" };

export function dispatchKey(key: KeyInput, ctx: KeymapContext): KeyAction {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { type: "quit" };
  }

  // PRD #343 / ADR 0031 / issue #345: Esc replaces Tab/Shift-Tab as the
  // pane-focus toggle, with modal-unwind taking precedence. When a
  // composer or picker is open the keymap returns `close-modal` so the
  // App-shell closes the modal; otherwise the keymap returns
  // `pane-focus-toggle` and the App dispatches `paneFocus.toggle`. Tab
  // and Shift-Tab are hard-removed from the keymap (pre-1.0 semver
  // covers the break; the prior toggle-pane / focus-sidebar actions
  // are also retired).
  if (!key.ctrl && !key.shift && key.name === "escape") {
    if (ctx.composerOpen || ctx.pickerOpen || ctx.deleteConfirmOpen) {
      return { type: "close-modal" };
    }
    if (!ctx.sidebarVisible) return { type: "show-sidebar-and-focus" };
    return { type: "pane-focus-toggle" };
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
  // `L` toggles layout (ADR 0011), `T` opens the picker, `C` is the
  // global "collapse / expand all Threads" toggle (issue #406 / ADR 0038
  // amended — the per-Thread gesture moved to `Enter` on a Card). The
  // App-side handler reads the current `collapsedThreads` size + the
  // bundle's top-level count to pick the direction. Lowercase letters
  // bind cursor-target actions on the same axis (e.g. `c` for comment,
  // `t` is unbound).
  //
  // `s` sends the focused human Comment to the configured reply-agent.
  // Card-only; off-card / sidebar surfaces a labelled no-op via
  // `noop-send-on-row`, mirroring the lowercase `r` route.
  if (!key.ctrl && key.shift && key.name === "l") {
    return { type: "toggle-layout" };
  }
  if (!key.ctrl && key.shift && key.name === "t") {
    return { type: "open-picker" };
  }
  if (!key.ctrl && key.shift && key.name === "b") {
    return { type: "toggle-sidebar-visibility" };
  }
  if (!ctx.sidebarFocused && !key.ctrl && key.shift && key.name === "c") {
    return { type: "toggle-all-threads-collapse" };
  }
  if (!key.ctrl && !key.shift) {
    if (key.name === "n") return { type: "next-comment" };
    if (key.name === "p") return { type: "prev-comment" };
    if (key.name === "s") {
      if (!ctx.cursorOnCard) return { type: "noop-send-on-row" };
      return { type: "send-to-agent" };
    }
    // Issue #297: `e` dispatches per-file Expand-all on the cursored
    // file. The keyboard path mirrors the file-header's `↕` mouse
    // affordance — both end on `expansion.expandFileAll(cursor.file)`.
    // Available in both panes so the user can fire it from either the
    // sidebar (cursor anchored on a file row) or the diff pane (cursor
    // anchored on any row inside the file). When no file is in scope
    // (empty tour, null cursor + sidebar focused on a folder), the
    // App-side handler is a labelled no-op.
    if (key.name === "e") {
      if (ctx.cursorOnCard) {
        if (ctx.cursorOnDeletedStub) return { type: "noop-edit-on-stub" };
        return { type: "open-edit-composer" };
      }
      if (ctx.cursorOnInteractive) return { type: "noop" };
      return { type: "expand-file-all" };
    }
    // Issue #326 / PRD #356 / issue #357: `y` yanks the context-aware
    // target at the cursor. Diff-pane row cursor on a source line →
    // yanks the line text; row cursor on an interactive row or card →
    // yanks the file path; sidebar file selection → yanks the path.
    // Both panes dispatch the same action; the App-side handler routes
    // on the resolver's `YankTarget` kind (line | path | none).
    if (key.name === "y") return { type: "yank-at-cursor" };
    // PRD #349 / ADR 0032 / issue #352: `o` opens the cursor's file at
    // its line in the configured editor. Available in both panes — the
    // App-side handler resolves the target (permissive resolution per
    // issue #354: row → (file, line); card → annotation `line_end`;
    // sidebar file → (file, 1); folder / null → footer no-op) and
    // routes to `core/editor-spawn`. Bare lowercase per ADR 0030
    // (cursor-target action). `e` is taken by expand-file-all (#297) —
    // convention concession recorded in ADR 0032.
    if (key.name === "o") return { type: "open-in-editor" };
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
    // Issue #390 / ADR 0021 addendum: the request-reply verb moved to
    // `s` is handled above with the other cursor-target actions.
    // ADR 0036 Slice D / issue #388. `d` is card-only — opens the delete-
    // confirm modal on the cursored Comment. Off-card presses surface a
    // labelled no-op in the footer, matching the existing
    // `noop-reply-on-row` / `noop-send-on-row` pattern. Scoped to the
    // diff pane: sidebar `d` is a plain noop (no Comment cursor in the
    // sidebar). Reply-level cursor stops (ADR 0037) let this verb target
    // both parents and Replies uniformly.
    if (!ctx.sidebarFocused && key.name === "d") {
      if (!ctx.cursorOnCard) return { type: "noop-delete-on-row" };
      if (ctx.cursorOnDeletedStub) return { type: "noop-delete-on-stub" };
      return { type: "open-delete-confirm" };
    }
  }

  // Diff-pane Enter (ADR 0013 / ADR 0025): on an interactive row fires
  // `primary-action` (hidden-context expand); on a Card the per-Thread
  // collapse toggle (issue #406 / ADR 0038 amended — moved from
  // `Shift+C`); elsewhere a no-op. The Shift modifier carries no
  // special meaning — per PRD #270 Slice 5 the per-file Expand-all
  // button is the whole-file escape hatch; Shift+Enter behaves
  // identically to plain Enter.
  if (!ctx.sidebarFocused && !key.ctrl && key.name === "return") {
    if (ctx.cursorOnInteractive) return { type: "primary-action" };
    if (ctx.cursorOnCard) return { type: "toggle-thread-collapse" };
  }

  if (ctx.sidebarFocused && ctx.rowCount > 0) {
    if (key.name === "j" || key.name === "down") return { type: "move-file-down" };
    if (key.name === "k" || key.name === "up") return { type: "move-file-up" };
    if (key.name === "return") {
      // PRD #343 / ADR 0031 / issue #345: folder-row Enter toggles the
      // folder (aligns with the W3C ARIA tree-widget convention —
      // "Enter on a parent node toggles expand"). File-row Enter keeps
      // its existing select-file semantic; the new branch fills the
      // prior no-op (folder Enter was a silent miss). Empty
      // `selectedRowKind` falls through to the unconditional
      // select-file (preserves today's behavior for the degenerate
      // case where row-kind is unknown).
      if (ctx.selectedRowKind === "folder") return { type: "toggle-folder" };
      return { type: "select-file" };
    }
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
