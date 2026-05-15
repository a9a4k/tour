import React from "react";

// Webapp footer hint strip (issue #331 / #332 — slices of PRD #330).
//
// Renders the keybinding legend as the bottom sibling of the column-flex
// root. The component stays a shallow presentational shell — legend
// composition (including the dynamic `s: send to {agent}` segment) lives
// in `core/footer-hints.ts` so the string can be tested without spinning
// up a renderer. The transient status slot lands in a subsequent slice.
export interface FooterProps {
  legend: string;
}

export function Footer({ legend }: FooterProps): React.ReactElement {
  return (
    <footer className="app-footer">
      <span className="app-footer-legend">{legend}</span>
    </footer>
  );
}
