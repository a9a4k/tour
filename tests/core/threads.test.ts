import { describe, it, expect } from "vitest";
import {
  buildThreads,
  isTopLevel,
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
