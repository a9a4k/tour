import { describe, it, expect } from "vitest";
import {
  clampPaneWidth,
  clampPaneWidthManual,
} from "../../src/core/sidebar-width-clamp.js";

// Tests for the unit-agnostic scalar clamps (issue #328). The
// surface-specific test files cover per-unit call sites; this file
// pins the generic shape.

describe("clampPaneWidth (auto-fit clamp)", () => {
  it("returns the input when inside [hardMin, container - softMin]", () => {
    // container=100, softMin=60, hardMin=24 → cap=40. 30 fits in [24, 40].
    expect(clampPaneWidth(30, 100, 60, 24)).toBe(30);
  });

  it("clamps below hardMin up to hardMin", () => {
    expect(clampPaneWidth(10, 100, 60, 24)).toBe(24);
    expect(clampPaneWidth(0, 100, 60, 24)).toBe(24);
  });

  it("clamps above (container - softMin) down to that cap", () => {
    expect(clampPaneWidth(50, 100, 60, 24)).toBe(40);
    expect(clampPaneWidth(9999, 100, 60, 24)).toBe(40);
  });

  it("hardMin wins when (container - softMin) collapses below hardMin", () => {
    // container=80, softMin=60 → cap=20 < hardMin=24. Any input clamps to 24.
    expect(clampPaneWidth(30, 80, 60, 24)).toBe(24);
    expect(clampPaneWidth(20, 80, 60, 24)).toBe(24);
    expect(clampPaneWidth(0, 80, 60, 24)).toBe(24);
  });

  it("matches the TUI cols call (softMin=60, hardMin=24)", () => {
    // termW=117 → cap=57. Reproduction case from issue #315.
    expect(clampPaneWidth(54, 117, 60, 24)).toBe(54);
    expect(clampPaneWidth(70, 117, 60, 24)).toBe(57);
  });

  it("matches the web px call (softMin=600, hardMin=240)", () => {
    // vw=1200 → cap=600.
    expect(clampPaneWidth(400, 1200, 600, 240)).toBe(400);
    expect(clampPaneWidth(800, 1200, 600, 240)).toBe(600);
    expect(clampPaneWidth(100, 1200, 600, 240)).toBe(240);
  });
});

describe("clampPaneWidthManual (drag clamp)", () => {
  it("returns the input when inside [hardMin, container - hardMin]", () => {
    // container=100, hardMin=24 → manual cap=76.
    expect(clampPaneWidthManual(50, 100, 24)).toBe(50);
    expect(clampPaneWidthManual(76, 100, 24)).toBe(76);
  });

  it("clamps below hardMin up to hardMin", () => {
    expect(clampPaneWidthManual(10, 100, 24)).toBe(24);
    expect(clampPaneWidthManual(0, 100, 24)).toBe(24);
  });

  it("clamps above (container - hardMin) down to that cap", () => {
    // container=117, hardMin=24 → manual cap=93.
    expect(clampPaneWidthManual(120, 117, 24)).toBe(93);
    expect(clampPaneWidthManual(9999, 117, 24)).toBe(93);
  });

  it("hardMin wins when (container - hardMin) collapses below hardMin", () => {
    // container=40, hardMin=24 → manual cap=16 < hardMin=24. hardMin wins.
    expect(clampPaneWidthManual(30, 40, 24)).toBe(24);
    expect(clampPaneWidthManual(20, 40, 24)).toBe(24);
  });

  it("matches the web px call (hardMin=240)", () => {
    // vw=1200 → manual cap=960.
    expect(clampPaneWidthManual(700, 1200, 240)).toBe(700);
    expect(clampPaneWidthManual(1100, 1200, 240)).toBe(960);
    expect(clampPaneWidthManual(100, 1200, 240)).toBe(240);
  });
});

describe("manual cap vs auto-fit cap", () => {
  it("manual cap is strictly wider than auto-fit cap when both are non-degenerate", () => {
    // The drag affordance only matters if the user can push past the
    // auto-fit cap; the lift must preserve this invariant for both
    // surfaces.
    for (const container of [100, 117, 150, 200, 300]) {
      const autoCap = clampPaneWidth(9999, container, 60, 24);
      const manualCap = clampPaneWidthManual(9999, container, 24);
      expect(manualCap).toBeGreaterThan(autoCap);
    }
    for (const container of [1200, 1500, 1800, 2400]) {
      const autoCap = clampPaneWidth(99999, container, 600, 240);
      const manualCap = clampPaneWidthManual(99999, container, 240);
      expect(manualCap).toBeGreaterThan(autoCap);
    }
  });
});
