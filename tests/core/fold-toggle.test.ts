import { describe, it, expect } from "vitest";
import { foldToggleAction } from "../../src/core/fold-toggle.js";
import type { FileClassification } from "../../src/core/file-classifier.js";

// Issue #316: the fold-toggle's three branches.
//
// - Fold (visible -> collapsed): setOverride(true). Same for every file.
// - Unfold non-binary: clearOverride. Drops the entry; `isClassifierCollapsed`
//   falls back to the classifier verdict (state A for classifier-collapsed
//   files, state A === body for non-classifier files).
// - Unfold binary: setOverride(false). Binary's "collapsed" default lives
//   in the classifier, so clearing would leave the file folded.
describe("foldToggleAction (issue #316)", () => {
  const NON_CLASSIFIER: FileClassification = { collapsed: false };
  const CLASSIFIER_COLLAPSED: FileClassification = {
    collapsed: true,
    reason: "generated",
  };
  const BINARY: FileClassification = { collapsed: true, reason: "binary" };

  it("fold direction (not collapsed -> collapsed) writes setOverride(true) for non-classifier", () => {
    expect(foldToggleAction("src/foo.ts", false, NON_CLASSIFIER)).toEqual({
      type: "folds.setOverride",
      file: "src/foo.ts",
      value: true,
    });
  });

  it("fold direction writes setOverride(true) for classifier-collapsed files too", () => {
    // When a user explicitly revealed (state C, override=false) a classifier-
    // collapsed file then re-folds it, the toggle still writes
    // setOverride(true) — the file becomes manually folded (state B).
    expect(foldToggleAction("bun.lock", false, CLASSIFIER_COLLAPSED)).toEqual({
      type: "folds.setOverride",
      file: "bun.lock",
      value: true,
    });
  });

  it("unfold direction on a non-binary file clears the override (restores classifier-default)", () => {
    // The load-bearing case: classifier-collapsed file that was manually
    // folded, then unfolded. The override is removed; the file returns to
    // the classifier's synthetic-summary view (state A), NOT the full body
    // (state C, which is reached only via explicit-reveal gestures).
    expect(foldToggleAction("bun.lock", true, CLASSIFIER_COLLAPSED)).toEqual({
      type: "folds.clearOverride",
      file: "bun.lock",
    });
  });

  it("unfold direction on a non-classifier file also clears the override (falls back to body)", () => {
    // Non-classifier files: state A === state C === body. Clear-on-unfold
    // keeps the override map tidy and uniform across file types.
    expect(foldToggleAction("src/foo.ts", true, NON_CLASSIFIER)).toEqual({
      type: "folds.clearOverride",
      file: "src/foo.ts",
    });
  });

  it("unfold direction on a binary file writes setOverride(false), not clearOverride", () => {
    // Binary's default-collapsed lives in `classification.reason === "binary"`.
    // Clearing the override would re-collapse the file (the classifier default
    // would re-apply). The explicit setOverride(false) is the only way to
    // bypass the binary default and keep the file shown.
    expect(foldToggleAction("logo.png", true, BINARY)).toEqual({
      type: "folds.setOverride",
      file: "logo.png",
      value: false,
    });
  });

  it("fold direction on a binary file writes setOverride(true) (toggle cycles correctly)", () => {
    expect(foldToggleAction("logo.png", false, BINARY)).toEqual({
      type: "folds.setOverride",
      file: "logo.png",
      value: true,
    });
  });
});
