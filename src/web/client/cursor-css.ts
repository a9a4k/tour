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
 * Visual positioning + styling for the real-DOM `<button class="tour-plus-button">`
 * mounted by `plus-button-overlay.ts`. PRD #136 user-story 7 calls for the button
 * to sit "to the left of the line-number column" — GitHub's pattern. The overlay
 * appends the button inside the cursor `[data-line]` cell; this rule lifts it
 * out of cell-content flow and pins it just outside the cell's left edge so it
 * overlays the line-number gutter rather than landing at the end of the code
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
 * Default `display: none` plus the cursor-attribute show rule below let the
 * overlay mount the button once per cursored cell and rely on CSS to toggle
 * visibility as the cursor moves. The hover path is intentionally removed —
 * the JS plumbing (per-event listeners on document, MutationObserver-driven
 * mount, attribute drift between cell and closure state) was a recurring
 * source of paint lag and stuck-on rows. Mouse users reach the `+` via the
 * row-click → cursor → `+` sequence; keyboard users still have `a`.
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

  [data-tour-cursor="true"] > .tour-plus-button {
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
