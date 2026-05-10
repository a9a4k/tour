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
 * Composer-open suppression: handled entirely by `syncHoverOverlay`, which
 * strips `data-tour-hover` from every cell the moment the composer
 * opens. With no cell carrying the attribute the rule below has no
 * matches, so we no longer need to gate the rule string itself —
 * keeping the CSS stable means Pierre's `options` reference does not
 * thrash when the composer toggles, sparing a full re-render.
 */
export const HOVER_TINT_CSS = (() => {
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
})();

/**
 * Visual positioning + styling for the real-DOM `<button class="tour-plus-button">`
 * mounted by `plus-button-overlay.ts`. PRD #136 user-story 7 calls for the button
 * to sit "to the left of the line-number column" — GitHub's pattern. The overlay
 * appends the button inside the cursor/hover `[data-line]` cell; this rule lifts
 * it out of cell-content flow and pins it just outside the cell's left edge so
 * it overlays the line-number gutter rather than landing at the end of the code
 * text.
 *
 * `[data-line]` is already `position: relative` in Pierre's bundle (see
 * `[data-line], [data-column-number], [data-no-newline] { position: relative; }`),
 * so the absolute positioning resolves against the code cell itself.
 * `translate(-100%, -50%)` places the button to the left of the cursor outline
 * (which lives on the same `[data-line]` cell), vertically centered on the row.
 *
 * Z-index has to clear Pierre's `[data-gutter]`, which sets `z-index: 3` plus an
 * opaque `background-color` (style.css around `[data-gutter] { z-index: 3; ... }`).
 * Without that, the button — translated leftward into the gutter column area —
 * gets painted over by the gutter's background. `z-index: 4` keeps the button
 * on top of the gutter while still sitting below absolutely-positioned UI
 * overlays Pierre layers above the diff itself.
 *
 * Default `display: none` plus the parent-attribute show rules below turn the
 * overlay's lifecycle from "mount-on-flip / unmount-on-flip" to "mount-once /
 * CSS toggles visibility". Pre-PR #137 follow-up the overlay tore the button
 * out of the DOM on every mouseout, churning compositor layers (transform +
 * z-index promote this to its own layer). The CSS-driven path collapses the
 * hover cycle to a single attribute-selector style flip — no DOM mutation,
 * no layer alloc/dealloc.
 */
export const PLUS_BUTTON_CSS = `
  .tour-plus-button {
    display: none;
    position: absolute;
    top: 50%;
    left: 0;
    transform: translate(-100%, -50%);
    z-index: 4;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background-color: ${theme.bg.accentEmphasis};
    color: ${theme.fg.onEmphasis};
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  [data-tour-cursor="true"] > .tour-plus-button,
  [data-tour-hover="true"] > .tour-plus-button {
    display: inline-flex;
  }

  .tour-plus-button:hover {
    filter: brightness(1.15);
  }

  .tour-plus-button:focus-visible {
    outline: 2px solid ${theme.fg.accent};
    outline-offset: 2px;
  }
`;
