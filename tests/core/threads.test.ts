import { describe, it, expect } from "vitest";
import {
  buildThreads,
  latestCommentId,
  latestHumanLeafId,
  topLevelComments,
} from "../../src/core/threads.js";
import type { Comment } from "../../src/core/types.js";

function ann(over: Partial<Comment> & { id: string }): Comment {
  return {
    id: over.id,
    file: "src/main.ts",
    side: "additions",
    line_start: 1,
    line_end: 1,
    body: "note",
    author: "agent",
    author_kind: "agent",
    created_at: "2026-05-08T00:00:00Z",
    ...over,
  };
}

describe("buildThreads", () => {
  it("returns an empty array for an empty list", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("returns each top-level comment as its own thread with no replies", () => {
    const a = ann({ id: "a1", created_at: "2026-05-08T00:00:01Z" });
    const b = ann({ id: "a2", created_at: "2026-05-08T00:00:02Z" });
    expect(buildThreads([a, b])).toEqual([
      { root: a, replies: [] },
      { root: b, replies: [] },
    ]);
  });

  it("groups replies under their parent in created_at ascending order", () => {
    const root = ann({ id: "r1", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({
      id: "r1-rep1",
      thread_id: "r1",
      author_kind: "human",
      created_at: "2026-05-08T00:00:02Z",
    });
    const r2 = ann({
      id: "r1-rep2",
      thread_id: "r1",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:03Z",
    });
    const out = buildThreads([root, r2, r1]);
    expect(out).toHaveLength(1);
    expect(out[0].root.id).toBe("r1");
    expect(out[0].replies.map((r) => r.id)).toEqual(["r1-rep1", "r1-rep2"]);
  });

  it("orders threads by root created_at ascending", () => {
    const a = ann({ id: "a1", created_at: "2026-05-08T00:00:05Z" });
    const b = ann({ id: "a2", created_at: "2026-05-08T00:00:01Z" });
    const c = ann({ id: "a3", created_at: "2026-05-08T00:00:03Z" });
    const out = buildThreads([a, b, c]);
    expect(out.map((t) => t.root.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("interleaves replies for multiple top-level comments correctly", () => {
    const a = ann({ id: "a", created_at: "2026-05-08T00:00:00Z" });
    const b = ann({ id: "b", created_at: "2026-05-08T00:00:01Z" });
    const ar = ann({ id: "ar", thread_id: "a", created_at: "2026-05-08T00:00:02Z" });
    const br = ann({ id: "br", thread_id: "b", created_at: "2026-05-08T00:00:03Z" });
    const ar2 = ann({ id: "ar2", thread_id: "a", created_at: "2026-05-08T00:00:04Z" });
    const out = buildThreads([a, b, ar, br, ar2]);
    expect(out.map((t) => t.root.id)).toEqual(["a", "b"]);
    expect(out[0].replies.map((r) => r.id)).toEqual(["ar", "ar2"]);
    expect(out[1].replies.map((r) => r.id)).toEqual(["br"]);
  });

  it("breaks created_at ties by id ascending", () => {
    const root = ann({ id: "root", created_at: "2026-05-08T00:00:00Z" });
    const a = ann({ id: "b", thread_id: "root", created_at: "2026-05-08T00:00:01Z" });
    const b = ann({ id: "a", thread_id: "root", created_at: "2026-05-08T00:00:01Z" });
    const out = buildThreads([root, a, b]);
    expect(out[0].replies.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("latestHumanLeafId", () => {
  // Latest-human-leaf rule for the webapp "Send to {agent}" affordance
  // (issue #190, PRD #181). The rule picks the human Comment that
  // should carry the Send button in a Thread — at most one per Thread.
  //
  // The simplification used: the latest comment in the Thread by
  // `created_at` (id ascending tiebreak, matching buildThreads) is
  // always the latest node in a structurally-flat Thread. So the rule
  // collapses to "the latest overall, if human; otherwise null". If the
  // latest turn is agent-authored, no Send button anywhere — the user is
  // expected to write a human Reply first.

  it("returns the top-level id when it's a human Comment with no replies", () => {
    const a = ann({ id: "a", author_kind: "human" });
    expect(latestHumanLeafId(a, [])).toBe("a");
  });

  it("returns null when the top-level is agent and there are no replies", () => {
    const a = ann({ id: "a", author_kind: "agent" });
    expect(latestHumanLeafId(a, [])).toBe(null);
  });

  it("returns the latest human Reply when the top-level is agent and all replies are human leaves", () => {
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("r2");
  });

  it("returns the latest human Reply", () => {
    // [agent] top + [human] r1 + [agent] r1a + [human] r2
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r1a = ann({ id: "r1a", thread_id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:02Z" });
    const r2 = ann({ id: "r2", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:03Z" });
    expect(latestHumanLeafId(top, [r1, r1a, r2])).toBe("r2");
  });

  it("returns null when the latest turn in the Thread is agent-authored", () => {
    // [agent] top + [human] r1 (leaf) + [agent] r2 (latest, leaf)
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", thread_id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe(null);
  });

  it("hides Send on a human top-level once any Reply lands (latest is the Reply)", () => {
    const top = ann({ id: "top", author_kind: "human", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", thread_id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:01Z" });
    expect(latestHumanLeafId(top, [r1])).toBe(null);
  });

  it("moves Send from a human top-level to the latest human Reply", () => {
    const top = ann({ id: "top", author_kind: "human", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", thread_id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("r2");
  });

  it("breaks created_at ties by id ascending (id-largest wins, matching buildThreads)", () => {
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "a", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "b", thread_id: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("b");
  });
});

describe("latestCommentId", () => {
  // The id of the latest Comment in the Thread by `created_at` (id
  // ascending tiebreak). Used by the webapp's single bottom action row
  // (issue #191) as the Reply target — a new Reply continues from
  // where the conversation is, not from where it started.

  it("returns the top-level id when there are no replies", () => {
    const a = ann({ id: "a", author_kind: "human" });
    expect(latestCommentId(a, [])).toBe("a");
  });

  it("returns the top-level id when there are no replies (agent top-level)", () => {
    const a = ann({ id: "a", author_kind: "agent" });
    expect(latestCommentId(a, [])).toBe("a");
  });

  it("returns the latest descendant id when descendants are newer than the top-level", () => {
    const top = ann({ id: "top", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({
      id: "r1",
      thread_id: "top",
      author_kind: "human",
      created_at: "2026-05-08T00:00:01Z",
    });
    const r2 = ann({
      id: "r2",
      thread_id: "top",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:02Z",
    });
    expect(latestCommentId(top, [r1, r2])).toBe("r2");
  });

  it("returns an agent-authored latest descendant id (unlike latestHumanLeafId)", () => {
    const top = ann({ id: "top", author_kind: "human", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({
      id: "r1",
      thread_id: "top",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:01Z",
    });
    expect(latestCommentId(top, [r1])).toBe("r1");
    expect(latestHumanLeafId(top, [r1])).toBe(null);
  });

  it("breaks created_at ties by id ascending (id-largest wins)", () => {
    const top = ann({ id: "top", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "a", thread_id: "top", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "b", thread_id: "top", created_at: "2026-05-08T00:00:01Z" });
    expect(latestCommentId(top, [r1, r2])).toBe("b");
  });
});

describe("topLevelComments", () => {
  it("topLevelComments filters out replies", () => {
    const a = ann({ id: "a" });
    const b = ann({ id: "b", thread_id: "a" });
    const c = ann({ id: "c" });
    expect(topLevelComments([a, b, c])).toEqual([a, c]);
  });
});
