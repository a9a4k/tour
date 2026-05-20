import { describe, it, expect } from "vitest";
import { buildConversationTree } from "../../src/core/pickup.js";
import type { Comment, Tour } from "../../src/core/types.js";

function tour(over: Partial<Tour> = {}): Tour {
  return {
    id: "2026-05-08-120000-abcd",
    title: "Test tour",
    status: "open",
    created_at: "2026-05-08T12:00:00Z",
    closed_at: "",
    head_sha: "a".repeat(40),
    base_sha: "b".repeat(40),
    head_source: "HEAD",
    base_source: "main",
    wip_snapshot: false,
    ...over,
  };
}

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

describe("buildConversationTree", () => {
  it("returns the documented Tour metadata fields plus an empty comments[] for an empty Tour", () => {
    const t = tour();
    const out = buildConversationTree(t, []);
    expect(out).toEqual({
      id: t.id,
      title: t.title,
      head_sha: t.head_sha,
      base_sha: t.base_sha,
      head_source: t.head_source,
      base_source: t.base_source,
      status: t.status,
      comments: [],
    });
  });

  it("omits title when the Tour title is the empty string", () => {
    const out = buildConversationTree(tour({ title: "" }), []);
    expect(out).not.toHaveProperty("title");
  });

  it("does not leak transient or ref-tracking fields (closed_at, wip_snapshot)", () => {
    const out = buildConversationTree(tour({ closed_at: "2026-05-09T00:00:00Z" }), []);
    expect(out).not.toHaveProperty("closed_at");
    expect(out).not.toHaveProperty("wip_snapshot");
    expect(out).not.toHaveProperty("created_at");
  });

  it("emits each top-level Comment with an empty replies[] when there are no replies", () => {
    const a = ann({ id: "a1", created_at: "2026-05-08T00:00:01Z" });
    const b = ann({ id: "a2", created_at: "2026-05-08T00:00:02Z" });
    const out = buildConversationTree(tour(), [a, b]);
    expect(out.comments).toHaveLength(2);
    expect(out.comments[0].id).toBe("a1");
    expect(out.comments[0].replies).toEqual([]);
    expect(out.comments[1].id).toBe("a2");
    expect(out.comments[1].replies).toEqual([]);
  });

  it("nests replies inside their root Comment in chronological order", () => {
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
    const out = buildConversationTree(tour(), [root, r2, r1]);
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0].id).toBe("r1");
    expect(out.comments[0].replies.map((r) => r.id)).toEqual([
      "r1-rep1",
      "r1-rep2",
    ]);
  });

  it("orders top-level comments by created_at ascending (deterministic)", () => {
    const a = ann({ id: "a1", created_at: "2026-05-08T00:00:05Z" });
    const b = ann({ id: "a2", created_at: "2026-05-08T00:00:01Z" });
    const c = ann({ id: "a3", created_at: "2026-05-08T00:00:03Z" });
    const out = buildConversationTree(tour(), [a, b, c]);
    expect(out.comments.map((a) => a.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("attaches replies under the root Comment (flat replies[])", () => {
    const root = ann({ id: "root", created_at: "2026-05-08T00:00:00Z" });
    const rep1 = ann({
      id: "rep1",
      thread_id: "root",
      author_kind: "human",
      created_at: "2026-05-08T00:00:02Z",
    });
    const rep2 = ann({
      id: "rep2",
      thread_id: "root",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:03Z",
    });
    const out = buildConversationTree(tour(), [root, rep1, rep2]);
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0].replies.map((r) => r.id)).toEqual(["rep1", "rep2"]);
  });

  it("drops orphan replies (thread_id → unknown id)", () => {
    const a = ann({ id: "a" });
    const orph = ann({ id: "orph", thread_id: "ghost" });
    const out = buildConversationTree(tour(), [a, orph]);
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0].id).toBe("a");
    expect(out.comments[0].replies).toEqual([]);
  });

  it("preserves all Comment fields (no projection / no status / no ranking)", () => {
    const root = ann({
      id: "r",
      file: "src/foo.ts",
      side: "deletions",
      line_start: 5,
      line_end: 7,
      body: "why?",
      author: "claude-code",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:00Z",
    });
    const reply = ann({
      id: "r-rep",
      file: "src/foo.ts",
      side: "deletions",
      line_start: 5,
      line_end: 7,
      body: "because…",
      author: "almas",
      author_kind: "human",
      thread_id: "r",
      created_at: "2026-05-08T00:00:02Z",
    });
    const out = buildConversationTree(tour(), [root, reply]);
    const top = out.comments[0];
    expect(top.file).toBe("src/foo.ts");
    expect(top.side).toBe("deletions");
    expect(top.line_start).toBe(5);
    expect(top.line_end).toBe(7);
    expect(top.body).toBe("why?");
    expect(top.author).toBe("claude-code");
    expect(top.author_kind).toBe("agent");
    // No editorial fields
    expect(top).not.toHaveProperty("status");
    expect(top).not.toHaveProperty("rank");
    expect(top).not.toHaveProperty("actionable");
    const rep = top.replies[0];
    expect(rep.author_kind).toBe("human");
    expect(rep.author).toBe("almas");
    expect(rep.body).toBe("because…");
    expect(rep.thread_id).toBe("r");
  });

  it("produces deterministic output for the same input regardless of input ordering", () => {
    const t = tour({ id: "2026-05-08-120000-abcd", title: "Sample" });
    const root = ann({
      id: "root1",
      file: "src/a.ts",
      body: "Initial review",
      created_at: "2026-05-08T00:00:00Z",
    });
    const human = ann({
      id: "human1",
      file: "src/a.ts",
      body: "I disagree",
      author: "almas",
      author_kind: "human",
      thread_id: "root1",
      created_at: "2026-05-08T00:00:01Z",
    });
    const agent = ann({
      id: "agent1",
      file: "src/a.ts",
      body: "Fair point",
      thread_id: "root1",
      created_at: "2026-05-08T00:00:02Z",
    });
    const root2 = ann({
      id: "root2",
      file: "src/b.ts",
      body: "Another note",
      created_at: "2026-05-08T00:00:05Z",
    });
    const a = buildConversationTree(t, [agent, root2, human, root]);
    const b = buildConversationTree(t, [root, human, agent, root2]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.comments.map((a) => a.id)).toEqual(["root1", "root2"]);
    expect(a.comments[0].replies.map((r) => r.id)).toEqual(["human1", "agent1"]);
  });
});
