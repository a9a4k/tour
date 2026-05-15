// Unit-agnostic scalar clamps for sidebar / diff-pane width math
// (issue #328). Per-surface modules supply their own unit constants
// (cols vs. px) and own their `computeAutoFitWidth*` helpers, which
// couple to per-surface row-cost helpers.
//
//   * `clampPaneWidth(width, container, softMin, hardMin)` — auto-fit
//     range `[hardMin, max(hardMin, container - softMin)]`. `softMin`
//     reserves a readability floor for the other pane; the auto-fit
//     path cannot squeeze it past this floor.
//
//   * `clampPaneWidthManual(width, container, hardMin)` — drag /
//     keypress range `[hardMin, max(hardMin, container - hardMin)]`.
//     An explicit user gesture honors only the symmetric hard floor;
//     the other pane can be squeezed below its readability floor.
//
// `hardMin` wins over the upper cap when they collide (degenerate
// narrow-container case). No platform imports.

export function clampPaneWidth(
  width: number,
  container: number,
  softMin: number,
  hardMin: number,
): number {
  const cap = Math.max(hardMin, container - softMin);
  return Math.max(hardMin, Math.min(cap, width));
}

export function clampPaneWidthManual(
  width: number,
  container: number,
  hardMin: number,
): number {
  const cap = Math.max(hardMin, container - hardMin);
  return Math.max(hardMin, Math.min(cap, width));
}
