import { theme } from "../../core/theme.js";

/**
 * GitHub-style rounded outline on the cursor row's active-side cell
 * (ADR 0012). Pixel-thin via CSS `outline` so adjacent rows don't shift.
 *
 * The cursor is mirrored onto the DOM as `data-tour-cursor="true"` +
 * `data-tour-cursor-side` by `cursor-overlay.ts`; this rule keys off
 * those attributes so the visual layer is decoupled from React render
 * boundaries — Pierre `expandUnchanged` chevron-revealed rows compose
 * for free once the overlay re-syncs against the new DOM.
 *
 * Split-layout column scoping is encoded in the side-attribute: in
 * unified layout the matching cell is the only candidate, so the side
 * filter is benign.
 */
export const CURSOR_OUTLINE_CSS = `
  [data-tour-cursor="true"] {
    outline: 2px solid ${theme.fg.accent};
    border-radius: 4px;
    outline-offset: -1px;
  }
`;

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
