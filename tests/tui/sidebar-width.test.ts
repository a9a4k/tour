import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_BORDER,
  SIDEBAR_MAX_FRAC,
  SIDEBAR_RESIZE_STEP,
  SIDEBAR_DEFAULT_WIDTH,
  computeAutoFitWidth,
  clampSidebarWidth,
} from "../../src/tui/sidebar-width.js";

// Sidebar auto-fit width (issue #312). Computes the minimum sidebar
// box width (border included) that lets every visible row render
// without middle-truncation, clamped to [SIDEBAR_MIN_WIDTH,
// floor(terminalWidth * SIDEBAR_MAX_FRAC)]. The MIN floor wins over
// the cap when they collide (narrow terminals — workable degenerate
// case). Empty row lists fall back to SIDEBAR_DEFAULT_WIDTH (also
// clamped). `clampSidebarWidth` is exposed independently because the
// `[`/`]` resize keys reuse it against the same range.

function folder(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "folder" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "folder" }> {
  return {
    kind: "folder",
    path: "src",
    displayName: "src",
    depth: 0,
    hasChildren: true,
    annotationCount: 0,
    collapsed: false,
    ...overrides,
  };
}

function file(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "file" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "file" }> {
  const f: DiffFile = { name: "src/a.ts", type: "change", hunks: [] };
  return {
    kind: "file",
    path: "src/a.ts",
    displayName: "a.ts",
    depth: 0,
    file: f,
    annotationCount: 0,
    ...overrides,
  };
}

const NO_STATS = { additions: 0, deletions: 0 };
const noStats = () => NO_STATS;

describe("constants", () => {
  it("exposes the documented defaults", () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(24);
    expect(SIDEBAR_BORDER).toBe(2);
    expect(SIDEBAR_MAX_FRAC).toBe(0.4);
    expect(SIDEBAR_RESIZE_STEP).toBe(2);
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(30);
  });
});

describe("clampSidebarWidth", () => {
  it("returns the input when it sits inside [MIN, floor(termW * MAX_FRAC)]", () => {
    // termW=100 → cap=floor(40)=40. 30 fits in [24, 40].
    expect(clampSidebarWidth(30, 100)).toBe(30);
  });

  it("clamps below MIN up to MIN", () => {
    expect(clampSidebarWidth(10, 100)).toBe(24);
    expect(clampSidebarWidth(0, 100)).toBe(24);
  });

  it("clamps above cap down to cap", () => {
    // termW=100 → cap=40.
    expect(clampSidebarWidth(50, 100)).toBe(40);
    expect(clampSidebarWidth(9999, 100)).toBe(40);
  });

  it("MIN wins when the cap collapses below MIN (narrow terminal)", () => {
    // termW=50 → cap=floor(20)=20 < MIN=24. MIN wins; any input clamps to 24.
    expect(clampSidebarWidth(30, 50)).toBe(24);
    expect(clampSidebarWidth(20, 50)).toBe(24);
    expect(clampSidebarWidth(0, 50)).toBe(24);
  });

  it("uses floor(terminalWidth * MAX_FRAC) for the cap", () => {
    // termW=74 → floor(29.6)=29.
    expect(clampSidebarWidth(40, 74)).toBe(29);
    // termW=75 → floor(30)=30.
    expect(clampSidebarWidth(40, 75)).toBe(30);
  });
});

describe("computeAutoFitWidth", () => {
  it("returns SIDEBAR_DEFAULT_WIDTH (clamped) when row list is empty", () => {
    expect(computeAutoFitWidth([], noStats, 200)).toBe(30);
  });

  it("clamps the empty-row default down on a narrow terminal", () => {
    // termW=60 → cap=24 = MIN. Default 30 collapses to 24.
    expect(computeAutoFitWidth([], noStats, 60)).toBe(24);
  });

  it("fits the longest visible row exactly (folder, shallow tree)", () => {
    // INDENT_PER_DEPTH=1 (post-issue-312): folderRowFixedCost at
    // depth 0 = LEADING(1) + 0 + CARET_AND_SPACE(2) + TRAILING(1) = 4.
    // displayName="components" → 10 chars. Content width = 4 + 10 = 14.
    // Total = 14 + SIDEBAR_BORDER(2) = 16. Clamped up to MIN=24.
    const rows = [folder({ displayName: "components", depth: 0 })];
    expect(computeAutoFitWidth(rows, noStats, 200)).toBe(24);
  });

  it("fits exactly when the longest row exceeds MIN but stays below the cap", () => {
    // depth=2, displayName="block-answer" (12 chars).
    // folderRowFixedCost = 1 + 2 + 2 + 1 = 6.
    // Content = 6 + 12 = 18. Sidebar = 18 + 2 = 20. Below MIN → 24.
    // Bump to a longer name to land in-range:
    // depth=4, displayName="ai-moderator-service" (20 chars).
    // folderRowFixedCost = 1 + 4 + 2 + 1 = 8.
    // Content = 8 + 20 = 28. Sidebar = 28 + 2 = 30. termW=200 → cap=80.
    // 30 sits in [24, 80] → 30.
    const rows = [folder({ displayName: "ai-moderator-service", depth: 4 })];
    expect(computeAutoFitWidth(rows, noStats, 200)).toBe(30);
  });

  it("caps the result at floor(terminalWidth * MAX_FRAC) when the longest row exceeds it", () => {
    // Very long folder name to force overflow.
    // termW=100 → cap=40. A name that forces content > 40.
    const rows = [folder({ displayName: "a".repeat(80), depth: 0 })];
    expect(computeAutoFitWidth(rows, noStats, 100)).toBe(40);
  });

  it("takes the maximum over a mixed folder+file list", () => {
    // file at depth 5: fileRowFixedCost = 1 + 5 + 2 + 1 = 9 (no stats/badge).
    // displayName="a.ts" → 4. Content = 9 + 4 = 13. Sidebar = 15.
    //
    // folder at depth 0, displayName="components" → fileless cost
    // 1 + 0 + 2 + 1 + 10 = 14. Sidebar = 16.
    //
    // Both below MIN → 24.
    const rows = [
      file({ displayName: "a.ts", depth: 5 }),
      folder({ displayName: "components", depth: 0 }),
    ];
    expect(computeAutoFitWidth(rows, noStats, 200)).toBe(24);
  });

  it("includes stats segments in the file-row width", () => {
    // file at depth 0, "a.ts" with +43 -27 stats:
    // fileRowFixedCost = 1 + 0 + 2 + 4 (' +43') + 4 (' -27') + 1 = 12.
    // Content = 12 + 4 = 16. Sidebar = 18. Below MIN → 24.
    // Bump the name to land in-range:
    // displayName="evses-utilization.controller.spec.ts" (36 chars).
    // fileRowFixedCost (no stats) = 4. With stats above = 12.
    // Content = 12 + 36 = 48. Sidebar = 50. termW=200 → cap=80. 50.
    const stats = { additions: 43, deletions: 27 };
    const rows = [
      file({
        displayName: "evses-utilization.controller.spec.ts",
        depth: 0,
        file: { name: "x.ts", type: "change", hunks: [] },
      }),
    ];
    expect(computeAutoFitWidth(rows, () => stats, 200)).toBe(50);
  });

  it("MIN wins over the cap on a very narrow terminal", () => {
    // termW=50 → cap=20 < MIN=24. Any row width clamps to MIN.
    const rows = [folder({ displayName: "a".repeat(200), depth: 0 })];
    expect(computeAutoFitWidth(rows, noStats, 50)).toBe(24);
  });
});
