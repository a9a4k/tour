/**
 * Webapp keyboard cursor dispatcher (ADR 0012 / ADR 0022). Mirror of the
 * TUI's `dispatchKey` shape but tuned for browser-side keymap rules:
 * editable focus suppression, picker-open inert, composer-open suppression
 * for cursor motion, and the lowercase `l → L` rebind for layout toggle.
 *
 * Action-key gating by cursor row kind (PRD #192): `r` / `s` dispatch only
 * when the cursor is on an Annotation card; `a` dispatches only when the
 * cursor is on a row (or null — App-side `a` lazy-materializes to a row).
 * The single `cursorOnCard` flag in `KeymapContext` collapses the routing
 * decision into the pure dispatcher so the action contract is testable
 * independent of React state plumbing.
 */

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
  /** Cursor is on an Annotation card (CardAnchor). Routes `r`/`s` to the
   *  card-targeting actions and `a` to a no-op (PRD #192 stories 6-11). */
  cursorOnCard: boolean;
}

export type CursorAction =
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "set-side-additions" }
  | { type: "set-side-deletions" }
  | { type: "annotate-at-cursor" }
  | { type: "open-reply-on-card" }
  | { type: "send-on-card" }
  | { type: "nav-next-annotation" }
  | { type: "nav-prev-annotation" }
  | { type: "toggle-layout" }
  | { type: "open-picker" }
  | { type: "noop" };

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

  // Picker absorbs all input. The picker's own keymap handles `t` to close.
  if (ctx.pickerOpen) return { type: "noop" };

  // Inside an editable element the only escape is the explicit cancel /
  // submit handlers on the textarea itself; cursor keys never fire.
  if (ctx.focusInEditable) return { type: "noop" };

  // Layout toggle moved from `l` to Shift-L (ADR 0012, mirrors ADR 0011).
  if (e.shiftKey && e.key === "L") return { type: "toggle-layout" };

  // `t` opens picker. Annotation nav `n`/`p` walks the card lane (PRD #192).
  if (!e.shiftKey) {
    if (e.key === "t") return { type: "open-picker" };
    if (e.key === "n") return { type: "nav-next-annotation" };
    if (e.key === "p") return { type: "nav-prev-annotation" };
    // `r` / `s` dispatch only on a CardAnchor; `a` only on a row (or null).
    // The cross-axis cases (`r` on row, `a` on card) are silent no-ops —
    // the webapp has no footer line so an offscreen-card miss is mitigated
    // by auto-recall in the App-side handler, not a hint.
    if (e.key === "r") {
      return ctx.cursorOnCard ? { type: "open-reply-on-card" } : { type: "noop" };
    }
    if (e.key === "s") {
      return ctx.cursorOnCard ? { type: "send-on-card" } : { type: "noop" };
    }
    if (e.key === "a") {
      return ctx.cursorOnCard ? { type: "noop" } : { type: "annotate-at-cursor" };
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
