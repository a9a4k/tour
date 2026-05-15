// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TourStatsIndicator } from "../../src/web/client/App.js";

// `TourStatsIndicator` is the tour-level (PR-equivalent) `+N -M` diff-stats
// indicator that sits in the tour-title bar between the SequencePill
// comment-nav widget and the Split/Unified layout toggle (issue #233).
// Display-only, no click handler, monospace + tabular numerals so the
// numbers don't jitter. Sides are independently omitted when their count
// hits zero, so pure-addition / pure-deletion tours read cleanly.

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

describe("TourStatsIndicator (#233)", () => {
  it("renders +N -M when both sides are non-zero", () => {
    const container = mount(
      createElement(TourStatsIndicator, { additions: 373, deletions: 28 }),
    );
    const root = container.querySelector(".tour-stats");
    expect(root).not.toBeNull();
    const add = root!.querySelector(".tour-stats-count.added");
    const del = root!.querySelector(".tour-stats-count.deleted");
    expect(add?.textContent).toBe("+373");
    expect(del?.textContent).toBe("-28");
  });

  it("omits the -M side entirely when deletions === 0 (pure-addition tour)", () => {
    const container = mount(
      createElement(TourStatsIndicator, { additions: 12, deletions: 0 }),
    );
    const root = container.querySelector(".tour-stats");
    expect(root).not.toBeNull();
    expect(root!.querySelector(".tour-stats-count.added")?.textContent).toBe("+12");
    expect(root!.querySelector(".tour-stats-count.deleted")).toBeNull();
    expect(root!.textContent ?? "").not.toContain("-0");
  });

  it("omits the +N side entirely when additions === 0 (pure-deletion tour)", () => {
    const container = mount(
      createElement(TourStatsIndicator, { additions: 0, deletions: 9 }),
    );
    const root = container.querySelector(".tour-stats");
    expect(root).not.toBeNull();
    expect(root!.querySelector(".tour-stats-count.deleted")?.textContent).toBe("-9");
    expect(root!.querySelector(".tour-stats-count.added")).toBeNull();
    expect(root!.textContent ?? "").not.toContain("+0");
  });

  // Empty bundle / zero totals: the indicator renders nothing. A tour with
  // no diff content is degenerate; surfacing a 0/0 placeholder would just
  // be visual noise in the title bar.
  it("renders nothing when both counts are zero (empty / no-diff bundle)", () => {
    const container = mount(
      createElement(TourStatsIndicator, { additions: 0, deletions: 0 }),
    );
    expect(container.querySelector(".tour-stats")).toBeNull();
  });

  it("does not carry an inline onClick handler (display-only)", () => {
    const container = mount(
      createElement(TourStatsIndicator, { additions: 5, deletions: 5 }),
    );
    const root = container.querySelector(".tour-stats") as HTMLElement;
    expect(root).not.toBeNull();
    // The container is a span, not a button — no click affordance.
    expect(root.tagName.toLowerCase()).toBe("span");
    expect(root.getAttribute("onclick")).toBeNull();
    expect(root.getAttribute("role")).not.toBe("button");
  });
});
