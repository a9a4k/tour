// Decision helper for the file fold-toggle (issue #316). The fold direction
// (visible -> collapsed) always writes `setOverride(true)`. The unfold
// direction (collapsed -> visible) clears the override for non-binary files
// so `isClassifierCollapsed`'s fallback re-applies the classifier verdict —
// a classifier-collapsed file returns to its synthetic-summary view (state A)
// rather than landing in explicit-reveal (state C). Binary files keep the
// explicit `setOverride(false)` on unfold since their "collapsed" default is
// anchored in `classification.reason === "binary"`; clearing the override
// would leave them folded. State C (full body on a classifier-collapsed file)
// is now reachable only via explicit-reveal gestures (Enter on the synthetic
// row, annotation nav). Mirrors the #310 / #313 factoring — gestures match
// the state mutation their name implies.
import type { FileClassification } from "./file-classifier.js";

export type FoldToggleAction =
  | { type: "folds.setOverride"; file: string; value: boolean }
  | { type: "folds.clearOverride"; file: string };

export function foldToggleAction(
  fileName: string,
  isCollapsed: boolean,
  classification: FileClassification,
): FoldToggleAction {
  if (!isCollapsed) {
    return { type: "folds.setOverride", file: fileName, value: true };
  }
  if (classification.reason === "binary") {
    return { type: "folds.setOverride", file: fileName, value: false };
  }
  return { type: "folds.clearOverride", file: fileName };
}
