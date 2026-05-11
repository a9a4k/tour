import type {
  BoundaryExpansion,
  BoundaryRef,
  ExpansionState,
} from "../../core/expansion-state.js";

/**
 * Bridge Pierre's runtime expansion state into Tour's `ExpansionState` so the
 * webapp's `planRows` reflects the lines Pierre has revealed (PRD #151,
 * issue #158).
 *
 * Pierre stores expansion per `FileDiff` instance as a `Map<number,
 * { fromStart, fromEnd }>` keyed by hunk index. Its iterator
 * (`node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js`) uses:
 *   - `expandedHunks[i]` for `i in [0, hunks.length)` — the LEADING gap of
 *     hunk `i` (above hunk `i`'s content).
 *   - `expandedHunks[hunks.length]` — the synthetic key for the TRAILING gap
 *     (below the last hunk, toward EOF).
 *
 * Tour's `ExpansionState` uses `BoundaryRef = number | "top" | "bottom"`:
 *   - `"top"`     — file-top gap (lines 1 to first-hunk-start).
 *   - `<number>`  — mid-file gap above the hunk at that index.
 *   - `"bottom"`  — file-bottom gap (last-hunk-end to EOF).
 *
 * Mapping:
 *   Pierre `0`                  → ExpansionState `"top"`
 *   Pierre `i` (1 ≤ i < hunks.length) → ExpansionState `i`
 *   Pierre `hunks.length`       → ExpansionState `"bottom"`
 *
 * `fromStart` (lines from the START of Pierre's gap range, lower line numbers,
 * closer to file-start / previous hunk's end / last hunk's end) → `up`.
 * `fromEnd`   (lines from the END of Pierre's gap range, higher line numbers,
 * closer to the next hunk's start / EOF) → `down`.
 */

export interface PierreFileDiffLike {
  /** Pierre's `FileDiff` class exposes `hunksRenderer` as a `protected`
   *  field; the TS type doesn't surface it but the runtime field is real.
   *  We narrow to the one accessor we need so callers can pass anything
   *  structurally compatible (and tests don't need a full Pierre stub). */
  hunksRenderer?: {
    getExpandedHunksMap?(): Map<number, { fromStart: number; fromEnd: number }>;
  };
}

export interface FileWithHunkCount {
  name: string;
  hunks: readonly unknown[];
}

export function expansionFromPierre(
  refs: Map<string, PierreFileDiffLike>,
  parsedFiles: readonly FileWithHunkCount[],
): ExpansionState {
  const out: ExpansionState = new Map();
  if (refs.size === 0) return out;

  const hunkCountByFile = new Map<string, number>();
  for (const f of parsedFiles) hunkCountByFile.set(f.name, f.hunks.length);

  for (const [file, instance] of refs) {
    const expanded = instance.hunksRenderer?.getExpandedHunksMap?.();
    if (!expanded || expanded.size === 0) continue;
    const hunkCount = hunkCountByFile.get(file) ?? 0;
    const boundaries = new Map<BoundaryRef, BoundaryExpansion>();
    for (const [hunkIndex, region] of expanded) {
      if (region.fromStart <= 0 && region.fromEnd <= 0) continue;
      const ref: BoundaryRef =
        hunkIndex === 0
          ? "top"
          : hunkIndex >= hunkCount
            ? "bottom"
            : hunkIndex;
      boundaries.set(ref, {
        up: Math.max(0, region.fromStart),
        down: Math.max(0, region.fromEnd),
      });
    }
    if (boundaries.size === 0) continue;
    out.set(file, { fileExpanded: false, boundaries });
  }
  return out;
}
