import { describe, it, expect } from "vitest";
import { sidebarCursorPaint } from "../../src/tui/sidebar-cursor-paint.js";
import { theme } from "../../src/core/theme.js";

// Issue #305 — focus-aware sidebar cursor paint. Four cases:
//   1. not selected → no bg, no glyph (focus state irrelevant)
//   2. selected + sidebar focused   → bright `cursorRow.tui` + ❯ glyph
//   3. selected + sidebar parked    → dim   `accentCursor.tui`, no glyph
//   4. focus state never adds bg when the row isn't selected
//
// The helper is the single source of truth for the sidebar selection's
// visual shape; the app shell reads `{ bg, showGlyph }` and renders.

describe("sidebarCursorPaint (issue #305)", () => {
  it("returns no bg and no glyph when the row is not selected", () => {
    const paint = sidebarCursorPaint({ isSelected: false, sidebarFocused: true });
    expect(paint.bg).toBeUndefined();
    expect(paint.showGlyph).toBe(false);
  });

  it("returns no bg and no glyph when not selected, regardless of focus", () => {
    const paint = sidebarCursorPaint({ isSelected: false, sidebarFocused: false });
    expect(paint.bg).toBeUndefined();
    expect(paint.showGlyph).toBe(false);
  });

  it("returns bright cursorRow bg + glyph when selected and sidebar is focused", () => {
    const paint = sidebarCursorPaint({ isSelected: true, sidebarFocused: true });
    expect(paint.bg).toBe(theme.bg.cursorRow.tui);
    expect(paint.showGlyph).toBe(true);
  });

  it("returns dim accentCursor bg + no glyph when selected and sidebar is parked", () => {
    const paint = sidebarCursorPaint({ isSelected: true, sidebarFocused: false });
    expect(paint.bg).toBe(theme.bg.accentCursor.tui);
    expect(paint.showGlyph).toBe(false);
  });

  it("uses the same bright bg as the diff pane's focused cursor (one primitive)", () => {
    // The bright sidebar bg and the bright diff cursor bg are the same
    // token — that's the whole point of "one primitive, two intensities".
    // Pin it so a future theme refactor can't drift the two apart.
    const focused = sidebarCursorPaint({ isSelected: true, sidebarFocused: true });
    expect(focused.bg).toBe(theme.bg.cursorRow.tui);
  });

  it("uses the same dim bg as the diff pane's parked cursor (one primitive)", () => {
    // Mirror of the above for the parked state. Sidebar parked + diff
    // parked share `accentCursor.tui` so a returning user sees the same
    // "this is a remembered position, not the live one" shade in both
    // panes.
    const parked = sidebarCursorPaint({ isSelected: true, sidebarFocused: false });
    expect(parked.bg).toBe(theme.bg.accentCursor.tui);
  });
});
