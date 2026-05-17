import { describe, it, expect } from "vitest";
import { sendTarget } from "../../src/core/send-target.js";
import { buildThreads, type Thread } from "../../src/core/threads.js";
import type { Comment } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";

function ann(o: Partial<Comment> & Pick<Comment, "id">): Comment {
  return {
    id: o.id,
    file: o.file ?? "x.txt",
    side: o.side ?? "additions",
    line_start: o.line_start ?? 1,
    line_end: o.line_end ?? 1,
    body: o.body ?? "body",
    author: o.author ?? (o.author_kind === "agent" ? "claude" : "user"),
    author_kind: o.author_kind ?? "human",
    replies_to: o.replies_to,
    created_at: o.created_at ?? "2026-05-12T00:00:00Z",
  };
}

const cardCursor = (commentId: string): Cursor => ({
  kind: "card",
  commentId,
  preferredSide: "additions",
});

const rowCursor: Cursor = {
  kind: "row",
  file: "x.txt",
  lineNumber: 1,
  side: "additions",
  preferredSide: "additions",
};

function threadsOf(...comments: Comment[]): ReadonlyArray<Thread> {
  return buildThreads([...comments]);
}

/**
 * `R` dispatch target — latest human leaf in the cursor-focused Thread
 * (issue #196 / PRD #181; canonical home per PRD #242 / issue #243).
 * The cursor identifies the Thread (parent or any reply node per ADR
 * 0037 / issue #395), the helper picks the leaf inside it.
 */
describe("sendTarget", () => {
  it("returns null when the cursor is null", () => {
    expect(sendTarget(null, [])).toBeNull();
  });

  it("returns null when the cursor is on a row (no focused Thread)", () => {
    expect(sendTarget(rowCursor, [])).toBeNull();
  });

  it("returns null when the cursor's commentId is not in any Thread (stale)", () => {
    const top = ann({ id: "a1", author_kind: "human" });
    expect(sendTarget(cardCursor("ghost"), threadsOf(top))).toBeNull();
  });

  it("returns the top-level itself on a human-top-level Thread with no replies", () => {
    const top = ann({ id: "a1", author_kind: "human" });
    const out = sendTarget(cardCursor("a1"), threadsOf(top));
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("a1");
    expect(out!.leaf).toBe(top);
  });

  it("returns the latest human reply when the Thread has back-and-forth ending on human", () => {
    const top = ann({
      id: "t1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:00Z",
    });
    const agentReply = ann({
      id: "r1",
      replies_to: "t1",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:01Z",
    });
    const humanFollowUp = ann({
      id: "r2",
      replies_to: "r1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:02Z",
    });
    const out = sendTarget(
      cardCursor("t1"),
      threadsOf(top, agentReply, humanFollowUp),
    );
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("r2");
    expect(out!.leaf.id).toBe("r2");
  });

  it("returns null when the latest turn in the focused Thread is agent-authored", () => {
    const top = ann({
      id: "t1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:00Z",
    });
    const agentReply = ann({
      id: "r1",
      replies_to: "t1",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:01Z",
    });
    const out = sendTarget(cardCursor("t1"), threadsOf(top, agentReply));
    expect(out).toBeNull();
  });

  it("returns null when the top-level itself is agent-authored and there are no human descendants", () => {
    const top = ann({ id: "t1", author_kind: "agent" });
    expect(sendTarget(cardCursor("t1"), threadsOf(top))).toBeNull();
  });

  it("returns the latest human leaf when an agent top-level has a human follow-up", () => {
    const top = ann({
      id: "t1",
      author_kind: "agent",
      created_at: "2026-05-12T00:00:00Z",
    });
    const humanReply = ann({
      id: "r1",
      replies_to: "t1",
      author_kind: "human",
      created_at: "2026-05-12T00:00:01Z",
    });
    const out = sendTarget(cardCursor("t1"), threadsOf(top, humanReply));
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("r1");
    expect(out!.leaf.id).toBe("r1");
  });

  // Issue #395: ADR 0037 broadened CardAnchor.commentId to include reply
  // ids. `sendTarget` resolves through `findThreadByNode` so `R` is
  // Thread-scoped regardless of which node the cursor sits on — the
  // natural post-reply-submit landing was previously a silent no-op.
  describe("cursor on a reply node (issue #395)", () => {
    it("resolves a reply-id cursor to the containing Thread's latest human leaf", () => {
      const top = ann({
        id: "t1",
        author_kind: "human",
        created_at: "2026-05-12T00:00:00Z",
      });
      const humanFollowUp = ann({
        id: "r1",
        replies_to: "t1",
        author_kind: "human",
        created_at: "2026-05-12T00:00:01Z",
      });
      const out = sendTarget(
        cardCursor("r1"),
        threadsOf(top, humanFollowUp),
      );
      expect(out).not.toBeNull();
      expect(out!.leafId).toBe("r1");
      expect(out!.leaf.id).toBe("r1");
    });

    it("resolves a mid-Thread reply-id cursor to the Thread's latest human leaf (not the cursor's node)", () => {
      const top = ann({
        id: "t1",
        author_kind: "human",
        created_at: "2026-05-12T00:00:00Z",
      });
      const agentReply = ann({
        id: "r1",
        replies_to: "t1",
        author_kind: "agent",
        created_at: "2026-05-12T00:00:01Z",
      });
      const humanFollowUp = ann({
        id: "r2",
        replies_to: "r1",
        author_kind: "human",
        created_at: "2026-05-12T00:00:02Z",
      });
      // Cursor sits on the mid-Thread agent reply — `R` still dispatches
      // to the Thread's latest human leaf (r2), not to the agent node.
      const out = sendTarget(
        cardCursor("r1"),
        threadsOf(top, agentReply, humanFollowUp),
      );
      expect(out).not.toBeNull();
      expect(out!.leafId).toBe("r2");
      expect(out!.leaf.id).toBe("r2");
    });

    it("returns null when the cursor is on a reply but the Thread's latest turn is agent-authored", () => {
      const top = ann({
        id: "t1",
        author_kind: "human",
        created_at: "2026-05-12T00:00:00Z",
      });
      const agentReply = ann({
        id: "r1",
        replies_to: "t1",
        author_kind: "agent",
        created_at: "2026-05-12T00:00:01Z",
      });
      const out = sendTarget(
        cardCursor("r1"),
        threadsOf(top, agentReply),
      );
      expect(out).toBeNull();
    });
  });
});
