/**
 * Webapp keyboard cursor dispatcher (ADR 0012). Mirror of the TUI's
 * `dispatchKey` shape but tuned for browser-side keymap rules: editable
 * focus suppression, picker-open inert, composer-open suppression for
 * cursor motion (so editing the composer's textarea isn't fighting line
 * cursor keys), and the lowercase `l → L` rebind for layout toggle.
 *
 * The dispatcher is pure: caller threads the relevant view state in,
 * receives a tagged action, and applies it. Keeps the keyboard contract
 * independent of React state plumbing for tests.
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
}

export type CursorAction =
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "set-side-additions" }
  | { type: "set-side-deletions" }
  | { type: "annotate-at-cursor" }
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

  // `t` opens picker. Annotation nav `n`/`p` couples cursor + currentAnnotationId.
  if (!e.shiftKey) {
    if (e.key === "t") return { type: "open-picker" };
    if (e.key === "n") return { type: "nav-next-annotation" };
    if (e.key === "p") return { type: "nav-prev-annotation" };
    // `a` opens the composer at the cursor anchor; the App-side handler
    // materializes the cursor first if it's still null (lazy materialization).
    if (e.key === "a") return { type: "annotate-at-cursor" };
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
