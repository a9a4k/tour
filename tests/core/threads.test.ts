import { describe, it, expect } from "vitest";
import {
  buildThreads,
  isTopLevel,
  latestHumanLeafId,
  topLevelAnnotations,
} from "../../src/core/threads.js";
import type { Annotation } from "../../src/core/types.js";

function ann(over: Partial<Annotation> & { id: string }): Annotation {
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

  it("returns each top-level annotation as its own thread with no replies", () => {
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
      replies_to: "r1",
      author_kind: "human",
      created_at: "2026-05-08T00:00:02Z",
    });
    const r2 = ann({
      id: "r1-rep2",
      replies_to: "r1",
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

  it("interleaves replies for multiple top-level annotations correctly", () => {
    const a = ann({ id: "a", created_at: "2026-05-08T00:00:00Z" });
    const b = ann({ id: "b", created_at: "2026-05-08T00:00:01Z" });
    const ar = ann({ id: "ar", replies_to: "a", created_at: "2026-05-08T00:00:02Z" });
    const br = ann({ id: "br", replies_to: "b", created_at: "2026-05-08T00:00:03Z" });
    const ar2 = ann({ id: "ar2", replies_to: "a", created_at: "2026-05-08T00:00:04Z" });
    const out = buildThreads([a, b, ar, br, ar2]);
    expect(out.map((t) => t.root.id)).toEqual(["a", "b"]);
    expect(out[0].replies.map((r) => r.id)).toEqual(["ar", "ar2"]);
    expect(out[1].replies.map((r) => r.id)).toEqual(["br"]);
  });

  it("silently drops orphan replies whose replies_to does not exist", () => {
    const a = ann({ id: "a" });
    const orphan = ann({ id: "orph", replies_to: "missing" });
    const out = buildThreads([a, orphan]);
    expect(out).toHaveLength(1);
    expect(out[0].root.id).toBe("a");
    expect(out[0].replies).toHaveLength(0);
  });

  it("does not return a thread rooted at an orphan reply", () => {
    const orphan = ann({ id: "orph", replies_to: "missing" });
    expect(buildThreads([orphan])).toEqual([]);
  });

  it("attaches reply-to-reply chains under the root thread, ordered by created_at", () => {
    const root = ann({ id: "root", created_at: "2026-05-08T00:00:00Z" });
    const rep1 = ann({ id: "r1", replies_to: "root", created_at: "2026-05-08T00:00:02Z" });
    const rep2 = ann({ id: "r2", replies_to: "r1", created_at: "2026-05-08T00:00:03Z" });
    const out = buildThreads([root, rep1, rep2]);
    expect(out).toHaveLength(1);
    expect(out[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("breaks created_at ties by id ascending", () => {
    const root = ann({ id: "root", created_at: "2026-05-08T00:00:00Z" });
    const a = ann({ id: "b", replies_to: "root", created_at: "2026-05-08T00:00:01Z" });
    const b = ann({ id: "a", replies_to: "root", created_at: "2026-05-08T00:00:01Z" });
    const out = buildThreads([root, a, b]);
    expect(out[0].replies.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops a reply whose chain forms a cycle", () => {
    const a = ann({ id: "a", replies_to: "b" });
    const b = ann({ id: "b", replies_to: "a" });
    expect(buildThreads([a, b])).toEqual([]);
  });
});

describe("latestHumanLeafId", () => {
  // Latest-human-leaf rule for the webapp "Send to {agent}" affordance
  // (issue #190, PRD #181). The rule picks the human Annotation that
  // should carry the Send button in a Thread — at most one per Thread.
  //
  // The simplification used: the latest annotation in the Thread by
  // `created_at` (id ascending tiebreak, matching buildThreads) is
  // always a leaf in a well-formed tree (its parent must have an
  // earlier or equal `created_at`). So the rule collapses to "the
  // latest overall, if human; otherwise null". If the latest turn is
  // agent-authored, no Send button anywhere — the user is expected to
  // write a human Reply first.

  it("returns the top-level id when it's a human Annotation with no replies", () => {
    const a = ann({ id: "a", author_kind: "human" });
    expect(latestHumanLeafId(a, [])).toBe("a");
  });

  it("returns null when the top-level is agent and there are no replies", () => {
    const a = ann({ id: "a", author_kind: "agent" });
    expect(latestHumanLeafId(a, [])).toBe(null);
  });

  it("returns the latest human Reply when the top-level is agent and all replies are human leaves", () => {
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("r2");
  });

  it("returns the latest human leaf, ignoring an older human Reply that has its own child", () => {
    // [agent] top + [human] r1 (has child r1a) + [agent] r1a + [human] r2 (leaf)
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r1a = ann({ id: "r1a", replies_to: "r1", author_kind: "agent", created_at: "2026-05-08T00:00:02Z" });
    const r2 = ann({ id: "r2", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:03Z" });
    expect(latestHumanLeafId(top, [r1, r1a, r2])).toBe("r2");
  });

  it("returns null when the latest turn in the Thread is agent-authored", () => {
    // [agent] top + [human] r1 (leaf) + [agent] r2 (latest, leaf)
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", replies_to: "top", author_kind: "agent", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe(null);
  });

  it("hides Send on a human top-level once any Reply lands (latest is the Reply)", () => {
    const top = ann({ id: "top", author_kind: "human", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", replies_to: "top", author_kind: "agent", created_at: "2026-05-08T00:00:01Z" });
    expect(latestHumanLeafId(top, [r1])).toBe(null);
  });

  it("moves Send from a human top-level to the latest human descendant", () => {
    const top = ann({ id: "top", author_kind: "human", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "r1", replies_to: "top", author_kind: "agent", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "r2", replies_to: "r1", author_kind: "human", created_at: "2026-05-08T00:00:02Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("r2");
  });

  it("breaks created_at ties by id ascending (id-largest wins, matching buildThreads)", () => {
    const top = ann({ id: "top", author_kind: "agent", created_at: "2026-05-08T00:00:00Z" });
    const r1 = ann({ id: "a", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    const r2 = ann({ id: "b", replies_to: "top", author_kind: "human", created_at: "2026-05-08T00:00:01Z" });
    expect(latestHumanLeafId(top, [r1, r2])).toBe("b");
  });
});

describe("isTopLevel / topLevelAnnotations", () => {
  it("isTopLevel: true when replies_to is undefined", () => {
    expect(isTopLevel(ann({ id: "a" }))).toBe(true);
    expect(isTopLevel(ann({ id: "a", replies_to: "x" }))).toBe(false);
  });

  it("topLevelAnnotations filters out replies", () => {
    const a = ann({ id: "a" });
    const b = ann({ id: "b", replies_to: "a" });
    const c = ann({ id: "c" });
    expect(topLevelAnnotations([a, b, c])).toEqual([a, c]);
  });
});
