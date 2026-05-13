import type { PlannedRow } from "../../core/diff-rows.js";

/**
 * Per-file diff-stats helpers for the GitHub-style file-header indicator
 * (issue #228). Pure functions over `PlannedRow[]` — no React, no DOM.
 *
 * `countDiffStats` walks the planner output and counts addition / deletion
 * contributions per diff row. Paired `change` rows count as one addition
 * AND one deletion (the row represents one deleted line replaced by one
 * added line on the same conceptual position).
 *
 * `proportionSegments` maps the counts to a 5-segment proportion bar:
 * additions get green segments, deletions red, the remainder neutral.
 * Rounding can push the round-trip over 5 (e.g. 1+1 → 3+3=6); the helper
 * subtracts from the larger count first to bring the sum back to 5.
 */

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface ProportionSegments {
  greens: number;
  reds: number;
  neutrals: number;
}

export function countDiffStats(rows: PlannedRow[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    if (row.kind !== "diff-row") continue;
    if (row.type === "addition") additions += 1;
    else if (row.type === "deletion") deletions += 1;
    else if (row.type === "change") {
      additions += 1;
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export function proportionSegments(
  additions: number,
  deletions: number,
): ProportionSegments {
  const total = additions + deletions;
  if (total <= 0) return { greens: 0, reds: 0, neutrals: 5 };

  let greens = Math.round((additions / total) * 5);
  let reds = Math.round((deletions / total) * 5);

  if (additions > 0 && greens === 0) greens = 1;
  if (deletions > 0 && reds === 0) reds = 1;
  if (deletions === 0) greens = 5;
  if (additions === 0) reds = 5;

  while (greens + reds > 5) {
    if (greens >= reds) greens -= 1;
    else reds -= 1;
  }

  const neutrals = 5 - greens - reds;
  return { greens, reds, neutrals };
}
