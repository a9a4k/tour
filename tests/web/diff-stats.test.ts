import { describe, it, expect } from "vitest";
import {
  countDiffStats,
  proportionSegments,
} from "../../src/web/client/diff-stats.js";
import type { PlannedRow } from "../../src/core/diff-rows.js";

// Pure helpers driving the GitHub-style per-file diff-stats indicator
// (#228). The renderer (`<FileBlock>`) feeds the planner's `PlannedRow[]`
// into `countDiffStats`, then the result into `proportionSegments` to
// derive the 5-segment proportion bar.

function diffRow(type: "context" | "addition" | "deletion" | "change"): PlannedRow {
  return {
    kind: "diff-row",
    type,
    leftLineNumber: type === "addition" ? null : 1,
    rightLineNumber: type === "deletion" ? null : 1,
    leftText: "",
    rightText: "",
  };
}

describe("countDiffStats (#228)", () => {
  it("returns 0/0 for an empty row stream", () => {
    expect(countDiffStats([])).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts addition rows toward additions only", () => {
    const rows = [diffRow("addition"), diffRow("addition"), diffRow("addition")];
    expect(countDiffStats(rows)).toEqual({ additions: 3, deletions: 0 });
  });

  it("counts deletion rows toward deletions only", () => {
    const rows = [diffRow("deletion"), diffRow("deletion")];
    expect(countDiffStats(rows)).toEqual({ additions: 0, deletions: 2 });
  });

  it("counts change rows as one addition AND one deletion (paired)", () => {
    const rows = [diffRow("change"), diffRow("change")];
    expect(countDiffStats(rows)).toEqual({ additions: 2, deletions: 2 });
  });

  it("excludes context rows from both counts", () => {
    const rows = [diffRow("context"), diffRow("addition"), diffRow("context")];
    expect(countDiffStats(rows)).toEqual({ additions: 1, deletions: 0 });
  });

  it("excludes non-diff-row kinds (hunk-header, interactive, annotation)", () => {
    const rows: PlannedRow[] = [
      { kind: "hunk-header", header: "@@ -1 +1 @@", hunkIndex: 0, gapAbove: 0 },
      { kind: "interactive", subKind: "boundary-bottom", boundaryRef: "bottom" },
      {
        kind: "annotation",
        annotation: {
          id: "a",
          file: "f",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "",
          author: "h",
          author_kind: "human",
          created_at: "2026-05-13T00:00:00Z",
        },
        replies: [],
        id: "a",
      },
      diffRow("addition"),
    ];
    expect(countDiffStats(rows)).toEqual({ additions: 1, deletions: 0 });
  });

  it("handles a mixed-row file (additions, deletions, changes, contexts)", () => {
    const rows = [
      diffRow("context"),
      diffRow("addition"),
      diffRow("addition"),
      diffRow("deletion"),
      diffRow("change"),
      diffRow("context"),
    ];
    // additions: 2 (pure) + 1 (from change) = 3
    // deletions: 1 (pure) + 1 (from change) = 2
    expect(countDiffStats(rows)).toEqual({ additions: 3, deletions: 2 });
  });

  // The planner emits `type: "change"` for any row in a hunk that mixes
  // adds + deletes, including new-file and deleted-file hunks where one
  // side of the row has no content. The counter must inspect the row's
  // shape (line numbers) rather than blindly counting both sides.
  it("change row with no left content counts as addition only (new-file case)", () => {
    const row: PlannedRow = {
      kind: "diff-row",
      type: "change",
      leftLineNumber: null,
      rightLineNumber: 1,
      leftText: "",
      rightText: "x",
    };
    expect(countDiffStats([row])).toEqual({ additions: 1, deletions: 0 });
  });

  it("change row with no right content counts as deletion only (deleted-file case)", () => {
    const row: PlannedRow = {
      kind: "diff-row",
      type: "change",
      leftLineNumber: 1,
      rightLineNumber: null,
      leftText: "x",
      rightText: "",
    };
    expect(countDiffStats([row])).toEqual({ additions: 0, deletions: 1 });
  });

  it("mixed change rows (paired + right-only + left-only) count each side independently", () => {
    const rows: PlannedRow[] = [
      { kind: "diff-row", type: "change", leftLineNumber: 1, rightLineNumber: 1, leftText: "a", rightText: "b" },
      { kind: "diff-row", type: "change", leftLineNumber: null, rightLineNumber: 2, leftText: "", rightText: "c" },
      { kind: "diff-row", type: "change", leftLineNumber: 3, rightLineNumber: null, leftText: "d", rightText: "" },
    ];
    // paired: +1A +1D; right-only: +1A; left-only: +1D
    expect(countDiffStats(rows)).toEqual({ additions: 2, deletions: 2 });
  });
});

describe("proportionSegments (#228)", () => {
  it("returns 0/0/5 for zero total (pure rename, empty file)", () => {
    expect(proportionSegments(0, 0)).toEqual({ greens: 0, reds: 0, neutrals: 5 });
  });

  it("pure-addition (deletions=0) → 5 greens", () => {
    expect(proportionSegments(7, 0)).toEqual({ greens: 5, reds: 0, neutrals: 0 });
  });

  it("pure-deletion (additions=0) → 5 reds", () => {
    expect(proportionSegments(0, 4)).toEqual({ greens: 0, reds: 5, neutrals: 0 });
  });

  it("equal split (5/5) → 3 greens + 2 reds (or 2+3) summing to 5", () => {
    const seg = proportionSegments(5, 5);
    expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
    expect(seg.greens + seg.reds).toBe(5);
    expect(seg.greens).toBeGreaterThan(0);
    expect(seg.reds).toBeGreaterThan(0);
  });

  it("addition-dominated (10/2) → green-heavy bar summing to 5", () => {
    const seg = proportionSegments(10, 2);
    expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
    expect(seg.greens).toBeGreaterThan(seg.reds);
    expect(seg.reds).toBeGreaterThanOrEqual(1);
  });

  it("deletion-dominated (2/10) → red-heavy bar summing to 5", () => {
    const seg = proportionSegments(2, 10);
    expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
    expect(seg.reds).toBeGreaterThan(seg.greens);
    expect(seg.greens).toBeGreaterThanOrEqual(1);
  });

  it("preserves a floor of 1 on the minority side (1/100)", () => {
    // The minority side rounds to 0 without the floor; the floor lifts it
    // to 1 so the bar reads "some additions" rather than "all deletions".
    const seg = proportionSegments(1, 100);
    expect(seg.greens).toBeGreaterThanOrEqual(1);
    expect(seg.reds).toBeGreaterThanOrEqual(1);
    expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
  });

  it("rounding corner: 1+1 → does NOT exceed 5 segments", () => {
    // 1/2 * 5 = 2.5 → rounds to 3 on both sides; naive sum would be 6.
    const seg = proportionSegments(1, 1);
    expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
    expect(seg.greens + seg.reds).toBeLessThanOrEqual(5);
  });

  it("always returns non-negative segment counts", () => {
    for (const [a, d] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [50, 50],
      [99, 1],
      [1, 99],
    ]) {
      const seg = proportionSegments(a, d);
      expect(seg.greens).toBeGreaterThanOrEqual(0);
      expect(seg.reds).toBeGreaterThanOrEqual(0);
      expect(seg.neutrals).toBeGreaterThanOrEqual(0);
      expect(seg.greens + seg.reds + seg.neutrals).toBe(5);
    }
  });
});
