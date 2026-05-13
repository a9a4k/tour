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

  it("split layout uses 6 column tracks (gutter+symbol+code per side, #221)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{]*\{[^}]*grid-template-columns:\s*auto auto 1fr auto auto 1fr/,
    );
  });

  it("unified layout uses 3 column tracks (gutter symbol code, #221)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="unified"\][^{]*\{[^}]*grid-template-columns:\s*auto auto 1fr;/,
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

  it("split layout side-anchors deletion cards under the left side (cols 1-3, #221)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{}]*\.tour-card\[data-side="deletions"\][^{]*\{[^}]*grid-column:\s*1 \/ 4/,
    );
  });

  it("split layout side-anchors addition cards under the right side (cols 4-end, #221)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\[data-layout="split"\][^{}]*\.tour-card\[data-side="additions"\][^{]*\{[^}]*grid-column:\s*4 \/ -1/,
    );
  });
});

describe("FILE_GRID_CSS — line-type backgrounds (two-tone, #221)", () => {
  it("paints additions / change-additions gutter+symbol with the brighter success-range token", () => {
    expect(FILE_GRID_CSS).toContain('[data-line-type="addition"]');
    expect(FILE_GRID_CSS).toContain('[data-line-type="change-addition"]');
    expect(FILE_GRID_CSS).toContain(theme.bg.successRange.web);
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row\[data-line-type="addition"\] \.tour-row-gutter[\s\S]*?\.tour-row-symbol/,
    );
  });

  it("paints additions / change-additions code cell with the softer success-cell token", () => {
    expect(FILE_GRID_CSS).toContain(theme.bg.successCell.web);
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row\[data-line-type="addition"\] \.tour-row-cell[\s\S]*?background-color:\s*\$?\{?[^}]*\}?/,
    );
  });

  it("paints deletions / change-deletions gutter+symbol with the brighter danger-range token", () => {
    expect(FILE_GRID_CSS).toContain('[data-line-type="deletion"]');
    expect(FILE_GRID_CSS).toContain('[data-line-type="change-deletion"]');
    expect(FILE_GRID_CSS).toContain(theme.bg.dangerRange.web);
  });

  it("paints deletions / change-deletions code cell with the softer danger-cell token", () => {
    expect(FILE_GRID_CSS).toContain(theme.bg.dangerCell.web);
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row\[data-line-type="deletion"\] \.tour-row-cell[\s\S]*?background-color:\s*\$?\{?[^}]*\}?/,
    );
  });
});

describe("FILE_GRID_CSS — gutter+symbol foreground on tinted rows (#248)", () => {
  // GitHub renders the line-number gutter + +/- symbol in `fg.default`
  // (white) on tinted addition / deletion / change-addition /
  // change-deletion rows so the digits stay legible against the bright
  // success-range / danger-range rail. The base `.tour-row-gutter` /
  // `.tour-row-symbol` rule mutes those cells via fg.muted; the new
  // [data-line-type] selectors override the color on the four tinted
  // row kinds. Context rows have no [data-line-type] background rule,
  // so the new color rule also doesn't match — the base muted color
  // stands. The four addition / deletion / change-addition /
  // change-deletion combos × { gutter, symbol } produce eight covered
  // selector × target pairs.

  it("paints the four tinted [data-line-type] × { gutter, symbol } combos in theme.fg.default", () => {
    // `change-deletion .tour-row-symbol` is a closing selector in both
    // the existing dangerRange background-color rule and the new
    // foreground rule, so collect every rule body keyed on it and
    // assert one of them is the color rule.
    const bodies = Array.from(
      FILE_GRID_CSS.matchAll(
        /\.tour-row\[data-line-type="change-deletion"\] \.tour-row-symbol\s*\{([^}]*)\}/g,
      ),
      (m) => m[1],
    );
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const colorBodies = bodies.filter((b) =>
      new RegExp(`color:\\s*${theme.fg.default}`, "i").test(b),
    );
    expect(colorBodies.length).toBe(1);
  });

  it("groups all four tinted [data-line-type] × { gutter, symbol } selectors into a single color rule", () => {
    // Eight selector parts (4 line types × 2 cells) — same selector
    // grouping shape as the two-tone background rules so the foreground
    // / background rule pair stays parallel.
    const expected = [
      '.tour-row[data-line-type="addition"] .tour-row-gutter',
      '.tour-row[data-line-type="addition"] .tour-row-symbol',
      '.tour-row[data-line-type="change-addition"] .tour-row-gutter',
      '.tour-row[data-line-type="change-addition"] .tour-row-symbol',
      '.tour-row[data-line-type="deletion"] .tour-row-gutter',
      '.tour-row[data-line-type="deletion"] .tour-row-symbol',
      '.tour-row[data-line-type="change-deletion"] .tour-row-gutter',
      '.tour-row[data-line-type="change-deletion"] .tour-row-symbol',
    ];
    for (const sel of expected) {
      expect(FILE_GRID_CSS).toContain(sel);
    }
  });

  it("does NOT override .tour-row-gutter base color (context rows stay muted)", () => {
    // The base rule on `.tour-row-gutter` still resolves to fg.muted —
    // the new rule layers on top of it only when [data-line-type]
    // matches one of the four tinted kinds. Context rows have no
    // matching [data-line-type] background rule, so the base muted
    // color stands.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter\s*\{[^}]*color:\s*#9198a1/i,
    );
  });

  it("does NOT override .tour-row-symbol base color (context rows stay muted)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-symbol\s*\{[^}]*color:\s*#9198a1/i,
    );
  });
});

