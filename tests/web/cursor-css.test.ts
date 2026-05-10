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
  it("emits a :hover background tint on annotatable line types", () => {
    const css = buildHoverTintCSS(false);
    expect(css).toContain('[data-line-type="addition"]:hover');
    expect(css).toContain('[data-line-type="deletion"]:hover');
    expect(css).toContain('[data-line-type="change-addition"]:hover');
    expect(css).toContain('[data-line-type="change-deletion"]:hover');
    expect(css).toContain('[data-line-type="context"]:hover');
    expect(css).toContain("background-image");
  });

  it("returns empty string when composer is open (suppress mid-edit)", () => {
    expect(buildHoverTintCSS(true)).toBe("");
  });

  it("uses the shared range tint token (no hard-coded rgba)", () => {
    const css = buildHoverTintCSS(false);
    expect(css).toContain("rgba(56, 139, 253, 0.15)");
  });
});
