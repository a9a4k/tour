import { describe, it, expect } from "vitest";
import { buildCursorOutlineCSS, buildHoverTintCSS } from "../../src/web/client/cursor-css.js";
import type { Cursor } from "../../src/core/cursor-state.js";

const cur = (over: Partial<Cursor> & Pick<Cursor, "file" | "lineNumber" | "side">): Cursor => ({
  file: over.file,
  lineNumber: over.lineNumber,
  side: over.side,
  preferredSide: over.preferredSide ?? over.side,
});

describe("buildCursorOutlineCSS", () => {
  it("returns empty string when cursor is null", () => {
    expect(buildCursorOutlineCSS(null, "src/main.ts")).toBe("");
  });

  it("returns empty string when cursor is on a different file", () => {
    expect(
      buildCursorOutlineCSS(
        cur({ file: "other.ts", lineNumber: 5, side: "additions" }),
        "src/main.ts",
      ),
    ).toBe("");
  });

  it("emits the GitHub outline + zero-layout shift on the cursor's line", () => {
    const css = buildCursorOutlineCSS(
      cur({ file: "src/main.ts", lineNumber: 12, side: "additions" }),
      "src/main.ts",
    );
    expect(css).toContain('[data-line="12"]');
    expect(css).toContain("outline: 2px solid");
    expect(css).toContain("border-radius: 4px");
    expect(css).toContain("outline-offset: -1px");
  });

  it("scopes the outline to additions-side cells when cursor.side is additions", () => {
    const css = buildCursorOutlineCSS(
      cur({ file: "x.ts", lineNumber: 7, side: "additions" }),
      "x.ts",
    );
    expect(css).toContain('data-line-type="addition"');
    expect(css).toContain('data-line-type="change-addition"');
    expect(css).not.toContain('data-line-type="deletion"');
    expect(css).not.toContain('data-line-type="change-deletion"');
  });

  it("scopes the outline to deletions-side cells when cursor.side is deletions", () => {
    const css = buildCursorOutlineCSS(
      cur({ file: "x.ts", lineNumber: 7, side: "deletions" }),
      "x.ts",
    );
    expect(css).toContain('data-line-type="deletion"');
    expect(css).toContain('data-line-type="change-deletion"');
    expect(css).not.toContain('data-line-type="addition"');
    expect(css).not.toContain('data-line-type="change-addition"');
  });

  it("includes context rows in both side branches (context is annotatable on both sides per ADR 0012)", () => {
    const css = buildCursorOutlineCSS(
      cur({ file: "x.ts", lineNumber: 7, side: "additions" }),
      "x.ts",
    );
    expect(css).toContain('data-line-type="context"');
  });

  it("uses the shared accent token (#58a6ff) so cursor + range CSS are color-aligned", () => {
    const css = buildCursorOutlineCSS(
      cur({ file: "x.ts", lineNumber: 7, side: "additions" }),
      "x.ts",
    );
    expect(css).toContain("#58a6ff");
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
