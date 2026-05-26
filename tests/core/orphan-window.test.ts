import { describe, it, expect } from "vitest";
import { computeOrphanWindows, orphanSeedWindows } from "../../src/core/orphan-window.js";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Comment } from "../../src/core/types.js";

function ann(
  side: "additions" | "deletions",
  line: number,
  overrides: Partial<Comment> = {},
): Comment {
  return {
    id: overrides.id ?? `a-${side}-${line}`,
    file: overrides.file ?? "src/foo.ts",
    side,
    line_start: line,
    line_end: line,
    body: "...",
    author: "test",
    author_kind: "human",
    created_at: "2026-05-10T00:00:00Z",
    ...overrides,
  };
}

// File with two hunks on additions side: lines 10..14 and 40..44.
// Same on deletions side. Surrounded by unchanged regions.
const TWO_HUNKS: DiffFile = {
  name: "src/foo.ts",
  type: "change",
  hunks: [
    {
      additionStart: 10,
      additionCount: 5,
      deletionStart: 10,
      deletionCount: 5,
      content: [],
    },
    {
      additionStart: 40,
      additionCount: 5,
      deletionStart: 40,
      deletionCount: 5,
      content: [],
    },
  ],
};

const OPTS = { oldLineCount: 100, newLineCount: 100 };

describe("computeOrphanWindows", () => {
  it("comment in a hunk produces no orphan window", () => {
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 12)], OPTS);
    expect(map.size).toBe(0);
  });

  it("comment between hunks produces a window assigned to the next hunk", () => {
    // Comment at line 25 on additions side; gap is [15, 39].
    // Window = [25-10, 25+10] = [15, 35], clamped to gap = [15, 35].
    // Top projection costs 21 lines; bottom projection costs 25, so the
    // producer chooses the top edge and leaves fromEnd at 0.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 25)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ fromStart: 21, fromEnd: 0 });
  });

  it("comment before first hunk attaches to hunk 0 with top semantics", () => {
    // Comment at line 3 on additions side; top gap is [1, 9].
    // Window = [max(1, -7), min(100, 13)] = [1, 13], clamped to gap = [1, 9].
    // Both edges cost 9 lines, so ties choose the top edge.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 3)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(0)).toEqual({ fromStart: 9, fromEnd: 0 });
  });

  it("comment before first hunk with small file lineCount clamps window correctly", () => {
    // Single hunk at lines 50..54, file lineCount = 100, comment at line 5.
    // Window = [1, 15]. Top gap = [1, 49].
    // fromStart = 15 - 1 + 1 = 15. fromEnd = 49 - 1 + 1 = 49.
    const file: DiffFile = {
      name: "src/foo.ts",
      type: "change",
      hunks: [
        {
          additionStart: 50,
          additionCount: 5,
          deletionStart: 50,
          deletionCount: 5,
          content: [],
        },
      ],
    };
    const map = computeOrphanWindows(file, [ann("additions", 5)], OPTS);
    expect(map.get(0)).toEqual({ fromStart: 15, fromEnd: 0 });
  });

  it("comment after last hunk attaches past the last hunk", () => {
    // Comment at line 60 on additions side; trailing gap is [45, 100].
    // Window = [50, 70], clamped to gap = [50, 70].
    // Top projection costs 26 lines; bottom projection costs 51.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 60)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(2)).toEqual({ fromStart: 26, fromEnd: 0 });
  });

  it("comment near end of file clamps window to lineCount", () => {
    // lineCount = 100, comment at line 98 → window = [88, 100].
    // Trailing gap [45, 100]. Bottom projection is cheaper: 13 lines.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 98)], OPTS);
    expect(map.get(2)).toEqual({ fromStart: 0, fromEnd: 13 });
  });

  it("two close comments produce a single unioned window", () => {
    // Comments at line 22 and 28 on additions side. Both in gap [15, 39].
    // Their clamped spans union to [15, 38]. Top projection costs 24
    // lines; bottom projection costs 25.
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 22, { id: "a1" }), ann("additions", 28, { id: "a2" })],
      OPTS,
    );
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ fromStart: 24, fromEnd: 0 });
  });

  it("comments whose windows collectively cover a gap still produce one edge reveal", () => {
    // Comments at line 18 and 36 in gap [15, 39]. Their windows union to
    // the full gap, so the tie-break chooses one top-edge reveal.
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 18, { id: "a1" }), ann("additions", 36, { id: "a2" })],
      OPTS,
    );
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ fromStart: 25, fromEnd: 0 });
  });

  it("comment beyond file line count is silently dropped", () => {
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 200)],
      OPTS,
    );
    expect(map.size).toBe(0);
  });

  it("deletions side picks the correct line numbers from old file", () => {
    // Two hunks differ on each side: additions at 10..14 / 40..44, deletions at 8..12 / 36..40.
    const file: DiffFile = {
      name: "src/foo.ts",
      type: "change",
      hunks: [
        {
          additionStart: 10,
          additionCount: 5,
          deletionStart: 8,
          deletionCount: 5,
          content: [],
        },
        {
          additionStart: 40,
          additionCount: 5,
          deletionStart: 36,
          deletionCount: 5,
          content: [],
        },
      ],
    };
    // Comment on deletions side at line 20 (between deletion-side hunks at 8-12 and 36-40).
    // Deletions gap = [13, 35]. Window [10, 30] clamped to gap = [13, 30].
    // Top projection costs 18 lines; bottom projection costs 23.
    const map = computeOrphanWindows(file, [ann("deletions", 20)], { oldLineCount: 90, newLineCount: 100 });
    expect(map.get(1)).toEqual({ fromStart: 18, fromEnd: 0 });
  });

  it("ignores comments for other files", () => {
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 25, { file: "src/other.ts" })],
      OPTS,
    );
    expect(map.size).toBe(0);
  });
});