describe("FILE_GRID_CSS — line-number polish (#221)", () => {
  it("right-aligns line numbers", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter[\s\S]*?text-align:\s*right/,
    );
  });

  it("mutes line-number color with theme.fg.muted", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter[\s\S]*?color:\s*#9198a1/i,
    );
  });

  it("adds horizontal padding to line-number gutter", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter[\s\S]*?padding:\s*0\s+\d+px/,
    );
  });
});

describe("FILE_GRID_CSS — symbol column (#221)", () => {
  it("declares a tour-row-symbol selector with centered, padded styling", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row-symbol");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-symbol[\s\S]*?text-align:\s*center/,
    );
  });
});

describe("FILE_GRID_CSS — cursor outline (prop, not attribute)", () => {
  it("keys the outline on .is-cursor (the prop-driven className)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row.is-cursor");
  });

  it("also keys the outline on .tour-row-cell.is-cursor so split-layout cursors scope to one side", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row-cell.is-cursor");
  });

  it("does NOT use the legacy [data-tour-cursor] attribute selector", () => {
    expect(FILE_GRID_CSS).not.toContain("data-tour-cursor");
  });

  it("uses the shared accent token (#58a6ff) so cursor + range CSS color-align", () => {
    expect(FILE_GRID_CSS).toContain(`outline: 2px solid ${theme.fg.accent}`);
  });
});

describe("FILE_GRID_CSS — range tint", () => {
  it("paints the accent-range tint per-side on gutter, symbol, and cell (#226)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row-gutter.in-range");
    expect(FILE_GRID_CSS).toContain(".tour-row-symbol.in-range");
    expect(FILE_GRID_CSS).toContain(".tour-row-cell.in-range");
    expect(FILE_GRID_CSS).toContain(theme.bg.accentRange.web);
  });

  it("scopes the 3px accent stripe to the leftmost tinted gutter (#226)", () => {
    // The stripe className is added only to the gutter of the leftmost
    // tinted side — never to a non-gutter cell, never on a non-stripe
    // gutter. The renderer chooses which gutter wears the class.
    expect(FILE_GRID_CSS).toContain(".tour-row-gutter.in-range-stripe");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter\.in-range-stripe[^{]*\{[^}]*box-shadow:\s*inset\s+3px\s+0\s+0/,
    );
  });

  it("does NOT key the range tint on the row container (split layout would otherwise span both sides) (#226)", () => {
    // Sanity check that the row-level rule from before #226 is gone — the
    // tint must be per-cell, not row-wide, so split layout can scope it.
    expect(FILE_GRID_CSS).not.toMatch(/\.tour-row\.in-range\b/);
  });
});

