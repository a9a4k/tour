import { describe, it, expect } from "vitest";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_BORDER,
  DIFF_PANE_MIN_WIDTH,
  SIDEBAR_RESIZE_STEP,
  SIDEBAR_DEFAULT_WIDTH,
  computeAutoFitWidth,
  clampSidebarWidth,
  clampSidebarWidthManual,
} from "../../src/tui/sidebar-width.js";

// Sidebar auto-fit width (issue #312, retuned in issue #315). Computes
// the minimum sidebar box width (border included) that lets every
// visible row render without middle-truncation, clamped to
// [SIDEBAR_MIN_WIDTH, max(SIDEBAR_MIN_WIDTH, terminalWidth -
// DIFF_PANE_MIN_WIDTH)]. The diff-floor formula replaces the prior
// percentage cap (`floor(terminalWidth * 0.4)`) so the cap derives
// from a defensible minimum diff width rather than an arbitrary
// fraction. MIN floor still wins over the cap when they collide
// (narrow terminals). Empty row lists fall back to
// SIDEBAR_DEFAULT_WIDTH (also clamped). `clampSidebarWidthManual` is
// the wider clamp used by the `[`/`]` resize keys — its cap is
// `terminalWidth - SIDEBAR_MIN_WIDTH`, letting the user push past
// the auto-fit cap and squeeze the diff down to its own hard floor.

function folder(
  overrides: Partial<Extract<VisibleRow<DiffFile>, { kind: "folder" }>> = {},
): Extract<VisibleRow<DiffFile>, { kind: "folder" }> {
  return {
    kind: "folder",
    path: "src",
    displayName: "src",
    depth: 0,
    hasChildren: true,
    commentCount: 0,
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
    commentCount: 0,
    ...overrides,
  };
}

const NO_STATS = { additions: 0, deletions: 0 };
const noStats = () => NO_STATS;

describe("constants", () => {
  it("exposes the documented defaults", () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(24);
    expect(SIDEBAR_BORDER).toBe(2);
    expect(DIFF_PANE_MIN_WIDTH).toBe(60);
    expect(SIDEBAR_RESIZE_STEP).toBe(2);
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(30);
  });
});

