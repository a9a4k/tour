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
 * Hover affordance (ADR 0012). Soft background tint on annotatable rows
 * that the hover-overlay listener has marked with `data-tour-hover="true"`.
 * Scoped by `data-line-type` to addition / deletion / change-addition /
 * change-deletion / context — the same set `findAnnotatableLine` accepts.
 * We deliberately do NOT use the bare `:hover` pseudo-class because Pierre
 * paints its own `:hover` defaults; the attribute-keyed selector keeps the
 * two stylesheets out of each other's way and lets the JS listener gate
 * suppression while the composer is open.
 *
 * The `+` affordance used to live on this rule as a `::after` pseudo-
 * element. Issue #137 / PRD #136 promoted it to a real-DOM `<button>`
 * mounted by `plus-button-overlay.ts` so the click target is unambiguous
 * (no `pointer-events` gymnastics) and the affordance is reachable to
 * assistive tech.
 *
 * Composer-open suppression: returns empty so the rules don't fire even
 * if a stale `data-tour-hover` attribute lingered on a cell at the
 * moment the composer opened. The hover-overlay listener also clears
 * the attribute on its next sync; this is defence in depth.
 */
export function buildHoverTintCSS(composerOpen: boolean): string {
  if (composerOpen) return "";
  const annotatableTypes = [
    "addition",
    "deletion",
    "change-addition",
    "change-deletion",
    "context",
  ];
  const tintSelectors = annotatableTypes
    .map((t) => `[data-line-type="${t}"][data-tour-hover="true"]`)
    .join(",\n    ");
  return `
    ${tintSelectors} {
      background-image: linear-gradient(${theme.bg.accentRange.web}, ${theme.bg.accentRange.web});
    }
  `;
}