describe("FILE_GRID_CSS — hunk-header banner (#223)", () => {
  it("paints the banner background with the accent-subtle token", () => {
    expect(FILE_GRID_CSS).toContain(".tour-hunk-header");
    expect(FILE_GRID_CSS).toContain(theme.bg.accentSubtle.web);
    // The rule itself must apply the accent-subtle background.
    const rule = FILE_GRID_CSS.match(
      /\.tour-hunk-header\s*\{[^}]*\}/,
    )?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain(`background-color: ${theme.bg.accentSubtle.web}`);
  });

  it("adds vertical padding so banners read as section dividers", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-hunk-header[^{]*\{[^}]*padding:\s*\d+px\s+\d+px/,
    );
  });

  it("overrides .tour-row's `display: grid` so banner text flows inline", () => {
    // Without this override the two text segments slot into the subgrid's
    // gutter/symbol tracks and force-wrap inside the narrow auto columns.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-hunk-header[^{]*\{[^}]*display:\s*block/,
    );
  });

  it("keeps the banner clickable (cursor: pointer)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-hunk-header[^{]*\{[^}]*cursor:\s*pointer/,
    );
  });

  it("paints the range segment in the muted foreground color", () => {
    expect(FILE_GRID_CSS).toContain(".tour-hunk-header-range");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-hunk-header-range[^{]*\{[^}]*color:\s*#9198a1/i,
    );
  });

  it("paints the context segment in the default foreground color", () => {
    expect(FILE_GRID_CSS).toContain(".tour-hunk-header-context");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-hunk-header-context[^{]*\{[^}]*color:\s*#f0f6fc/i,
    );
  });
});

describe("FILE_GRID_CSS — interactive row banner (#224)", () => {
  it("paints the banner background with the neutral-subtle token (distinct from hunk-header accent)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row-interactive");
    expect(FILE_GRID_CSS).toContain(theme.bg.neutralSubtle.web);
    const rule = FILE_GRID_CSS.match(
      /\.tour-row-interactive\s*\{[^}]*\}/,
    )?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain(`background-color: ${theme.bg.neutralSubtle.web}`);
  });

  it("adds vertical padding so banners read as section dividers", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-interactive[^{]*\{[^}]*padding:\s*\d+px\s+\d+px/,
    );
  });

  it("overrides .tour-row's `display: grid` so banner glyph centers instead of slotting into the gutter track", () => {
    // Without this override the .tour-row-glyph child auto-places into the
    // narrow leftmost subgrid track (gutter-L) and reads as a small button-y
    // blob, not as a centered section divider. Same defensive lesson as the
    // hunk header fix in commit c13a598.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-interactive[^{]*\{[^}]*display:\s*block/,
    );
  });

  it("keeps the banner clickable (cursor: pointer)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-interactive[^{]*\{[^}]*cursor:\s*pointer/,
    );
  });

  it("centers the glyph horizontally", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-interactive[^{]*\{[^}]*text-align:\s*center/,
    );
  });

  it("paints the glyph in the muted foreground color", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-interactive[^{]*\{[^}]*color:\s*#9198a1/i,
    );
  });
});

describe("FILE_GRID_CSS — sticky file header", () => {
  it("retargets the sticky-header rule onto the new file-block surface", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-header");
    expect(FILE_GRID_CSS).toContain("position: sticky");
    expect(FILE_GRID_CSS).toContain("top: 0");
  });
});

describe("FILE_GRID_CSS — GitHub-style header chrome (#225)", () => {
  it("declares the header as a flex row", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-header[^{]*\{[^}]*display:\s*flex/,
    );
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-header[^{]*\{[^}]*align-items:\s*center/,
    );
  });

  it("declares left and right region containers", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-header-left");
    expect(FILE_GRID_CSS).toContain(".tour-file-header-right");
  });

  it("colors the status icon with the success token for added files", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-status-icon.added");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-status-icon\.added[^{]*\{[^}]*color:\s*#3fb950/i,
    );
  });

  it("colors the status icon with the danger token for deleted files", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-status-icon.deleted");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-status-icon\.deleted[^{]*\{[^}]*color:\s*#f85149/i,
    );
  });

  it("mutes the status icon by default (modified / renamed inherit fg.muted)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-status-icon[^{.]*\{[^}]*color:\s*#9198a1/i,
    );
  });

  it("declares a copy button with a hover affordance", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-copy-button");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-copy-button[^{]*\{[^}]*cursor:\s*pointer/,
    );
    expect(FILE_GRID_CSS).toContain(".tour-file-copy-button:hover");
  });
});

