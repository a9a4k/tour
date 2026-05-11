import { describe, expect, it } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import {
  expansionFromPierre,
  type PierreFileDiffLike,
} from "../../src/web/client/pierre-expansion-bridge.js";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";

// Pierre keys `expandedHunks` by hunkIndex with `{ fromStart, fromEnd }`.
// Tour's `ExpansionState` uses `BoundaryRef = number | "top" | "bottom"`.
// The bridge remaps Pierre's index space onto BoundaryRef:
//   0                   → "top"
//   1..hunks.length-1   → that number (mid-file separator)
//   hunks.length        → "bottom" (Pierre's trailing-region key)
// fromStart → ExpansionState `up`; fromEnd → ExpansionState `down`.

function makeRef(
  expanded: Map<number, { fromStart: number; fromEnd: number }>,
): PierreFileDiffLike {
  return {
    hunksRenderer: {
      getExpandedHunksMap: () => expanded,
    },
  };
}

function parseFile(rawDiff: string): FileDiffMetadata {
  const patches = parsePatchFiles(rawDiff);
  return patches[0].files[0];
}

describe("expansionFromPierre: shape mapping", () => {
  it("returns an empty ExpansionState when refs map is empty", () => {
    const out = expansionFromPierre(new Map(), []);
    expect(out.size).toBe(0);
  });

  it("returns an empty ExpansionState when Pierre's map is empty", () => {
    const refs = new Map([["x.ts", makeRef(new Map())]]);
    const parsed = [{ name: "x.ts", hunks: [{}, {}, {}] as unknown[] }];
    const out = expansionFromPierre(refs, parsed);
    expect(out.size).toBe(0);
  });

  it("maps Pierre hunkIndex=0 to BoundaryRef 'top'", () => {
    const refs = new Map([
      ["x.ts", makeRef(new Map([[0, { fromStart: 3, fromEnd: 7 }]]))],
    ]);
    const parsed = [{ name: "x.ts", hunks: [{}, {}] as unknown[] }];
    const out = expansionFromPierre(refs, parsed);
    const file = out.get("x.ts");
    expect(file).toBeDefined();
    expect(file?.boundaries.get("top")).toEqual({ up: 3, down: 7 });
    expect(file?.boundaries.get(0)).toBeUndefined();
  });

  it("maps Pierre mid-file hunkIndex to the numeric BoundaryRef", () => {
    const refs = new Map([
      ["x.ts", makeRef(new Map([[1, { fromStart: 4, fromEnd: 6 }]]))],
    ]);
    const parsed = [{ name: "x.ts", hunks: [{}, {}, {}] as unknown[] }];
    const out = expansionFromPierre(refs, parsed);
    expect(out.get("x.ts")?.boundaries.get(1)).toEqual({ up: 4, down: 6 });
  });

  it("maps Pierre hunkIndex == hunks.length to BoundaryRef 'bottom'", () => {
    // Pierre uses `diff.hunks.length` as the synthetic key for the trailing
    // region (see node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js).
    const refs = new Map([
      ["x.ts", makeRef(new Map([[2, { fromStart: 5, fromEnd: 8 }]]))],
    ]);
    const parsed = [{ name: "x.ts", hunks: [{}, {}] as unknown[] }]; // 2 hunks
    const out = expansionFromPierre(refs, parsed);
    expect(out.get("x.ts")?.boundaries.get("bottom")).toEqual({ up: 5, down: 8 });
    expect(out.get("x.ts")?.boundaries.get(2)).toBeUndefined();
  });

  it("supports multiple files independently", () => {
    const refs = new Map<string, PierreFileDiffLike>([
      ["a.ts", makeRef(new Map([[0, { fromStart: 1, fromEnd: 2 }]]))],
      ["b.ts", makeRef(new Map([[1, { fromStart: 3, fromEnd: 4 }]]))],
    ]);
    const parsed = [
      { name: "a.ts", hunks: [{}, {}] as unknown[] },
      { name: "b.ts", hunks: [{}, {}, {}] as unknown[] },
    ];
    const out = expansionFromPierre(refs, parsed);
    expect(out.get("a.ts")?.boundaries.get("top")).toEqual({ up: 1, down: 2 });
    expect(out.get("b.ts")?.boundaries.get(1)).toEqual({ up: 3, down: 4 });
  });

  it("falls back to hunkCount=0 when a ref's file is missing from parsedFiles", () => {
    const refs = new Map([
      ["stale.ts", makeRef(new Map([[0, { fromStart: 1, fromEnd: 1 }]]))],
    ]);
    // parsedFiles is empty — hunk count unknown, treated as 0. hunkIndex=0
    // still maps to "top" (the first-hunk branch wins over the >=hunkCount
    // bottom branch), so the bridge degrades gracefully rather than crashing.
    const out = expansionFromPierre(refs, []);
    expect(out.get("stale.ts")?.boundaries.get("top")).toEqual({ up: 1, down: 1 });
  });

  it("falls back to empty state when hunksRenderer accessor is missing", () => {
    const refs = new Map([["x.ts", {} as PierreFileDiffLike]]);
    const parsed = [{ name: "x.ts", hunks: [{}] as unknown[] }];
    const out = expansionFromPierre(refs, parsed);
    expect(out.size).toBe(0);
  });
});

