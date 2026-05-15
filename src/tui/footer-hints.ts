import type { Cursor } from "../core/cursor-state.js";
import type { Annotation } from "../core/types.js";
import { composeFooterHints as composeFooterHintsCore } from "../core/footer-hints.js";

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
//
// Issue #331: the actual string assembly lives in `core/footer-hints.ts`
// so the webapp can share the vocabulary; this TUI export is a thin
// delegate pinned to `surface: "tui"`. The signature is preserved for
// back-compat with existing call sites.
export interface FooterHintOptions {
  replyAgent?: string;
  showSendHint?: boolean;
}

export function composeFooterHints(opts: FooterHintOptions = {}): string {
  return composeFooterHintsCore({ surface: "tui", ...opts });
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
  /**
   * The rendered card's position relative to the diff scrollbox's
   * viewport rect — `"in"` when the card's box intersects the
   * viewport (including partial overlap), `"above"` / `"below"` when
   * it sits entirely outside. Undefined when the probe couldn't
   * resolve (pre-mount, or descendant culled): the helper omits the
   * direction suffix in that case.
   *
   * Issue #302: this replaces the prior `viewportRange` /
   * `cursorRowIdx` pair, which used a uniform-row-height index
   * approximation (`avg = scrollHeight / rows`) that mis-reports
   * visible cards as off-screen whenever tall cards skew prefix
   * density. The probe is computed at the App-shell call site via
   * `computeCardViewportPosition` against the rendered card's Y range.
   */
  cardViewportPosition?: "in" | "above" | "below";
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
  const { cursor, annotations, cardViewportPosition } = opts;
  if (!cursor || cursor.kind !== "card") {
    return `r: — (no annotation under cursor)`;
  }
  const ann = annotations.find((a) => a.id === cursor.annotationId);
  if (!ann) return `r: — (no annotation under cursor)`;
  const title = truncateTitle(ann.body);
  const base = `r: reply to "${title}"`;
  if (cardViewportPosition === "above") return `${base}  (cursor ↑ above viewport)`;
  if (cardViewportPosition === "below") return `${base}  (cursor ↓ below viewport)`;
  return base;
}