describe("orphanSeedWindows", () => {
  // Bridges computeOrphanWindows (numeric hunk-index gap keys) to the
  // BoundaryRef-keyed OrphanWindow[] shape that core/expansion-state.ts'
  // seedFromOrphans consumes. Mapping rule: hunkIndex 0 → 'top',
  // hunkIndex === file.hunks.length → 'bottom', else numeric.

  it("maps a leading-gap orphan (hunkIndex 0) to ref 'top'", () => {
    const result = orphanSeedWindows(TWO_HUNKS, [ann("additions", 3)], OPTS);
    expect(result).toEqual([
      { file: "src/foo.ts", ref: "top", fromStart: 9, fromEnd: 0 },
    ]);
  });

  it("maps a trailing-gap orphan (hunkIndex === hunks.length) to ref 'bottom'", () => {
    const result = orphanSeedWindows(TWO_HUNKS, [ann("additions", 60)], OPTS);
    expect(result).toEqual([
      { file: "src/foo.ts", ref: "bottom", fromStart: 26, fromEnd: 0 },
    ]);
  });

  it("maps a between-hunks orphan to its numeric hunkIndex", () => {
    const result = orphanSeedWindows(TWO_HUNKS, [ann("additions", 25)], OPTS);
    expect(result).toEqual([
      { file: "src/foo.ts", ref: 1, fromStart: 21, fromEnd: 0 },
    ]);
  });

  it("returns multiple OrphanWindow entries when multiple gaps have orphans", () => {
    const result = orphanSeedWindows(
      TWO_HUNKS,
      [ann("additions", 3, { id: "top" }), ann("additions", 25, { id: "mid" }), ann("additions", 60, { id: "bot" })],
      OPTS,
    );
    expect(result).toHaveLength(3);
    expect(result.find((w) => w.ref === "top")).toBeDefined();
    expect(result.find((w) => w.ref === 1)).toBeDefined();
    expect(result.find((w) => w.ref === "bottom")).toBeDefined();
  });

  it("returns an empty list when the file has no orphan comments", () => {
    expect(orphanSeedWindows(TWO_HUNKS, [], OPTS)).toEqual([]);
    expect(orphanSeedWindows(TWO_HUNKS, [ann("additions", 12)], OPTS)).toEqual([]);
  });

  it("returns an empty list for files with no hunks (binary / classifier-collapsed)", () => {
    const file: DiffFile = { name: "img.png", type: "binary", hunks: [] };
    const result = orphanSeedWindows(file, [ann("additions", 5, { file: "img.png" })], {
      oldLineCount: 0,
      newLineCount: 0,
    });
    expect(result).toEqual([]);
  });
});
