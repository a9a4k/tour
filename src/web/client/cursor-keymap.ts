/**
 * Webapp keyboard cursor dispatcher (ADR 0012 / ADR 0022). Mirror of the
 * TUI's `dispatchKey` shape but tuned for browser-side keymap rules:
 * editable focus suppression, picker-open inert, composer-open suppression
 * for cursor motion, and the lowercase `l → L` rebind for layout toggle.
 *
 * Action-key gating by cursor row kind (PRD #192): `r` / `s` dispatch only
 * when the cursor is on a Comment card; `c` dispatches only when the
 * cursor is on a row (or null — App-side `c` lazy-materializes to a row).
 * The single `cursorOnCard` flag in `KeymapContext` collapses the routing
 * decision into the pure dispatcher so the action contract is testable
 * independent of React state plumbing.
 *
 * Keybinding convention (ADR 0030): lowercase keys target the cursor;
 * capitals are global. PRD #335 / ADR 0029 cut over the primary verb
 * from `a` to `c` and promoted `t → T` so the picker fits the rule with
 * no exemption. Bare `a` and bare `t` are now unbound noops.
 *
 * Cross-surface pane focus (PRD #343 / ADR 0031 / issue #346): `Esc`
 * toggles paneFocus with modal-unwind precedence; sidebar-mode binds
 * `j`/`k`/`ArrowDown`/`ArrowUp` for file motion, `l`/`ArrowRight` to
 * expand a folder, `h`/`ArrowLeft` to collapse a folder or jump to the
 * parent of a file, and `Enter` to activate the selected row (file →
 * select + flip to diff; folder → toggle fold). `c` / `r` / `s` are
 * silent no-ops when paneFocus = sidebar (the user explicitly returns
 * to diff first; auto-flipping would lose track of where the resulting
 * Comment / reply / send lands).
 */

export type PaneFocus = "sidebar" | "diff";

export interface CursorKeymapContext {
  /** Inline composer is open — j/k/h/l/arrows route to the textarea, not
   *  the cursor. `n`/`p`/`L` still fire so the reviewer can navigate
   *  even mid-edit (matches the tour-picker rule). */
  composerOpen: boolean;
  /** Tour picker is open — picker owns input, all cursor keys inert. */
  pickerOpen: boolean;
  /** Focus is in an INPUT / TEXTAREA / contentEditable — never steal
   *  text input. */
  focusInEditable: boolean;
  /** Cursor is on a Comment card (CardAnchor). Routes `r`/`s` to the
   *  card-targeting actions and `c` to a no-op (PRD #192 stories 6-11). */
  cursorOnCard: boolean;
  /** Cursor is on a *human*-authored Comment card. `s` only sends a
   *  reply to the configured agent on human cards; sending on an agent
   *  card surfaces the wrong-target footer status (PRD #330). */
  cursorOnHumanCard: boolean;
  /** Tour-wide reply-lock is held — an agent reply is in flight. `s`
   *  on a human card with the lock held flashes a status instead of
   *  re-dispatching. */
  replyLockHeld: boolean;
  /** `--reply-agent` configured agent name, if any. `s` is a hidden
   *  silent no-op when this is unset (the legend itself omits the
   *  `s: send to {agent}` hint per PRD #330 stories 7-8). When status
   *  is emitted for the lock-held branch, this is interpolated into
   *  the message. */
  replyAgent?: string;
  /** PRD #343 / ADR 0031: which pane owns keyboard input. Sidebar
   *  routes `j`/`k`/`h`/`l`/Enter to file-tree navigation; diff mode
   *  keeps today's cursor / card actions. Defaults to `"diff"` so
   *  callers that haven't migrated yet get today's behavior. */
  paneFocus?: PaneFocus;
  /** PRD #343 / ADR 0031: selected sidebar row kind (file vs folder).
   *  Routes `Enter` to `select-file` vs `toggle-folder`, `l`/`h` to
   *  folder controls vs `collapse-parent` for files. Null when the
   *  sidebar has no selection (degenerate empty-tour state). */
  selectedRowKind?: "file" | "folder" | null;
}

