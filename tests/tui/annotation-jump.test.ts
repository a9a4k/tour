import { describe, it, expect } from "vitest";
import { explicitAnnotationJump } from "../../src/tui/annotation-jump.js";
import type { Annotation } from "../../src/core/types.js";

function ann(
  o: Pick<Annotation, "id" | "file" | "side" | "line_start"> & Partial<Annotation>,
): Annotation {
  return {
    id: o.id,
    file: o.file,
    side: o.side,
    line_start: o.line_start,
    line_end: o.line_end ?? o.line_start,
    body: "x",
    author: "u",
    author_kind: "agent",
    created_at: "2026-01-01T00:00:00Z",
  };
}

const A = ann({ id: "a", file: "a.ts", side: "additions", line_start: 1 });
const B = ann({ id: "b", file: "b.ts", side: "deletions", line_start: 5 });
const C = ann({ id: "c", file: "c.ts", side: "additions", line_start: 9 });

/**
 * Bounds-check contract for the n/p explicit-jump path (issue #132).
 * The focus-drop and cursor-materialization contract is enforced by
 * `jumpToAnnotation` in app.tsx, not here — this helper only decides
 * "does a jump happen, and to which annotation?". The tour-open seed
 * bypasses this helper but applies the same `sidebarFocused = false`
 * when annotations exist (issue #132 revision).
 */
describe("explicitAnnotationJump: bounds + target selection", () => {
  it("n from a middle annotation steps to the next", () => {
    const out = explicitAnnotationJump({ topLevel: [A, B, C], currentIdx: 0, delta: 1 });
    expect(out?.id).toBe("b");
  });

  it("p from a middle annotation steps to the previous", () => {
    const out = explicitAnnotationJump({ topLevel: [A, B, C], currentIdx: 2, delta: -1 });
    expect(out?.id).toBe("b");
  });

  it("no current annotation (idx === -1): returns null", () => {
    expect(
      explicitAnnotationJump({ topLevel: [A, B, C], currentIdx: -1, delta: 1 }),
    ).toBeNull();
  });

  it("n at the last annotation: returns null (no-op at boundary)", () => {
    expect(
      explicitAnnotationJump({ topLevel: [A, B, C], currentIdx: 2, delta: 1 }),
    ).toBeNull();
  });

  it("p at the first annotation: returns null (no-op at boundary)", () => {
    expect(
      explicitAnnotationJump({ topLevel: [A, B, C], currentIdx: 0, delta: -1 }),
    ).toBeNull();
  });

  it("empty top-level list: returns null", () => {
    expect(
      explicitAnnotationJump({ topLevel: [], currentIdx: -1, delta: 1 }),
    ).toBeNull();
  });
});
