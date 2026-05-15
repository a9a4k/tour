// Unit-agnostic scalar clamps for sidebar / diff-pane width math
// (issue #328). Lifted from `src/tui/sidebar-width.ts` and
// `src/web/client/sidebar-width.ts`, both of which used to inline the
// same formula in different units (cols vs. pixels). The surface-
// specific modules keep their unit constants and `computeAutoFitWidth*`
// helpers (which couple to per-surface row-cost helpers); only the two
// scalar clamps lift to core so any future change to the shape — e.g. a
// soft warning ceiling or a hysteresis band — is applied once rather
// than twice.
//
//   * `clampPaneWidth(width, container, softMin, hardMin)` — auto-fit
//     range `[hardMin, max(hardMin, container - softMin)]`. `softMin`
//     reserves a readability floor for the other pane. The auto-fit
//     path cannot squeeze the other pane past this floor.
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
