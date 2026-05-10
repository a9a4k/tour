import { describe, it, expect } from "vitest";
import { CURSOR_OUTLINE_CSS, PLUS_BUTTON_CSS } from "../../src/web/client/cursor-css.js";

describe("CURSOR_OUTLINE_CSS", () => {
  it("targets the cursor-overlay attribute (data-tour-cursor='true')", () => {
    expect(CURSOR_OUTLINE_CSS).toContain('[data-tour-cursor="true"]');
  });

  it("emits the GitHub-style outline + zero-layout shift on the cursor cell", () => {
    expect(CURSOR_OUTLINE_CSS).toContain("outline: 2px solid");
    expect(CURSOR_OUTLINE_CSS).toContain("border-radius: 4px");
    expect(CURSOR_OUTLINE_CSS).toContain("outline-offset: -1px");
  });

  it("uses the shared accent token (#58a6ff) so cursor + range CSS are color-aligned", () => {
    expect(CURSOR_OUTLINE_CSS).toContain("#58a6ff");
  });
});

// PRD #136 user-story 7: the `+` button must sit to the left of the
// line-number column (no overlap with the line number). The hover-driven
// mount path was removed; the cursor is the only trigger now.
describe("PLUS_BUTTON_CSS", () => {
  it("targets the real-DOM button class mounted by plus-button-overlay", () => {
    expect(PLUS_BUTTON_CSS).toContain(".tour-plus-button");
  });

  it("pins the button to the left edge of the cursor cell (GitHub-style gutter affordance)", () => {
    expect(PLUS_BUTTON_CSS).toContain("position: absolute");
    expect(PLUS_BUTTON_CSS).toContain("left: 0");
    expect(PLUS_BUTTON_CSS).toContain("translate(-100%, -50%)");
  });

  it("uses the shared accent-emphasis token (GitHub PR `+` blue)", () => {
    expect(PLUS_BUTTON_CSS).toContain("#1f6feb");
  });

  it("lifts the button on hover so the affordance feels interactive", () => {
    expect(PLUS_BUTTON_CSS).toContain(".tour-plus-button:hover");
    expect(PLUS_BUTTON_CSS).toContain("filter: brightness");
  });

  // Persistent-mount optimization: the button is kept in the DOM after the
  // cursor moves off (avoids compositor-layer churn on cursor motion);
  // visibility flips via the CSS show rule instead of DOM mutation.
  it("hides the button by default (display: none) so persistent-mounted instances stay invisible", () => {
    expect(PLUS_BUTTON_CSS).toContain("display: none");
  });

  it("shows the button only when the parent cell carries data-tour-cursor", () => {
    expect(PLUS_BUTTON_CSS).toContain('[data-tour-cursor="true"] > .tour-plus-button');
    expect(PLUS_BUTTON_CSS).toContain("display: inline-flex");
  });

  it("does NOT key visibility off data-tour-hover (hover-driven path removed)", () => {
    expect(PLUS_BUTTON_CSS).not.toContain("data-tour-hover");
  });
});