describe("FILE_GRID_CSS — file diff-stats indicator (#228)", () => {
  it("declares the stats container as an inline-flex row with tabular numerals", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats[^{}]*\{[^}]*display:\s*inline-flex/,
    );
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats[^{}]*\{[^}]*font-variant-numeric:\s*tabular-nums/,
    );
  });

  it("declares the bar container so the 5 segments share a flex row", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-bar");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-bar[^{}]*\{[^}]*display:\s*inline-flex/,
    );
  });

  it("defaults each segment to the muted border token (neutral fill)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-segment");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-segment[^{.]*\{[^}]*background-color:\s*#2f3742/i,
    );
  });

  it("paints additions segments with the success token", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-segment.added");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-segment\.added[^{]*\{[^}]*background-color:\s*#3fb950/i,
    );
  });

  it("paints deletions segments with the danger token", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-segment.deleted");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-segment\.deleted[^{]*\{[^}]*background-color:\s*#f85149/i,
    );
  });

  it("colors the +N count text with the success token", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-count.added");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-count\.added[^{]*\{[^}]*color:\s*#3fb950/i,
    );
  });

  it("colors the -M count text with the danger token", () => {
    expect(FILE_GRID_CSS).toContain(".tour-file-stats-count.deleted");
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-stats-count\.deleted[^{]*\{[^}]*color:\s*#f85149/i,
    );
  });
});

describe("FILE_GRID_CSS — comment-affordance pointer", () => {
  it("paints the click affordance on annotatable diff lines", () => {
    expect(FILE_GRID_CSS).toContain("cursor: pointer");
  });
});

describe("FILE_GRID_CSS — empty-side neutral fill (#227)", () => {
  it("paints the canvas-inset fill on the empty-side gutter of a split-layout row", () => {
    // <Column> emits `data-line-number=""` when lineNumber is null, so the
    // selector matches the three empty-side cells without prop-surface change.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-file-block\[data-layout="split"\][^{}]*\.tour-row-gutter\[data-line-number=""\][^{]*\{[^}]*background-color:\s*#010409/i,
    );
  });

  it("paints the canvas-inset fill on the empty-side symbol (adjacent-sibling of the empty gutter)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter\[data-line-number=""\]\s*\+\s*\.tour-row-symbol/,
    );
  });

  it("paints the canvas-inset fill on the empty-side code cell (sibling chain past the symbol)", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-gutter\[data-line-number=""\]\s*\+\s*\.tour-row-symbol\s*\+\s*\.tour-row-cell/,
    );
  });

  it("scopes the fill to split layout only — unified-layout rows have a non-null gutter, so the selector keys on [data-layout=\"split\"]", () => {
    // Sanity check that the rule sits under the split-layout file-block
    // selector and doesn't leak into unified-layout rows.
    const splitScoped = FILE_GRID_CSS.match(
      /\.tour-file-block\[data-layout="split"\][^{}]*\.tour-row-gutter\[data-line-number=""\][^}]*\}/,
    );
    expect(splitScoped).toBeTruthy();
  });

  it("uses the canvas.inset token (≈6% darker than canvas.default)", () => {
    expect(FILE_GRID_CSS).toContain(theme.canvas.inset);
    // The empty-side fill rule itself references canvas.inset.
    expect(FILE_GRID_CSS).toMatch(
      /\[data-line-number=""\][\s\S]*?background-color:\s*#010409/i,
    );
  });

  it("steps aside for .in-range so the range tint still wins on degenerate empty-side-in-range cells", () => {
    // AC8: per-cell range tint takes precedence over the neutral fill when
    // both apply. Implemented via :not(.in-range) on the empty-side rule so
    // the in-range selector paints unopposed.
    expect(FILE_GRID_CSS).toMatch(
      /\[data-line-number=""\][^{]*:not\(\.in-range\)/,
    );
  });
});

