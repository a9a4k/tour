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
 * Contract test for issue #132: explicit user-driven annotation jumps
 * (TUI `n` / `p`) MUST drop sidebar focus so subsequent j/k move the
 * diff cursor, not the file row. Incidental jumps (tour-open seed)
 * do NOT route through this helper — the seed effect in app.tsx
 * updates state directly and leaves `sidebarFocused` at its default
 * of `true` (verified by the absence of a setSidebarFocused call in
 * that effect; covered structurally rather than via a unit test).
 */
describe("explicitAnnotationJump: focus routing (issue #132)", () => {
  it("n from the first annotation drops sidebar focus + materializes cursor at target", () => {
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: 0,
      delta: 1,
    });
    expect(out).not.toBeNull();
    expect(out?.sidebarFocused).toBe(false);
    expect(out?.target.id).toBe("b");
    expect(out?.cursor).toEqual({
      file: "b.ts",
      lineNumber: 5,
      side: "deletions",
      preferredSide: "deletions",
    });
  });

  it("p from the last annotation drops sidebar focus + materializes cursor at target", () => {
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: 2,
      delta: -1,
    });
    expect(out).not.toBeNull();
    expect(out?.sidebarFocused).toBe(false);
    expect(out?.target.id).toBe("b");
  });

  it("no current annotation (idx === -1): returns null — focus unchanged", () => {
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: -1,
      delta: 1,
    });
    expect(out).toBeNull();
  });

  it("n at the last annotation: returns null — focus unchanged", () => {
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: 2,
      delta: 1,
    });
    expect(out).toBeNull();
  });

  it("p at the first annotation: returns null — focus unchanged", () => {
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: 0,
      delta: -1,
    });
    expect(out).toBeNull();
  });

  it("empty top-level list: returns null (no target, no focus change)", () => {
    const out = explicitAnnotationJump({
      topLevel: [],
      currentIdx: -1,
      delta: 1,
    });
    expect(out).toBeNull();
  });

  it("explicit jump from diff focus also reports sidebarFocused: false (idempotent)", () => {
    // Caller is responsible for already-false sidebarFocused state; the
    // helper returns the post-jump value unconditionally. App.tsx's
    // setSidebarFocused(false) is a no-op when state is already false,
    // so the acceptance criterion "n in diff focus leaves focus on diff"
    // holds by reduction.
    const out = explicitAnnotationJump({
      topLevel: [A, B, C],
      currentIdx: 1,
      delta: 1,
    });
    expect(out?.sidebarFocused).toBe(false);
    expect(out?.target.id).toBe("c");
  });
});
