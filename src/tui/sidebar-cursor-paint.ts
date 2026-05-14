import { theme } from "../core/theme.js";

// Focus-aware sidebar cursor paint (issue #305). Extracted from app.tsx so
// the composition is unit-testable in isolation. The caller asks "what bg
// (if any) does this sidebar row paint, and should the `❯` glyph render
// in the leading column?" and gets back a structured answer.
//
// One primitive, two intensities — same model the diff cursor uses:
//   - sidebar focused + selected → bright `bg.cursorRow.tui` + ❯ glyph
//   - sidebar parked  + selected → dim   `bg.accentCursor.tui`, no glyph
//   - not selected                → no bg, no glyph
//
// Glyph paints in the row's existing leading-space slot — `LEADING = 1`
// in `sidebar-row-label.ts`'s fixed-cost arithmetic — so row width is
// preserved across focus transitions and across selected vs unselected.

export interface SidebarCursorPaint {
  // Row background. `undefined` when the row is not selected.
  bg: string | undefined;
  // When `true`, the caller should overlay the `❯` cursor glyph (in
  // `theme.fg.cursor`) on top of the row's leading-space slot.
  showGlyph: boolean;
}

export function sidebarCursorPaint(opts: {
  isSelected: boolean;
  sidebarFocused: boolean;
}): SidebarCursorPaint {
  if (!opts.isSelected) {
    return { bg: undefined, showGlyph: false };
  }
  if (opts.sidebarFocused) {
    return { bg: theme.bg.cursorRow.tui, showGlyph: true };
  }
  return { bg: theme.bg.accentCursor.tui, showGlyph: false };
}
