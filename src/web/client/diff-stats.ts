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
      // The planner emits `change` for any row in a hunk that mixes
      // adds + deletes — including new-file / deleted-file hunks where
      // one side has no content. Count each side only when it actually
      // carries a line number.
      if (row.rightLineNumber != null) additions += 1;
      if (row.leftLineNumber != null) deletions += 1;
    }
  }
  return { additions, deletions };
}

export function proportionSegments(
  additions: number,
  deletions: number,
): ProportionSegments {
  if (additions <= 0 && deletions <= 0) return { greens: 0, reds: 0, neutrals: 5 };
  if (deletions <= 0) return { greens: 5, reds: 0, neutrals: 0 };
  if (additions <= 0) return { greens: 0, reds: 5, neutrals: 0 };

  const total = additions + deletions;
  let greens = Math.max(1, Math.round((additions / total) * 5));
  let reds = Math.max(1, Math.round((deletions / total) * 5));

  while (greens + reds > 5) {
    if (greens >= reds) greens -= 1;
    else reds -= 1;
  }

  return { greens, reds, neutrals: 5 - greens - reds };
}

// Tour-level (PR-equivalent) aggregate of additions / deletions across every
// file in the loaded bundle (issue #233). Each file contributes via
// `countDiffStats(rows)`; the totals are the sum. Inherits the per-row
// `change`-shape inspection from `countDiffStats` for free — new-file rows
// count `+1`, deleted-file rows count `-1`, paired-change rows count `+1 -1`.
export function tourDiffStats(files: ReadonlyArray<{ rows: PlannedRow[] }>): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    const s = countDiffStats(f.rows);
    additions += s.additions;
    deletions += s.deletions;
  }
  return { additions, deletions };
}