// PRD #151 user-story 10: progressive expansion should reflect in the
// planner output. These tests run a full Pierre→ExpansionState→planRows
// pipeline to lock in the behavior the issue's acceptance criteria call out.
describe("expansionFromPierre: planRows integration (PRD #151 US 10)", () => {
  function buildMidGapDiff(gapLines: number): {
    diff: string;
    newContent: string;
    oldContent: string;
  } {
    const hunk2Start = gapLines + 4;
    const gapBody: string[] = [];
    for (let i = 4; i <= gapLines + 3; i++) gapBody.push(`g${i}`);
    const newLines = [
      "ctx1",
      "new1",
      "ctx2",
      ...gapBody,
      `ctx${hunk2Start}`,
      `new${hunk2Start + 1}`,
      `ctx${hunk2Start + 2}`,
    ];
    const oldLines = [
      "ctx1",
      "old1",
      "ctx2",
      ...gapBody,
      `ctx${hunk2Start}`,
      `old${hunk2Start + 1}`,
      `ctx${hunk2Start + 2}`,
    ];
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -${hunk2Start},3 +${hunk2Start},3 @@
 ctx${hunk2Start}
-old${hunk2Start + 1}
+new${hunk2Start + 1}
 ctx${hunk2Start + 2}
`;
    return {
      diff,
      newContent: newLines.join("\n") + "\n",
      oldContent: oldLines.join("\n") + "\n",
    };
  }

  it("first-hunk file-top gap absorbed by Pierre → hunk-header becomes inert", () => {
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -10,1 +10,1 @@
-old10
+new10
`;
    const file = parseFile(diff);
    // Simulate Pierre absorbing the entire 9-line file-top gap via
    // `fromEnd += 9` (`direction="down"` per ADR 0018's D1 — the file-top
    // hunk-header sits at the BOTTOM of the gap, so adjacency is end-side).
    const refs = new Map([
      ["x.txt", makeRef(new Map([[0, { fromStart: 0, fromEnd: 9 }]]))],
    ]);
    const expansion = expansionFromPierre(refs, [file]);
    const newContent =
      "a\nb\nc\nd\ne\nf\ng\nh\ni\nold10\n"; // 10 lines so planner can render
    const oldContent = newContent;
    const rows = planRows(file, [], "split", { expansion, oldContent, newContent });
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[0].gapAbove).toBe(0);
  });

  it("mid-file large gap absorbed below 2N → gap-mid-top drops out", () => {
    // 50-line mid-gap, then Pierre reveals 11 lines from `down` so
    // remaining = 39 (< 40 threshold).
    const { diff, oldContent, newContent } = buildMidGapDiff(50);
    const file = parseFile(diff);
    const refs = new Map([
      ["x.txt", makeRef(new Map([[1, { fromStart: 0, fromEnd: 11 }]]))],
    ]);
    const expansion = expansionFromPierre(refs, [file]);
    const rows = planRows(file, [], "split", { expansion, oldContent, newContent });
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(39);
  });

  it("mid-file gap-mid-top half absorbed; bottom half remains → gap-mid-top stays with reduced count", () => {
    // 50-line mid-gap; absorb fromStart=11 from the top of the gap. Remaining
    // gap = 39, which is below 2N, so the gap-mid-top drops out (the planner
    // emits ONE hunk-header). This matches the issue's narrative for the
    // mid-file half-absorption case — once below threshold, the single
    // symmetric chevron is what remains.
    const { diff, oldContent, newContent } = buildMidGapDiff(50);
    const file = parseFile(diff);
    const refs = new Map([
      ["x.txt", makeRef(new Map([[1, { fromStart: 11, fromEnd: 0 }]]))],
    ]);
    const expansion = expansionFromPierre(refs, [file]);
    const rows = planRows(file, [], "split", { expansion, oldContent, newContent });
    const headers = rows.filter(
      (r): r is Extract<PlannedRow, { kind: "hunk-header" }> => r.kind === "hunk-header",
    );
    expect(headers[1].gapAbove).toBe(39);
    expect(rows.some((r) => r.kind === "interactive" && r.subKind === "gap-mid-top")).toBe(false);
  });

  it("file-bottom expansion via Pierre's trailing-region key reaches the planner's 'bottom' boundary", () => {
    // Single-hunk diff at lines 1..3; newContent has 13 lines so the
    // file-bottom gap = 10. Pierre stores trailing expansion under key
    // `hunks.length` (= 1 here) per its `iterateOverDiff` — see
    // `node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js`. The bridge
    // must remap that synthetic key onto Tour's `"bottom"` BoundaryRef so the
    // planner accounts for it. This locks in the mapping at the boundary
    // where the existing diff-rows.ts emission still produces a
    // `boundary-bottom` row (planner's emission policy unchanged in this
    // slice — see issue #158 for the bridge-only scope).
    const diff = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,3 @@
 ctx1
-old2
+new2
 ctx3
`;
    const file = parseFile(diff);
    const newContent = Array.from({ length: 13 }, (_, i) => `l${i + 1}`).join("\n") + "\n";
    const oldContent = newContent;
    const refs = new Map([
      ["x.txt", makeRef(new Map([[1, { fromStart: 0, fromEnd: 10 }]]))],
    ]);
    const expansion = expansionFromPierre(refs, [file]);
    expect(expansion.get("x.txt")?.boundaries.get("bottom")).toEqual({ up: 0, down: 10 });
    // The bridged state shrinks the planner's accounted file-bottom remaining
    // to 0; per issue #160 the planner now suppresses the `boundary-bottom`
    // row entirely in that case (US-10: chevrons remain visible until the
    // entire gap is absorbed, then drop out).
    const rows = planRows(file, [], "split", { expansion, oldContent, newContent });
    const bot = rows.find(
      (r): r is Extract<PlannedRow, { kind: "interactive" }> =>
        r.kind === "interactive" && r.subKind === "boundary-bottom",
    );
    expect(bot).toBeUndefined();
  });
});
