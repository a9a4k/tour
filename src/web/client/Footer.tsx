import React from "react";

// Webapp footer hint strip (PRD #330 / ADR 0028).
//
// Renders the static keybinding legend as the bottom sibling of the
// column-flex root, plus a transient status slot that prepends onto
// the legend when set (`${status}  ·  ${legend}`). The status slot is
// wrapped in an `aria-live="polite"` `aria-atomic="true"` span so
// screen readers announce status changes politely without re-
// announcing the static legend on every cursor move.
//
// The component stays a shallow presentational shell — composition of
// the legend string lives in `core/footer-hints.ts`; auto-dismiss
// timer plumbing lives in `core/use-flash-footer.ts`.
export interface FooterProps {
  status: string | null;
  legend: string;
}

export function Footer({ status, legend }: FooterProps): React.ReactElement {
  return (
    <footer className="app-footer">
      <span
        className="app-footer-status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status !== null ? `${status}  ·  ` : ""}
      </span>
      <span className="app-footer-legend">{legend}</span>
    </footer>
  );
}
