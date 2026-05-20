// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Footer } from "../../src/web/client/Footer.js";

// PRD #330 / ADR 0028: the webapp footer renders the static keybinding
// legend on first paint plus a transient status slot that prepends onto
// the legend when set (`${status}  ·  ${legend}`). The status slot is
// wrapped in an `aria-live="polite"` `aria-atomic="true"` span so screen
// readers announce status changes politely. The component stays a
// shallow presentational shell; composition lives in
// core/footer-hints.ts and the auto-dismiss timer lives in useFlashFooter.

let root: Root | null = null;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function mount(props: { status: string | null; legend: string }): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Footer, props));
  });
  return container;
}

describe("Footer (PRD #330)", () => {
  const LEGEND =
    "j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply  ·  L: layout  ·  t: picker";

  it("renders a <footer> landmark element", () => {
    const container = mount({ status: null, legend: "j/k: move" });
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
  });

  it("with status=null, renders the legend alone (no leading separator)", () => {
    const container = mount({ status: null, legend: LEGEND });
    expect(container.textContent).toBe(LEGEND);
  });

  it("with a status, prepends `<status>  ·  ` onto the legend on the same line", () => {
    const container = mount({
      status: "Send only works on comment cards.",
      legend: LEGEND,
    });
    expect(container.textContent).toBe(
      `Send only works on comment cards.  ·  ${LEGEND}`,
    );
  });

  it("status slot is a <span> with aria-live=polite and aria-atomic=true", () => {
    const container = mount({ status: "X", legend: LEGEND });
    const liveNode = container.querySelector('[aria-live="polite"]');
    expect(liveNode).not.toBeNull();
    expect(liveNode!.tagName).toBe("SPAN");
    expect(liveNode!.getAttribute("aria-atomic")).toBe("true");
  });

  it("legend slot is NOT inside an aria-live region (no chatter on cursor moves)", () => {
    const container = mount({ status: null, legend: LEGEND });
    const legendNode = container.querySelector(".app-footer-legend")!;
    expect(legendNode).not.toBeNull();
    // Walk ancestors up to the <footer>; none of them should declare aria-live.
    let cur: Element | null = legendNode;
    while (cur && cur.tagName !== "FOOTER") {
      expect(cur.getAttribute("aria-live")).toBeNull();
      cur = cur.parentElement;
    }
  });
});
