import React from "react";

// Webapp footer hint strip (issue #331 — first slice of PRD #330).
//
// Renders the static keybinding legend as the bottom sibling of the
// column-flex root. No transient status slot, no send-hint conditional
// yet — those land in subsequent slices. The component stays a shallow
// presentational shell; composition lives in `core/footer-hints.ts` so
// the legend string can be tested without spinning up a renderer.
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
