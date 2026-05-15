// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Footer } from "../../src/web/client/Footer.js";

// Issue #331: the webapp footer-hint strip is mounted as the bottom
// sibling of the column-flex root and renders the static keybinding
// legend on first paint. This slice ships the legend only — the
// transient status surface lands in a subsequent slice. The
// component is a shallow presentational shell; composition lives in
// core/footer-hints.ts.

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

function mount(legend: string): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Footer, { legend }));
  });
  return container;
}

describe("Footer (issue #331)", () => {
  it("renders a <footer> landmark element", () => {
    const container = mount("j/k: move");
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
  });

  it("renders the passed legend string verbatim", () => {
    const legend =
      "j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: comment  ·  r: reply  ·  L: layout  ·  t: picker";
    const container = mount(legend);
    expect(container.textContent).toBe(legend);
  });
});