export type CursorAction =
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "set-side-additions" }
  | { type: "set-side-deletions" }
  | { type: "comment-at-cursor" }
  | { type: "open-reply-on-card" }
  | { type: "send-on-card" }
  | { type: "nav-next-comment" }
  | { type: "nav-prev-comment" }
  | { type: "toggle-layout" }
  | { type: "open-picker" }
  // PRD #349 / ADR 0032 / issue #353: bare lowercase `o` → spawn the
  // configured editor on the server's side via POST /api/tours/<id>/
  // open-in-editor. Fires above the composer-open gate (matches n/p) so
  // mid-compose fact-checking still works; suppressed by picker / editable.
  | { type: "open-in-editor" }
  | { type: "status"; message: string }
  | { type: "noop" }
  // Pane-focus + sidebar-mode (PRD #343 / ADR 0031 / issue #346).
  | { type: "pane-focus-toggle" }
  | { type: "close-modal" }
  | { type: "move-file-up" }
  | { type: "move-file-down" }
  | { type: "select-file" }
  | { type: "toggle-folder" }
  | { type: "expand-folder" }
  | { type: "collapse-folder" }
  | { type: "collapse-parent" };

export interface KeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Map a keydown to a cursor action. Caller is responsible for the
 * `e.preventDefault()` / state mutation; this function only classifies.
 */
