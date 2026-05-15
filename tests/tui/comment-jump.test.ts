import { describe, it, expect } from "vitest";
import { explicitCommentJump } from "../../src/tui/comment-jump.js";
import type { Comment } from "../../src/core/types.js";

function ann(
  o: Pick<Comment, "id" | "file" | "side" | "line_start"> & Partial<Comment>,
): Comment {
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
 * `jumpToComment` in app.tsx, not here — this helper only decides
 * "does a jump happen, and to which comment?". The tour-open seed
 * bypasses this helper but applies the same `sidebarFocused = false`
 * when comments exist (issue #132 revision).
 */
describe("explicitCommentJump: bounds + target selection", () => {
  it("n from a middle comment steps to the next", () => {
    const out = explicitCommentJump({ topLevel: [A, B, C], currentIdx: 0, delta: 1 });
    expect(out?.id).toBe("b");
  });

  it("p from a middle comment steps to the previous", () => {
    const out = explicitCommentJump({ topLevel: [A, B, C], currentIdx: 2, delta: -1 });
    expect(out?.id).toBe("b");
  });

  it("no current comment (idx === -1): returns null", () => {
    expect(
      explicitCommentJump({ topLevel: [A, B, C], currentIdx: -1, delta: 1 }),
    ).toBeNull();
  });

  it("n at the last comment: returns null (no-op at boundary)", () => {
    expect(
      explicitCommentJump({ topLevel: [A, B, C], currentIdx: 2, delta: 1 }),
    ).toBeNull();
  });

  it("p at the first comment: returns null (no-op at boundary)", () => {
    expect(
      explicitCommentJump({ topLevel: [A, B, C], currentIdx: 0, delta: -1 }),
    ).toBeNull();
  });

  it("empty top-level list: returns null", () => {
    expect(
      explicitCommentJump({ topLevel: [], currentIdx: -1, delta: 1 }),
    ).toBeNull();
  });
});
