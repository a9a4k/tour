import { describe, it, expect } from "vitest";
import {
  CURSOR_OUTLINE_CSS,
  HOVER_TINT_CSS,
  PLUS_BUTTON_CSS,
} from "../../src/web/client/cursor-css.js";

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

describe("HOVER_TINT_CSS", () => {
  it("targets the hover-overlay attribute (data-tour-hover='true') on annotatable line types", () => {
    expect(HOVER_TINT_CSS).toContain('[data-line-type="addition"][data-tour-hover="true"]');
    expect(HOVER_TINT_CSS).toContain('[data-line-type="deletion"][data-tour-hover="true"]');
    expect(HOVER_TINT_CSS).toContain('[data-line-type="change-addition"][data-tour-hover="true"]');
    expect(HOVER_TINT_CSS).toContain('[data-line-type="change-deletion"][data-tour-hover="true"]');
    expect(HOVER_TINT_CSS).toContain('[data-line-type="context"][data-tour-hover="true"]');
    expect(HOVER_TINT_CSS).toContain("background-image");
  });

  it("does NOT use the bare :hover pseudo-class — Pierre may paint its own and we control toggle via the listener", () => {
    expect(HOVER_TINT_CSS).not.toContain(":hover");
  });

  // Issue #137 / PRD #136: the `+` affordance is now a real-DOM <button>
  // mounted by plus-button-overlay.ts, not a CSS pseudo-element. This
  // rule block must not re-introduce a competing pseudo-element button.
  it("does NOT render a '+' button as a CSS pseudo-element (real-DOM button per issue #137)", () => {
    expect(HOVER_TINT_CSS).not.toContain("::after");
    expect(HOVER_TINT_CSS).not.toContain('content: "+"');
  });

  it("uses the shared range tint token (no hard-coded rgba)", () => {
    expect(HOVER_TINT_CSS).toContain("rgba(56, 139, 253, 0.15)");
  });
});

// PRD #136 user-story 7: the `+` button must sit to the left of the
// line-number column (no overlap with the line number). PR #137 shipped the
// functional contract but deferred CSS positioning; this rule closes that gap
// by lifting the appended button out of cell-content flow and anchoring it
// just outside the `[data-line]` cell's left edge.
describe("PLUS_BUTTON_CSS", () => {
  it("targets the real-DOM button class mounted by plus-button-overlay", () => {
    expect(PLUS_BUTTON_CSS).toContain(".tour-plus-button");
  });

  it("pins the button to the left edge of the cursor/hover cell (GitHub-style gutter affordance)", () => {
    expect(PLUS_BUTTON_CSS).toContain("position: absolute");
    expect(PLUS_BUTTON_CSS).toContain("left: 0");
    expect(PLUS_BUTTON_CSS).toContain("translate(-100%, -50%)");
  });

  it("uses the shared accent-emphasis token (GitHub PR `+` blue)", () => {
    expect(PLUS_BUTTON_CSS).toContain("#1f6feb");
  });
});
