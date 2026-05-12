import type { Cursor } from "../core/cursor-state.js";
import type { Annotation } from "../core/types.js";

// The bottom-bar key-action hint surfaced by the TUI app shell. The
// `a` action is labelled "comment" (issue #183, PRD #181) to align with
// the verb every collaborative code-review tool reaches for; the
// keybinding itself is unchanged and `tour annotate` plus the
// "Annotation" domain noun are untouched.
//
// `s send to {agent}` (issue #184, PRD #181) is surfaced conditionally —
// only when the focused card is a human Annotation, `--reply-agent` is
// set, AND the lock is free. When the lock is held tour-wide the hint
// stays in the footer but is rendered muted; pressing `s` is a no-op
// with a one-line footer status driven by App.tsx, not by this constant.
export interface FooterHintOptions {
  replyAgent?: string;
  showSendHint?: boolean;
}

export function composeFooterHints(opts: FooterHintOptions = {}): string {
  const send =
    opts.showSendHint && opts.replyAgent
      ? `  ·  s: send to ${opts.replyAgent}`
      : "";
  return (
    `j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply${send}  ·  Enter: expand  ·  S+Enter: expand all  ·  c: collapse  ·  Space: page  ·  L: layout  ·  t: picker  ·  Tab: pane  ·  q: quit`
  );
}

// Back-compat export: the bare constant is the default footer (no Send
// hint, used by call sites that don't know about reply-agent state).
export const TUI_FOOTER_HINTS = composeFooterHints();

// Width budget for the action-target title preview. The full footer line
// is already long; the title gets a fixed slice so the off-screen
// suffix and the bigger hint string have room. 40 chars matches the
// typical 80-column terminal halved minus the surrounding chrome.
const PREVIEW_TITLE_MAX = 40;

function truncateTitle(s: string): string {
  const oneLine = s.split("\n", 1)[0] ?? "";
  if (oneLine.length <= PREVIEW_TITLE_MAX) return oneLine;
  return `${oneLine.slice(0, PREVIEW_TITLE_MAX - 1)}…`;
}

export interface FooterPreviewOptions {
  cursor: Cursor | null;
  annotations: ReadonlyArray<Annotation>;
  /** Index range of the visible viewport in the flat-row stream, half-
   *  open `[start, end)`. The cursor's row index is compared to this so
   *  off-screen direction can be appended. When unknown, leave undefined
   *  — the function omits the direction suffix. */
  viewportRange?: { start: number; end: number };
  /** Index of the cursor in the flat-row stream, or -1 when unresolved.
   *  Computed by the caller (`resolveCursorRowIdx`) so this helper stays
   *  pure and doesn't need the flat-row array. */
  cursorRowIdx?: number;
}

/**
 * Action-target preview line (PRD #192 / ADR 0022). Renders the cursor's
 * `r` target so the user knows what `r` will do before pressing it:
 *
 *   on a card                : `r: reply to "<title>"`
 *   on a card (off-screen up): `r: reply to "<title>"  (cursor ↑ above viewport)`
 *   on a card (off-screen dn): `r: reply to "<title>"  (cursor ↓ below viewport)`
 *   on a row                 : `r: — (no annotation under cursor)`
 *   null cursor              : `r: — (no annotation under cursor)`
 *
 * The off-screen suffix never applies to a row cursor — `r` on a row is
 * already a labelled no-op so the user knows nothing will happen.
 */
export function composeFooterPreview(opts: FooterPreviewOptions): string {
  const { cursor, annotations, viewportRange, cursorRowIdx } = opts;
  if (!cursor || cursor.kind !== "card") {
    return `r: — (no annotation under cursor)`;
  }
  const ann = annotations.find((a) => a.id === cursor.annotationId);
  if (!ann) return `r: — (no annotation under cursor)`;
  const title = truncateTitle(ann.body);
  const base = `r: reply to "${title}"`;
  if (
    viewportRange === undefined ||
    cursorRowIdx === undefined ||
    cursorRowIdx === -1
  ) {
    return base;
  }
  if (cursorRowIdx < viewportRange.start) return `${base}  (cursor ↑ above viewport)`;
  if (cursorRowIdx >= viewportRange.end) return `${base}  (cursor ↓ below viewport)`;
  return base;
}
