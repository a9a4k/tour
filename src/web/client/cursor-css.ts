import { theme } from "../../core/theme.js";
import type { Cursor } from "../../core/cursor-state.js";

/**
 * GitHub-style rounded outline on the cursor row's active-side cell
 * (ADR 0012). Pixel-thin via CSS `outline` so adjacent rows don't shift.
 *
 * Per-file CSS: returns rules only when the cursor's file matches the
 * argument; otherwise empty string. Pierre's per-file shadow root scopes
 * `[data-line]` selectors to that file's rendered diff, so an empty
 * string from non-matching files leaves their renders untouched.
 *
 * Side scoping: in split layout the outline must paint on the
 * `cursor.side` column only (additions vs deletions). The `data-line-type`
 * filter handles that for paired rows; pure-add / pure-del rows have a
 * single populated cell anyway.
 */
export function buildCursorOutlineCSS(
  cursor: Cursor | null,
  file: string,
): string {
  if (!cursor) return "";
  if (cursor.file !== file) return "";
  const types =
    cursor.side === "additions"
      ? ["addition", "change-addition", "context"]
      : ["deletion", "change-deletion", "context"];
  const lineSel = `[data-line="${cursor.lineNumber}"]`;
  const typeSel = types.map((t) => `[data-line-type="${t}"]`).join(", ");
  return `${lineSel}:is(${typeSel}) { outline: 2px solid ${theme.fg.accent}; border-radius: 4px; outline-offset: -1px; }`;
}

/**
 * Soft hover tint on annotatable rows (ADR 0012). After the click-to-
 * annotate extension lands context rows are also annotatable, so the
 * hover scope matches what `findAnnotatableLine` accepts.
 *
 * Suppressed when the composer is open: returns empty so mouse motion
 * mid-edit doesn't tempt the reviewer to a different row.
 */
export function buildHoverTintCSS(composerOpen: boolean): string {
  if (composerOpen) return "";
  return `
    [data-line][data-line-type="addition"]:hover,
    [data-line][data-line-type="deletion"]:hover,
    [data-line][data-line-type="change-addition"]:hover,
    [data-line][data-line-type="change-deletion"]:hover,
    [data-line][data-line-type="context"]:hover {
      background-image: linear-gradient(${theme.bg.accentRange.web}, ${theme.bg.accentRange.web});
    }
  `;
}
