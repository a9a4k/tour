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
  /** Cursor is on a *human*-authored Annotation card. `s` only sends a
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
  | { type: "status"; message: string }
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
    // Cross-axis misses (ADR 0028 / PRD #330): the webapp footer status
    // surface flashes the miss reason; the off-screen-card case still goes
    // through the App-side auto-recall handler, which scrolls the card in.
    if (e.key === "r") {
      if (ctx.cursorOnCard) return { type: "open-reply-on-card" };
      return { type: "status", message: "No annotation under cursor." };
    }
    if (e.key === "s") {
      // `s` is a hidden silent no-op when reply-agent isn't configured —
      // the legend hides the `s: send to {agent}` hint in that case so a
      // status flash would surprise the user.
      if (!ctx.replyAgent) return { type: "noop" };
      if (!ctx.cursorOnCard) {
        return { type: "status", message: "Send only works on annotation cards." };
      }
      if (!ctx.cursorOnHumanCard) {
        return { type: "status", message: "Send only works on human annotations." };
      }
      if (ctx.replyLockHeld) {
        return { type: "status", message: `${ctx.replyAgent} is already replying.` };
      }
      return { type: "send-on-card" };
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
