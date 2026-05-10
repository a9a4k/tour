import { theme } from "../core/theme.js";

interface HamburgerButtonTuiProps {
  onOpen: () => void;
}

// Single-line bracket-style trigger that opens the tour picker. Matches
// the visual language of the sibling header controls ([Split | Unified],
// [← N/M →]) so the whole header collapses to one row.
//
// Glyph is ≡ (U+2261), a stable 1-cell character under wcwidth. ☰
// (U+2630) is East-Asian-Ambiguous: wcwidth reserves 2 cells but most
// terminals draw it as 1, leaving the glyph visually off-center.
export function HamburgerButtonTui({ onOpen }: HamburgerButtonTuiProps) {
  return (
    <box flexDirection="row">
      <text fg={theme.fg.muted}>{"["}</text>
      <text fg={theme.fg.default} onMouseDown={onOpen}>{"≡"}</text>
      <text fg={theme.fg.muted}>{"]"}</text>
    </box>
  );
}
