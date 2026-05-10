import { describe, it, expect } from "vitest";
import { computeOrphanWindows } from "../../src/core/orphan-window.js";
import type { DiffFile } from "../../src/core/diff-model.js";
import type { Annotation } from "../../src/core/types.js";

function ann(
  side: "additions" | "deletions",
  line: number,
  overrides: Partial<Annotation> = {},
): Annotation {
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
  it("annotation in a hunk produces no orphan window", () => {
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 12)], OPTS);
    expect(map.size).toBe(0);
  });

  it("annotation between hunks produces a window assigned to the next hunk", () => {
    // Annotation at line 25 on additions side; gap is [15, 39].
    // Window = [25-10, 25+10] = [15, 35], clamped to gap = [15, 35].
    // fromStart = 35 - 15 + 1 = 21 (lines from gap top down to W_end).
    // fromEnd = 39 - 15 + 1 = 25 (lines from gap bottom up to W_start).
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 25)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ fromStart: 21, fromEnd: 25 });
  });

  it("annotation before first hunk attaches to hunk 0 with top semantics", () => {
    // Annotation at line 3 on additions side; top gap is [1, 9].
    // Window = [max(1, -7), min(100, 13)] = [1, 13], clamped to gap = [1, 9].
    // fromStart = 9 - 1 + 1 = 9 (full top gap below W_end of 13).
    // fromEnd = 9 - 1 + 1 = 9 (full top gap above W_start of 1).
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 3)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(0)).toEqual({ fromStart: 9, fromEnd: 9 });
  });

  it("annotation before first hunk with small file lineCount clamps window correctly", () => {
    // Single hunk at lines 50..54, file lineCount = 100, annotation at line 5.
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
    expect(map.get(0)).toEqual({ fromStart: 15, fromEnd: 49 });
  });

  it("annotation after last hunk attaches past the last hunk", () => {
    // Annotation at line 60 on additions side; trailing gap is [45, 100].
    // Window = [50, 70], clamped to gap = [50, 70].
    // fromStart = 70 - 45 + 1 = 26 (lines from gap start down to W_end).
    // fromEnd = 100 - 50 + 1 = 51.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 60)], OPTS);
    expect(map.size).toBe(1);
    expect(map.get(2)).toEqual({ fromStart: 26, fromEnd: 51 });
  });

  it("annotation near end of file clamps window to lineCount", () => {
    // lineCount = 100, annotation at line 98 → window = [88, 100].
    // Trailing gap [45, 100]. fromStart = 100 - 45 + 1 = 56. fromEnd = 100 - 88 + 1 = 13.
    const map = computeOrphanWindows(TWO_HUNKS, [ann("additions", 98)], OPTS);
    expect(map.get(2)).toEqual({ fromStart: 56, fromEnd: 13 });
  });

  it("two close annotations produce a single unioned window", () => {
    // Annotations at line 22 and 28 on additions side. Both in gap [15, 39].
    // a1 (line 22): window [15, 32]. fromStart = 18, fromEnd = 25.
    // a2 (line 28): window [18, 38]. fromStart = 24, fromEnd = 22.
    // Union (max of each): fromStart = 24, fromEnd = 25.
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 22, { id: "a1" }), ann("additions", 28, { id: "a2" })],
      OPTS,
    );
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ fromStart: 24, fromEnd: 25 });
  });

  it("annotation beyond file line count is silently dropped", () => {
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
    // Annotation on deletions side at line 20 (between deletion-side hunks at 8-12 and 36-40).
    // Deletions gap = [13, 35]. Window [10, 30] clamped to gap = [13, 30].
    // fromStart = 30 - 13 + 1 = 18. fromEnd = 35 - 13 + 1 = 23.
    const map = computeOrphanWindows(file, [ann("deletions", 20)], { oldLineCount: 90, newLineCount: 100 });
    expect(map.get(1)).toEqual({ fromStart: 18, fromEnd: 23 });
  });

  it("ignores annotations for other files", () => {
    const map = computeOrphanWindows(
      TWO_HUNKS,
      [ann("additions", 25, { file: "src/other.ts" })],
      OPTS,
    );
    expect(map.size).toBe(0);
  });
});