export function dispatchCursorKey(
  e: KeyEvent,
  ctx: CursorKeymapContext,
): CursorAction {
  if (e.metaKey || e.ctrlKey || e.altKey) return { type: "noop" };

  // PRD #343 / ADR 0031 / issue #346: Esc is the cross-surface pane-
  // toggle key with modal-unwind precedence. When a modal is open the
  // keymap returns `close-modal`; otherwise it returns
  // `pane-focus-toggle`. Esc is dispatched BEFORE the picker /
  // focus-in-editable gates below so the user can always Esc out of a
  // modal (the textarea's own onKeyDown still owns composer-Esc — see
  // the inline cancel handler in App.tsx — but the global handler is
  // defense in depth: a composer that's open but doesn't have focus
  // still closes on Esc).
  if (!e.shiftKey && e.key === "Escape") {
    if (ctx.composerOpen || ctx.pickerOpen) return { type: "close-modal" };
    return { type: "pane-focus-toggle" };
  }

  // Picker absorbs all input. The picker owns its close binding.
  if (ctx.pickerOpen) return { type: "noop" };

  // Inside an editable element the only escape is the explicit cancel /
  // submit handlers on the textarea itself; cursor keys never fire.
  if (ctx.focusInEditable) return { type: "noop" };

  // Layout toggle moved from `l` to Shift-L (ADR 0012, mirrors ADR 0011).
  if (e.shiftKey && e.key === "L") return { type: "toggle-layout" };

  // `T` (Shift+t) opens picker (ADR 0030 — capital = global). PRD #335 /
  // ADR 0029 promoted `t → T` in lockstep with the `a → c` cutover.
  if (e.shiftKey && e.key === "T") return { type: "open-picker" };

  // PRD #349 / ADR 0032 / issue #353: bare lowercase `o` opens the
  // cursor's file in the configured editor. Pane-agnostic: dispatched
  // in both sidebar and diff modes — the App-side handler resolves the
  // cursor + sidebar selection and surfaces a footer hint when no
  // target is available (slice 1 resolver returns null outside row
  // cursors; permissive resolution lands in #354). Above the
  // composer-open gate so mid-compose fact-checking still works
  // (matches `n`/`p`/`Shift+T`).
  if (!e.shiftKey && e.key === "o") return { type: "open-in-editor" };

  const paneFocus: PaneFocus = ctx.paneFocus ?? "diff";

  // Sidebar-mode key surface (PRD #343 / ADR 0031 / issue #346). Mirrors
  // the TUI's sidebar branch in src/tui/keymap.ts: j/k/ArrowDown/ArrowUp
  // for file motion, l/ArrowRight to expand a folder, h/ArrowLeft to
  // collapse a folder or jump to the parent for a file, Enter to
  // activate the selected row. `c`/`r`/`s` are silent no-ops here
  // (the user must Esc back to diff first; auto-flipping would lose
  // track of where the resulting action lands).
  if (paneFocus === "sidebar" && !e.shiftKey) {
    if (e.key === "j" || e.key === "ArrowDown") return { type: "move-file-down" };
    if (e.key === "k" || e.key === "ArrowUp") return { type: "move-file-up" };
    if (e.key === "Enter") {
      if (ctx.selectedRowKind === "folder") return { type: "toggle-folder" };
      return { type: "select-file" };
    }
    if (e.key === "l" || e.key === "ArrowRight") {
      if (ctx.selectedRowKind === "folder") return { type: "expand-folder" };
      return { type: "noop" };
    }
    if (e.key === "h" || e.key === "ArrowLeft") {
      if (ctx.selectedRowKind === "folder") return { type: "collapse-folder" };
      if (ctx.selectedRowKind === "file") return { type: "collapse-parent" };
      return { type: "noop" };
    }
    // n/p auto-flip to diff at the App-side handler — the keymap
    // emits them unconditionally and the App dispatches
    // paneFocus.setDiff alongside the navigation.
    if (e.key === "n") return { type: "nav-next-comment" };
    if (e.key === "p") return { type: "nav-prev-comment" };
    // c / r / s gating: silent no-op in sidebar mode (PRD #343 US 21-22).
    if (e.key === "c" || e.key === "r" || e.key === "s") return { type: "noop" };
    return { type: "noop" };
  }

  // Diff-mode (default): today's cursor + card action surface.

  // Comment nav `n`/`p` walks the card lane (PRD #192).
  if (!e.shiftKey) {
    if (e.key === "n") return { type: "nav-next-comment" };
    if (e.key === "p") return { type: "nav-prev-comment" };
    // `r` / `s` dispatch only on a CardAnchor; `c` only on a row (or null).
    // Cross-axis misses (ADR 0028 / PRD #330): the webapp footer status
    // surface flashes the miss reason; the off-screen-card case still goes
    // through the App-side auto-recall handler, which scrolls the card in.
    if (e.key === "r") {
      if (ctx.cursorOnCard) return { type: "open-reply-on-card" };
      return { type: "status", message: "No comment under cursor." };
    }
    if (e.key === "s") {
      // `s` is a hidden silent no-op when reply-agent isn't configured —
      // the legend hides the `s: send to {agent}` hint in that case so a
      // status flash would surprise the user.
      if (!ctx.replyAgent) return { type: "noop" };
      if (!ctx.cursorOnCard) {
        return { type: "status", message: "Send only works on comment cards." };
      }
      if (!ctx.cursorOnHumanCard) {
        return { type: "status", message: "Send only works on human comments." };
      }
      if (ctx.replyLockHeld) {
        return { type: "status", message: `${ctx.replyAgent} is already replying.` };
      }
      return { type: "send-on-card" };
    }
    if (e.key === "c") {
      return ctx.cursorOnCard ? { type: "noop" } : { type: "comment-at-cursor" };
    }
  }

  // Cursor motion / side selection. Suppressed when the composer is open
  // (the textarea owns the keys) and require non-shifted bare keys.
  if (ctx.composerOpen) return { type: "noop" };

  if (!e.shiftKey) {
    if (e.key === "j" || e.key === "ArrowDown") return { type: "move-down" };
    if (e.key === "k" || e.key === "ArrowUp") return { type: "move-up" };
    if (e.key === "h" || e.key === "ArrowLeft") return { type: "set-side-deletions" };
    if (e.key === "l" || e.key === "ArrowRight") return { type: "set-side-additions" };
  }

  return { type: "noop" };
}
