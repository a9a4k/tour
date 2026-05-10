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
 * Hover affordance (ADR 0012). Two rule blocks:
 *
 * 1. Soft background tint on annotatable rows that the hover-overlay
 *    listener has marked with `data-tour-hover="true"`. Scoped by
 *    `data-line-type` to addition / deletion / change-addition /
 *    change-deletion / context — the same set `findAnnotatableLine`
 *    accepts. We deliberately do NOT use the bare `:hover` pseudo-class
 *    because Pierre paints its own `:hover` defaults; the attribute-
 *    keyed selector keeps the two stylesheets out of each other's way
 *    and lets the JS listener gate suppression while the composer is
 *    open.
 *
 * 2. A `+` button rendered as a CSS `::after` pseudo-element on the
 *    hovered row — pseudo-element approach avoids React tree changes
 *    and DOM injection. Click on the `+` is the same as click on the
 *    row (no separate event target); the existing `onWrapperClick`
 *    delegate routes both via `findAnnotatableLine`.
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
    [data-tour-hover="true"]::after {
      content: "+";
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      line-height: 16px;
      text-align: center;
      border-radius: 4px;
      background-color: ${theme.bg.accentEmphasis};
      color: ${theme.fg.onEmphasis};
      font-weight: 600;
      pointer-events: none;
    }
    [data-tour-hover="true"] {
      position: relative;
    }
  `;
}
