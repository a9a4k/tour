import { theme } from "../core/theme.js";

interface HamburgerButtonTuiProps {
  onOpen: () => void;
}

// Header hamburger that opens the tour picker. Layout is constrained by
// issue #90: outer height matches the 3-row title block (paddingTop + 2
// text lines), and the ☰ glyph is centered inside the bordered box.
export function HamburgerButtonTui({ onOpen }: HamburgerButtonTuiProps) {
  return (
    <box
      borderStyle="single"
      borderColor={theme.border.default}
      width={5}
      height={3}
      alignItems="center"
      justifyContent="center"
      onMouseDown={onOpen}
    >
      <text fg={theme.fg.default}>{" ☰ "}</text>
    </box>
  );
}
