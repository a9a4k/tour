import { describe, it, expect } from "vitest";
import { FILE_GRID_CSS } from "../../src/web/client/file-grid-css.js";
import { theme } from "../../src/core/theme.js";

// `file-grid-css` is the layout + visual-cue CSS module the new web row
// renderer injects as a <style> tag (PRD #212 slice 3). A string-emitting
// constant referencing `core/theme.ts` tokens, with no hex literals
// duplicated.
//
// The renderer's cursor decoration is a prop, NOT a DOM mutation
// (ADR 0024). The CSS keys on a `.is-cursor` className.

describe("FILE_GRID_CSS — file-level grid", () => {
  it("declares a per-file grid container with split and unified column templates", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-block");
    expect(FILE_GRID_CSS).toContain("display: grid");
    expect(FILE_GRID_CSS).toContain('[data-layout="split"]');
    expect(FILE_GRID_CSS).toContain('[data-layout="unified"]');
  });

  it("split layout uses 4 column tracks (gutter-L code-L gutter-R code-R)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{]*\{[^}]*grid-template-columns:\s*auto 1fr auto 1fr/,
    );
  });

  it("unified layout uses 2 column tracks (gutter code)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="unified"\][^{]*\{[^}]*grid-template-columns:\s*auto 1fr;/,
    );
  });
});

describe("FILE_GRID_CSS — row subgrid", () => {
  it("rows inherit the file's column tracks via grid-template-columns: subgrid", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row");
    expect(FILE_GRID_CSS).toContain("grid-template-columns: subgrid");
  });

  it("rows span the full file-grid width (grid-column: 1 / -1)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row[^{]*\{[^}]*grid-column:\s*1 \/ -1/,
    );
  });
});

describe("FILE_GRID_CSS — cards", () => {
  it("cards span full-width by default (unified layout / unified-side fallback)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-card");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-card[^{]*\{[^}]*grid-column:\s*1 \/ -1/,
    );
  });

  it("split layout side-anchors deletion cards under the left side (cols 1-2)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{}]*\.tour-card\[data-side="deletions"\][^{]*\{[^}]*grid-column:\s*1 \/ 3/,
    );
  });

  it("split layout side-anchors addition cards under the right side (cols 3-4)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{}]*\.tour-card\[data-side="additions"\][^{]*\{[^}]*grid-column:\s*3 \/ -1/,
    );
  });
});

describe("FILE_GRID_CSS — line-type backgrounds", () => {
  it("paints additions / change-additions with the success-range token", () => {
    expect(FILE_GRID_CSS).toContain('[data-line-type="addition"]');
    expect(FILE_GRID_CSS).toContain('[data-line-type="change-addition"]');
    expect(FILE_GRID_CSS).toContain(theme.bg.successRange.web);
  });

  it("paints deletions / change-deletions with the danger-range token", () => {
    expect(FILE_GRID_CSS).toContain('[data-line-type="deletion"]');
    expect(FILE_GRID_CSS).toContain('[data-line-type="change-deletion"]');
    expect(FILE_GRID_CSS).toContain(theme.bg.dangerRange.web);
  });
});

describe("FILE_GRID_CSS — cursor outline (prop, not attribute)", () => {
  it("keys the outline on .is-cursor (the prop-driven className)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row.is-cursor");
  });

  it("does NOT use the legacy [data-tour-cursor] attribute selector", () => {
    expect(FILE_GRID_CSS).not.toContain("data-tour-cursor");
  });

  it("uses the shared accent token (#58a6ff) so cursor + range CSS color-align", () => {
    expect(FILE_GRID_CSS).toContain(`outline: 2px solid ${theme.fg.accent}`);
  });
});

describe("FILE_GRID_CSS — range tint", () => {
  it(".in-range paints the accent-range tint over annotated rows", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row.in-range");
    expect(FILE_GRID_CSS).toContain(theme.bg.accentRange.web);
  });
});

describe("FILE_GRID_CSS — sticky file header", () => {
  it("retargets the sticky-header rule onto the new file-block surface", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-header");
    expect(FILE_GRID_CSS).toContain("position: sticky");
    expect(FILE_GRID_CSS).toContain("top: 0");
  });
});

describe("FILE_GRID_CSS — comment-affordance pointer", () => {
  it("paints the click affordance on annotatable diff lines", () => {
    expect(FILE_GRID_CSS).toContain("cursor: pointer");
  });
});

describe("FILE_GRID_CSS — no duplicated hex literals", () => {
  it("every hex literal in the emitted CSS appears in a core/theme.ts token", () => {
    // Whitelist of theme strings the module is allowed to reference.
    // Adding a new hex requires routing it through `theme` first.
    const allowedThemeStrings: string[] = [
      theme.canvas.default,
      theme.canvas.subtle,
      theme.canvas.inset,
      theme.canvas.emphasis,
      theme.fg.default,
      theme.fg.muted,
      theme.fg.subtle,
      theme.fg.onEmphasis,
      theme.fg.accent,
      theme.fg.cursor,
      theme.border.default,
      theme.border.muted,
      theme.border.accent,
      theme.bg.accentEmphasis,
      theme.bg.successEmphasis,
      theme.bg.dangerEmphasis,
    ];
    const matches = FILE_GRID_CSS.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    for (const hex of matches) {
      const allowed = allowedThemeStrings.some((t) =>
        t.toLowerCase() === hex.toLowerCase(),
      );
      expect(allowed, `unexpected hex literal in FILE_GRID_CSS: ${hex}`).toBe(true);
    }
  });
});
