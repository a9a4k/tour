import { describe, it, expect } from "vitest";
import { CURSOR_OUTLINE_CSS, buildHoverTintCSS } from "../../src/web/client/cursor-css.js";

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

describe("buildHoverTintCSS", () => {
  it("targets the hover-overlay attribute (data-tour-hover='true') on annotatable line types", () => {
    const css = buildHoverTintCSS(false);
    expect(css).toContain('[data-line-type="addition"][data-tour-hover="true"]');
    expect(css).toContain('[data-line-type="deletion"][data-tour-hover="true"]');
    expect(css).toContain('[data-line-type="change-addition"][data-tour-hover="true"]');
    expect(css).toContain('[data-line-type="change-deletion"][data-tour-hover="true"]');
    expect(css).toContain('[data-line-type="context"][data-tour-hover="true"]');
    expect(css).toContain("background-image");
  });

  it("does NOT use the bare :hover pseudo-class — Pierre may paint its own and we control toggle via the listener", () => {
    const css = buildHoverTintCSS(false);
    expect(css).not.toContain(":hover");
  });

  // Issue #137 / PRD #136: the `+` affordance is now a real-DOM <button>
  // mounted by plus-button-overlay.ts, not a CSS pseudo-element. This
  // rule block must not re-introduce a competing pseudo-element button.
  it("does NOT render a '+' button as a CSS pseudo-element (real-DOM button per issue #137)", () => {
    const css = buildHoverTintCSS(false);
    expect(css).not.toContain("::after");
    expect(css).not.toContain('content: "+"');
  });

  it("returns empty string when composer is open (suppress mid-edit)", () => {
    expect(buildHoverTintCSS(true)).toBe("");
  });

  it("uses the shared range tint token (no hard-coded rgba)", () => {
    const css = buildHoverTintCSS(false);
    expect(css).toContain("rgba(56, 139, 253, 0.15)");
  });
});
