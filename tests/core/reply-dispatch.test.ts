import { describe, it, expect } from "vitest";
import { shouldDispatchReply } from "../../src/core/reply-dispatch.js";
import type { Comment } from "../../src/core/types.js";

function ann(over: Partial<Comment> & { id: string }): Comment {
  return {
    id: over.id,
    file: "src/main.ts",
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "note",
    author: "anonymous",
    author_kind: "agent",
    created_at: "2026-05-10T00:00:00Z",
    ...over,
  };
}

describe("shouldDispatchReply", () => {
  it("fires for human-authored top-level comments", () => {
    expect(shouldDispatchReply(ann({ id: "a1", author_kind: "human" }))).toBe(true);
  });

  it("fires for human-authored replies", () => {
    expect(
      shouldDispatchReply(
        ann({ id: "a2", author_kind: "human", thread_id: "a1" }),
      ),
    ).toBe(true);
  });

  it("does not fire for agent-authored comments", () => {
    expect(shouldDispatchReply(ann({ id: "a3", author_kind: "agent" }))).toBe(false);
  });

  it("does not fire for agent-authored replies", () => {
    expect(
      shouldDispatchReply(
        ann({ id: "a4", author_kind: "agent", thread_id: "a1" }),
      ),
    ).toBe(false);
  });
});