describe("FILE_GRID_CSS — gutter + symbol + code typography unified (#241)", () => {
  // Pre-#241 only `.tour-row-code` carried font / size declarations. The
  // gutter + symbol cells inherited the body's sans-serif font and the
  // browser-computed `line-height: normal` (≈1.2× font-size). Result:
  // line numbers rendered in proportional-width sans-serif at 16px while
  // code rendered in monospace at 12px, and the gutter's content-dependent
  // line-height drifted out of vertical rhythm with the code cell on
  // wrapped rows. Issue #241 unifies font-family / font-size / line-height
  // across `.tour-row-gutter`, `.tour-row-symbol`, and `.tour-row-code` to
  // match GitHub's empirical default (monospace 12px / line-height 20px on
  // both gutter and code).

  // Helper: extract the body of a CSS rule by selector. The rule body is
  // the text between the matched selector's `{` and the matching `}`.
  const ruleBody = (selector: string): string => {
    // Escape the selector for use in a regex literal (only chars that
    // appear in the selectors we test for).
    const escaped = selector.replace(/[-.]/g, (c) => `\\${c}`);
    const match = FILE_GRID_CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return match?.[1] ?? "";
  };

  it("renders the line-number gutter in a monospace font", () => {
    expect(ruleBody(".tour-row-gutter")).toMatch(
      /font-family:[^;]*monospace/,
    );
  });

  it("sets the gutter font-size to 12px so the gutter scale matches the code", () => {
    expect(ruleBody(".tour-row-gutter")).toMatch(/font-size:\s*12px/);
  });

  it("sets a fixed gutter line-height of 20px (not `normal`) for consistent vertical rhythm", () => {
    expect(ruleBody(".tour-row-gutter")).toMatch(/line-height:\s*20px/);
  });

  it("renders the symbol column in the same monospace font as the gutter + code", () => {
    expect(ruleBody(".tour-row-symbol")).toMatch(
      /font-family:[^;]*monospace/,
    );
  });

  it("sets the symbol font-size to 12px", () => {
    expect(ruleBody(".tour-row-symbol")).toMatch(/font-size:\s*12px/);
  });

  it("sets a fixed symbol line-height of 20px", () => {
    expect(ruleBody(".tour-row-symbol")).toMatch(/line-height:\s*20px/);
  });

  it("sets a fixed code line-height of 20px so wrapped rows share the gutter's vertical rhythm", () => {
    expect(ruleBody(".tour-row-code")).toMatch(/line-height:\s*20px/);
  });

  it("uses the identical font-family stack on .tour-row-gutter, .tour-row-symbol, and .tour-row-code", () => {
    const family = (selector: string): string | undefined => {
      const m = ruleBody(selector).match(/font-family:\s*([^;]+);/);
      return m?.[1].trim();
    };
    const gutter = family(".tour-row-gutter");
    const symbol = family(".tour-row-symbol");
    const code = family(".tour-row-code");
    expect(gutter).toBeTruthy();
    expect(symbol).toBe(gutter);
    expect(code).toBe(gutter);
  });

  it("preserves the existing gutter chrome (text-align: right, color, padding, user-select)", () => {
    // Regression sentinel: the new font / size / line-height declarations
    // are additive — the pre-#241 layout / color / interaction rules on
    // the gutter must remain.
    const body = ruleBody(".tour-row-gutter");
    expect(body).toMatch(/text-align:\s*right/);
    expect(body).toMatch(/color:\s*#9198a1/i);
    expect(body).toMatch(/padding:\s*0\s+\d+px/);
    expect(body).toMatch(/user-select:\s*none/);
  });
});

describe("FILE_GRID_CSS — code cell typography (#240, was #239)", () => {
  // The pre-Pierre-cutover renderer relied on Pierre's <pre> wrapper to give
  // diff-row code cells `font-family: monospace` + `white-space: pre`. After
  // the cutover (#220) the Tour-owned `<span class="tour-row-code">` wrapper
  // inherited the body's sans-serif font and `white-space: normal`, so every
  // line of code rendered with collapsed indentation, word-wrapped at the
  // cell edge, and proportional character widths. The #239 fix re-instated
  // monospace + preserved whitespace via Path A (`white-space: pre` + per-cell
  // `overflow-x: auto`), but the resulting per-cell horizontal scrollbars
  // read as visually broken — every long line got its own scrollbar, two
  // per row in split layout (#240). Issue #240 switches to Path B: soft-wrap
  // long lines via `white-space: pre-wrap` + `word-break: break-all`; the
  // cell's `overflow-x: auto` is dropped so wrapped continuation rows
  // expand the row vertically with no scrollbar UI. GitHub's actual default
  // is Path B.

  it("declares a .tour-row-code rule (Tour-owned replacement for Pierre's <pre> wrapper)", () => {
    expect(FILE_GRID_CSS).toContain(".tour-row-code");
  });

  it("renders the code cell in a monospace font", () => {
    // The exact stack is the agent's call; the constraint is that the
    // fallback chain ends in `monospace` so every platform resolves to a
    // monospace face.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-code[^{]*\{[^}]*font-family:[^;]*monospace/,
    );
  });

  it("soft-wraps long lines via `white-space: pre-wrap` (Path B, GitHub default)", () => {
    // Path B: long lines wrap to additional physical rows under the same
    // logical line number, instead of overflowing horizontally. `pre-wrap`
    // preserves leading + internal whitespace identically to `pre` — the
    // only behavior change is that line-breaks happen at the cell edge
    // instead of overflowing.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-code[^{]*\{[^}]*white-space:\s*pre-wrap/,
    );
  });

  it("does NOT declare `white-space: pre` (Path A would re-introduce per-cell scrollbars, #240)", () => {
    // Guard against regression to Path A. The rule must declare `pre-wrap`
    // (matched by the test above), never bare `pre`.
    expect(FILE_GRID_CSS).not.toMatch(
      /\.tour-row-code[^{]*\{[^}]*white-space:\s*pre\s*;/,
    );
  });

  it("breaks single unbroken tokens at character boundaries via `word-break: break-all` (#240)", () => {
    // Without this, a single token longer than the cell width (URL,
    // base64 blob, generated hash, minified line) would still visually
    // overflow even with `pre-wrap`.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-code[^{]*\{[^}]*word-break:\s*break-all/,
    );
  });

  it("declares a tab-size so `\\t` characters render at a sensible width", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-code[^{]*\{[^}]*tab-size:\s*\d+/,
    );
  });

  it("declares a font-size so the code cell feels like code", () => {
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-code[^{]*\{[^}]*font-size:\s*\d+px/,
    );
  });

  it("does NOT paint a per-cell horizontal scrollbar (`overflow-x: auto` was Path A, #240)", () => {
    // Path B replaces the per-cell scrollbar with soft-wrap. The
    // `.tour-row-cell` rule must NOT declare `overflow-x: auto` (the
    // previous Path A choice that produced the visually-noisy scrollbar UI).
    expect(FILE_GRID_CSS).not.toMatch(
      /\.tour-row-cell[^{]*\{[^}]*overflow-x:\s*auto/,
    );
  });

  it("keeps `min-width: 0` on .tour-row-cell so the 1fr code track can shrink below content size", () => {
    // Even with soft-wrap, `min-width: 0` is still required on grid items
    // so the 1fr code track can shrink below its `min-content` width —
    // without it the file-block can blow out past 100% width on rows
    // whose unbreakable runs (e.g. a long pasted URL with no spaces)
    // momentarily exceed the cell width before `word-break: break-all`
    // forces a character-boundary break.
    expect(FILE_GRID_CSS).toMatch(
      /\.tour-row-cell[^{]*\{[^}]*min-width:\s*0/,
    );
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
      theme.fg.success,
      theme.fg.danger,
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
