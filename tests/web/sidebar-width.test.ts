import { describe, it, expect } from "vitest";
import type { BundleFile } from "../../src/web/client/types.js";
import type { VisibleRow } from "../../src/core/file-tree.js";
import {
  SIDEBAR_MIN_PX,
  SIDEBAR_DEFAULT_PX,
  DIFF_PANE_MIN_PX,
  SIDEBAR_CHAR_PX,
  clampSidebarWidthPx,
  clampSidebarWidthManualPx,
  computeAutoFitWidthPx,
  fileRowFixedPx,
  folderRowFixedPx,
} from "../../src/web/client/sidebar-width.js";

// Web sidebar width math (issue #323). Pixel-based mirror of the TUI's
// `sidebar-width.test.ts`. The auto-fit clamp reserves DIFF_PANE_MIN_PX
// for the diff pane; the manual clamp reserves only SIDEBAR_MIN_PX
// (lets the drag handle squeeze the diff past the auto-fit floor).

function folder(
  overrides: Partial<Extract<VisibleRow<BundleFile>, { kind: "folder" }>> = {},
): Extract<VisibleRow<BundleFile>, { kind: "folder" }> {
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
  overrides: Partial<Extract<VisibleRow<BundleFile>, { kind: "file" }>> = {},
): Extract<VisibleRow<BundleFile>, { kind: "file" }> {
  const f: BundleFile = {
    name: overrides.path ?? "src/a.ts",
    type: "change",
    hunks: [],
    classification: { collapsed: false },
    orphanWindows: [],
  };
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

describe("constants", () => {
  it("exposes the documented defaults", () => {
    expect(SIDEBAR_MIN_PX).toBe(240);
    expect(SIDEBAR_DEFAULT_PX).toBe(280);
    expect(DIFF_PANE_MIN_PX).toBe(600);
  });
});

describe("clampSidebarWidthPx (auto-fit clamp)", () => {
  it("returns the input when inside [MIN, viewportWidth - DIFF_PANE_MIN_PX]", () => {
    // vw=1200 → cap = 1200 - 600 = 600. 400 fits in [240, 600].
    expect(clampSidebarWidthPx(400, 1200)).toBe(400);
  });

  it("clamps below MIN up to MIN", () => {
    expect(clampSidebarWidthPx(100, 1200)).toBe(240);
    expect(clampSidebarWidthPx(0, 1200)).toBe(240);
  });

  it("clamps above the auto-fit cap down to the cap", () => {
    // vw=1200 → cap=600.
    expect(clampSidebarWidthPx(800, 1200)).toBe(600);
    expect(clampSidebarWidthPx(9999, 1200)).toBe(600);
  });

  it("MIN wins when the diff-floor cap collapses below MIN (very narrow viewport)", () => {
    // vw=800 → cap=800-600=200 < MIN=240. MIN wins.
    expect(clampSidebarWidthPx(500, 800)).toBe(240);
    expect(clampSidebarWidthPx(100, 800)).toBe(240);
  });
});

describe("clampSidebarWidthManualPx (drag clamp)", () => {
  it("returns the input when inside [MIN, viewportWidth - SIDEBAR_MIN_PX]", () => {
    // vw=1200 → manual cap = 1200 - 240 = 960.
    expect(clampSidebarWidthManualPx(700, 1200)).toBe(700);
    expect(clampSidebarWidthManualPx(960, 1200)).toBe(960);
  });

  it("clamps below MIN up to MIN", () => {
    expect(clampSidebarWidthManualPx(100, 1200)).toBe(240);
    expect(clampSidebarWidthManualPx(0, 1200)).toBe(240);
  });

  it("clamps above the manual cap down to the manual cap", () => {
    // vw=1200 → manual cap=960. Drag can push to but not past 960.
    expect(clampSidebarWidthManualPx(1100, 1200)).toBe(960);
    expect(clampSidebarWidthManualPx(9999, 1200)).toBe(960);
  });

  it("MIN wins when the manual cap collapses below MIN (very narrow viewport)", () => {
    // vw=400 → manual cap=400-240=160 < MIN=240. MIN wins.
    expect(clampSidebarWidthManualPx(300, 400)).toBe(240);
    expect(clampSidebarWidthManualPx(200, 400)).toBe(240);
  });

  it("manual cap is strictly wider than auto-fit cap when both are non-degenerate", () => {
    // The drag handle's job is to let the user push past the auto-fit cap;
    // if the manual cap weren't strictly wider, the drag would clamp at
    // the same width auto-fit picked.
    for (const vw of [1200, 1500, 1800, 2400]) {
      const autoCap = clampSidebarWidthPx(99999, vw);
      const manualCap = clampSidebarWidthManualPx(99999, vw);
      expect(manualCap).toBeGreaterThan(autoCap);
    }
  });
});

describe("computeAutoFitWidthPx", () => {
  it("returns SIDEBAR_DEFAULT_PX (clamped) when row list is empty", () => {
    expect(computeAutoFitWidthPx([], 1500)).toBe(280);
  });

  it("clamps the empty-row default down on a narrow viewport", () => {
    // vw=800 → cap=200 < MIN=240. Default 280 collapses to 240.
    expect(computeAutoFitWidthPx([], 800)).toBe(240);
  });

  it("fits the longest visible row exactly when it's wider than MIN", () => {
    // A long folder name at depth 3: fixed cost = 16 + 48 + 16+8+16+8+16 =
    // 128. displayName "ai-moderator-service" = 20 chars × 7.2 = 144 px.
    // Total = 128 + 144 = 272. vw=1500 → auto cap = 900. 272 < MIN=240
    // ... wait, 272 > 240, so result is 272.
    const rows = [folder({ displayName: "ai-moderator-service", depth: 3 })];
    const fixed = folderRowFixedPx(3);
    const expected = fixed + Math.ceil("ai-moderator-service".length * SIDEBAR_CHAR_PX);
    expect(computeAutoFitWidthPx(rows, 1500)).toBe(expected);
  });

  it("clamps the longest row up to MIN when it sits below the floor", () => {
    const rows = [folder({ displayName: "src", depth: 0 })];
    // Folder fixed cost at depth 0 = 16+16+8+16+8+16 = 80; "src" = 3*7.2 = 21.6→22.
    // 102 < 240 → 240.
    expect(computeAutoFitWidthPx(rows, 1500)).toBe(240);
  });

  it("caps the result at viewportWidth - DIFF_PANE_MIN_PX when row exceeds it", () => {
    // Very long name forces overflow.
    const rows = [folder({ displayName: "a".repeat(300), depth: 0 })];
    // vw=1200 → cap=600.
    expect(computeAutoFitWidthPx(rows, 1200)).toBe(600);
  });

  it("includes the annotation badge in the file-row width", () => {
    // A long-enough name to push both rows past MIN, so the badge tail
    // actually shifts the result instead of getting absorbed by the floor.
    const baseName = "a-quite-long-controller.ts";
    const without = computeAutoFitWidthPx(
      [file({ displayName: baseName, depth: 0, annotationCount: 0 })],
      2400,
    );
    const withBadge = computeAutoFitWidthPx(
      [file({ displayName: baseName, depth: 0, annotationCount: 3 })],
      2400,
    );
    expect(withBadge).toBeGreaterThan(without);
  });

  it("takes the maximum over a mixed folder + file list", () => {
    const rows = [
      folder({ displayName: "short", depth: 0 }),
      file({ displayName: "the-actual-long-file-name.controller.spec.ts", depth: 4 }),
    ];
    // The long file row should drive the width.
    const fileFixed = fileRowFixedPx(4, 0);
    const expected =
      fileFixed +
      Math.ceil("the-actual-long-file-name.controller.spec.ts".length * SIDEBAR_CHAR_PX);
    expect(computeAutoFitWidthPx(rows, 2400)).toBe(expected);
  });

  it("MIN wins over the cap on a very narrow viewport", () => {
    // vw=800 → cap=200 < MIN=240. Any row width clamps to MIN.
    const rows = [folder({ displayName: "a".repeat(400), depth: 0 })];
    expect(computeAutoFitWidthPx(rows, 800)).toBe(240);
  });

  it("auto-fits a deep-tree visible row to expose its displayName without ellipsis on vw=1500", () => {
    // Acceptance criterion: on a viewport ≥ 1200px wide, opening a deep-tree
    // tour auto-fits the sidebar wide enough that every visible row's
    // displayName renders without `text-overflow: ellipsis` clipping.
    const rows = [
      file({
        displayName: "get-block-answer-grpc.controller.ts",
        depth: 5,
        annotationCount: 2,
      }),
    ];
    const fitted = computeAutoFitWidthPx(rows, 1500);
    // The auto-fit width must be at least as wide as the fixed-cost +
    // displayName, AND strictly under the diff-floor cap so we know
    // auto-fit didn't have to clamp the row away.
    const fixed = fileRowFixedPx(5, 2);
    const nameWidth = Math.ceil("get-block-answer-grpc.controller.ts".length * SIDEBAR_CHAR_PX);
    expect(fitted).toBe(fixed + nameWidth);
    expect(fitted).toBeLessThan(1500 - DIFF_PANE_MIN_PX);
  });
});
