import { theme } from "../core/theme.js";

interface HamburgerButtonTuiProps {
  onOpen: () => void;
}

// Header hamburger that opens the tour picker. Layout is constrained by
// issue #90: outer height matches the 3-row title block (paddingTop + 2
// text lines), and the ☰ glyph is centered inside the bordered box.
//
// Width is 6 (not 5) per issue #133: ☰ (U+2630) measures 2 cells under
// OpenTUI's wcwidth path, so the inner content " ☰ " is 4 cells. The
// inner area must be ≥ 4 (outer width - 2 border cells), or OpenTUI's
// text intrinsic drops the entire row on overflow and the box renders
// empty. See tests/tui/hamburger-button.test.ts for the contract.
export function HamburgerButtonTui({ onOpen }: HamburgerButtonTuiProps) {
  return (
    <box
      borderStyle="single"
      borderColor={theme.border.default}
      width={6}
      height={3}
      alignItems="center"
      justifyContent="center"
      onMouseDown={onOpen}
    >
      <text fg={theme.fg.default}>{" ☰ "}</text>
    </box>
  );
}
