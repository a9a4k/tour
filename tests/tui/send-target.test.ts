import { describe, it, expect } from "vitest";
import { tuiSendTarget } from "../../src/tui/send-target.js";
import type { Annotation } from "../../src/core/types.js";
import type { Cursor } from "../../src/core/cursor-state.js";

function ann(o: Partial<Annotation> & Pick<Annotation, "id">): Annotation {
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

const cardCursor = (annotationId: string): Cursor => ({
  kind: "card",
  annotationId,
});

const rowCursor: Cursor = {
  kind: "row",
  file: "x.txt",
  lineNumber: 1,
  side: "additions",
  preferredSide: "additions",
};

function index(
  topLevel: Annotation[],
  descendantsByRoot: Record<string, Annotation[]>,
) {
  return new Map<string, Annotation[]>(
    Object.entries(descendantsByRoot),
  );
}

/**
 * Issue #196: the TUI's `s` keystroke now targets the latest human leaf
 * in the focused Thread, not the cursor-focused top-level Annotation.
 * `n`/`p` still walks top-levels only; the cursor identifies the
 * Thread, the helper picks the leaf inside it.
 */
describe("tuiSendTarget (issue #196)", () => {
  it("returns null when the cursor is null", () => {
    expect(tuiSendTarget(null, [], new Map())).toBeNull();
  });

  it("returns null when the cursor is on a row (no focused Thread)", () => {
    expect(tuiSendTarget(rowCursor, [], new Map())).toBeNull();
  });

  it("returns null when the cursor's card id is not in the annotation list (stale)", () => {
    const top = ann({ id: "a1", author_kind: "human" });
    expect(
      tuiSendTarget(cardCursor("ghost"), [top], index([top], { a1: [] })),
    ).toBeNull();
  });

  it("returns the top-level itself on a human-top-level Thread with no replies", () => {
    const top = ann({ id: "a1", author_kind: "human" });
    const out = tuiSendTarget(cardCursor("a1"), [top], index([top], { a1: [] }));
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("a1");
    expect(out!.leaf).toBe(top);
  });

  it("returns the latest human reply when the Thread has back-and-forth ending on human", () => {
    // top (human) → agent reply → human follow-up. The TUI cursor is
    // on the top-level (n/p only walks top-levels); `s` must target
    // the human follow-up, not the top-level.
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
    const out = tuiSendTarget(
      cardCursor("t1"),
      [top],
      index([top], { t1: [agentReply, humanFollowUp] }),
    );
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("r2");
    expect(out!.leaf).toBe(humanFollowUp);
  });

  it("returns null when the latest turn in the focused Thread is agent-authored", () => {
    // top (human) → agent reply. The hint must hide; `s` must not
    // dispatch. The user is expected to write a Reply first.
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
    const out = tuiSendTarget(
      cardCursor("t1"),
      [top],
      index([top], { t1: [agentReply] }),
    );
    expect(out).toBeNull();
  });

  it("returns null when the top-level itself is agent-authored and there are no human descendants", () => {
    const top = ann({ id: "t1", author_kind: "agent" });
    expect(
      tuiSendTarget(cardCursor("t1"), [top], index([top], { t1: [] })),
    ).toBeNull();
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
    const out = tuiSendTarget(
      cardCursor("t1"),
      [top],
      index([top], { t1: [humanReply] }),
    );
    expect(out).not.toBeNull();
    expect(out!.leafId).toBe("r1");
    expect(out!.leaf).toBe(humanReply);
  });
});