describe("clampSidebarWidth", () => {
  it("returns the input when it sits inside [MIN, terminalWidth - DIFF_PANE_MIN_WIDTH]", () => {
    // termW=100 → cap=100-60=40. 30 fits in [24, 40].
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

  it("MIN wins when the diff-floor cap collapses below MIN (narrow terminal)", () => {
    // termW=80 → cap=80-60=20 < MIN=24. MIN wins; any input clamps to 24.
    expect(clampSidebarWidth(30, 80)).toBe(24);
    expect(clampSidebarWidth(20, 80)).toBe(24);
    expect(clampSidebarWidth(0, 80)).toBe(24);
  });

  it("uses terminalWidth - DIFF_PANE_MIN_WIDTH for the cap", () => {
    // termW=117 (reproduction case from issue #315) → cap=57.
    // The depth-5 row with `get-block-answer-grpc.controller.ts` (54
    // cols of content) fits without the user touching `]`.
    expect(clampSidebarWidth(54, 117)).toBe(54);
    expect(clampSidebarWidth(70, 117)).toBe(57);
    // termW=200 → cap=140.
    expect(clampSidebarWidth(40, 200)).toBe(40);
    expect(clampSidebarWidth(150, 200)).toBe(140);
  });
});

describe("clampSidebarWidthManual", () => {
  it("returns the input when it sits inside [MIN, terminalWidth - SIDEBAR_MIN_WIDTH]", () => {
    // termW=100 → manual cap=100-24=76.
    expect(clampSidebarWidthManual(50, 100)).toBe(50);
    expect(clampSidebarWidthManual(76, 100)).toBe(76);
  });

  it("clamps below MIN up to MIN", () => {
    expect(clampSidebarWidthManual(10, 100)).toBe(24);
    expect(clampSidebarWidthManual(0, 100)).toBe(24);
  });

  it("clamps above the manual cap down to the manual cap", () => {
    // termW=117 → manual cap=117-24=93. The user can push well past
    // the auto-fit cap (57) and squeeze the diff down to its own
    // hard floor.
    expect(clampSidebarWidthManual(120, 117)).toBe(93);
    expect(clampSidebarWidthManual(9999, 117)).toBe(93);
  });

  it("MIN wins when the manual cap collapses below MIN (very narrow terminal)", () => {
    // termW=40 → manual cap=40-24=16 < MIN=24. MIN wins.
    expect(clampSidebarWidthManual(30, 40)).toBe(24);
    expect(clampSidebarWidthManual(20, 40)).toBe(24);
  });

  it("manual cap is strictly wider than auto-fit cap when both are non-degenerate", () => {
    // termW=117 → auto cap=57, manual cap=93. Manual > auto.
    // termW=200 → auto cap=140, manual cap=176. Manual > auto.
    for (const termW of [100, 117, 150, 200, 300]) {
      const autoCap = clampSidebarWidth(9999, termW);
      const manualCap = clampSidebarWidthManual(9999, termW);
      expect(manualCap).toBeGreaterThan(autoCap);
    }
  });

  it("lets `]` push past the auto-fit cap in the reproduction case", () => {
    // Reproduction: termW=117, auto-fit cap = 57.
    // After auto-fit settles at e.g. 46, pressing `]` step-by-step
    // walks past 57 without clamping (until the manual cap of 93).
    // Simulate the step-by-step push:
    let width = clampSidebarWidth(46, 117);
    expect(width).toBe(46);
    for (let i = 0; i < 30; i++) {
      width = clampSidebarWidthManual(width + SIDEBAR_RESIZE_STEP, 117);
    }
    expect(width).toBe(93);
  });
});

describe("computeAutoFitWidth", () => {
  it("returns SIDEBAR_DEFAULT_WIDTH (clamped) when row list is empty", () => {
    expect(computeAutoFitWidth([], noStats, 200)).toBe(30);
  });

  it("clamps the empty-row default down on a narrow terminal", () => {
    // termW=80 → cap=80-60=20 < MIN=24. Default 30 collapses to 24.
    expect(computeAutoFitWidth([], noStats, 80)).toBe(24);
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
    // depth=4, displayName="ai-moderator-service" (20 chars).
    // folderRowFixedCost = 1 + 4 + 2 + 1 = 8.
    // Content = 8 + 20 = 28. Sidebar = 28 + 2 = 30. termW=200 → cap=140.
    // 30 sits in [24, 140] → 30.
    const rows = [folder({ displayName: "ai-moderator-service", depth: 4 })];
    expect(computeAutoFitWidth(rows, noStats, 200)).toBe(30);
  });

  it("caps the result at terminalWidth - DIFF_PANE_MIN_WIDTH when the longest row exceeds it", () => {
    // Very long folder name to force overflow.
    // termW=100 → cap=40. A name that forces content > 40.
    const rows = [folder({ displayName: "a".repeat(80), depth: 0 })];
    expect(computeAutoFitWidth(rows, noStats, 100)).toBe(40);
  });

  it("solves the issue #315 reproduction (depth-5 row, 117-col terminal)", () => {
    // Reproduction filename `get-block-answer-grpc.controller.ts` is
    // 35 chars at depth 5. Per the screenshot in the issue, the row
    // carries `+58` additions and a `[2]` comment badge — both
    // contribute to the fixed cost and must be included so the test
    // exercises the real-world width, not a stripped-down hypothetical.
    //
    // fileRowFixedCost = LEADING(1) + 1*5 + ICON_AND_SPACE(2)
    //   + ` +58`(4) + ` [2]`(4) + TRAILING(1) = 17.
    // Content = 17 + 35 = 52. Sidebar = 52 + 2 = 54. Cap on termW=117
    // is 117-60=57. 54 < 57 → 54 (auto-fit picks 54, fits without
    // truncation). Tightens the brief's claim ("solves the reproduction
    // case without manual intervention") against the actual row state.
    const stats = { additions: 58, deletions: 0 };
    const rows = [
      file({
        displayName: "get-block-answer-grpc.controller.ts",
        depth: 5,
        commentCount: 2,
      }),
    ];
    expect(computeAutoFitWidth(rows, () => stats, 117)).toBe(54);
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
    // Content = 12 + 36 = 48. Sidebar = 50. termW=200 → cap=140. 50.
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
    // termW=80 → cap=20 < MIN=24. Any row width clamps to MIN.
    const rows = [folder({ displayName: "a".repeat(200), depth: 0 })];
    expect(computeAutoFitWidth(rows, noStats, 80)).toBe(24);
  });
});
