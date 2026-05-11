// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TourHeaderPath } from "../../src/web/client/App.js";

// `TourHeaderPath` renders the currently-selected file's full filesystem
// path in the left cluster of `.tour-header`, prefixed with the same
// `·` (U+00B7) separator the TUI uses, and renders nothing when no
// file is selected. The path is the full filesystem path — NOT the
// basename, NOT any app-side truncation; if the header runs out of
// horizontal space, CSS overflow handles it the same way it handles
// the existing title and source-refs.

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

function mount(element: React.ReactElement): HTMLElement {
  const container = document.getElementById("root")!;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

describe("TourHeaderPath", () => {
  it("renders the full filesystem path with the `·` separator when a file is selected", () => {
    const container = mount(
      createElement(TourHeaderPath, {
        path: "supabase/migrations/20260508144406_setup_public_api.sql",
      }),
    );
    const slot = container.querySelector(".tour-header-path");
    expect(slot).not.toBeNull();
    // The slot template is "· <path>" — same shape as TopHeaderTui so the
    // two surfaces feel consistent.
    expect(slot?.textContent).toContain("·");
    expect(slot?.textContent).toContain(
      "supabase/migrations/20260508144406_setup_public_api.sql",
    );
  });

  it("renders nothing when path is null (no file selected)", () => {
    const container = mount(createElement(TourHeaderPath, { path: null }));
    expect(container.querySelector(".tour-header-path")).toBeNull();
    // The `·` separator is unique to this slot — its absence is the contract.
    expect(container.textContent ?? "").not.toContain("·");
  });

  it("renders nothing when path is an empty string", () => {
    const container = mount(createElement(TourHeaderPath, { path: "" }));
    expect(container.querySelector(".tour-header-path")).toBeNull();
    expect(container.textContent ?? "").not.toContain("·");
  });

  it("echoes the path verbatim, never abbreviated by app code", () => {
    // The component must echo `path` verbatim — no basename, no ellipsis.
    // Long paths overflow via CSS just like the existing title / refs.
    const longPath =
      "very/deep/nested/structure/with/many/segments/that/exceeds/any/reasonable/width.ts";
    const container = mount(createElement(TourHeaderPath, { path: longPath }));
    expect(container.querySelector(".tour-header-path")?.textContent).toContain(longPath);
  });
});
