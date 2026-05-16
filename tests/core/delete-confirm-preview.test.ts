import { describe, it, expect } from "vitest";
import {
  cascadeFor,
  cascadeNote,
  bodyExcerpt,
  formatRelativeAge,
  type DeleteCascade,
} from "../../src/core/delete-confirm-preview.js";
import type { Comment } from "../../src/core/types.js";
import type { Thread } from "../../src/core/threads.js";

// ADR 0036 Slice D / issue #388 — delete-confirm modal preview.

function mkComment(over: Partial<Comment> & { id: string }): Comment {
  return {
    id: over.id,
    file: over.file ?? "foo.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 10,
    line_end: over.line_end ?? 10,
    body: over.body ?? "body",
    author: over.author ?? "human",
    author_kind: over.author_kind ?? "human",
    created_at: over.created_at ?? "2026-05-13T00:00:00Z",
    ...(over.replies_to !== undefined ? { replies_to: over.replies_to } : {}),
  };
}

function thread(root: Comment, replies: Comment[] = []): Thread {
  return { root, replies };
}

describe("cascadeFor (ADR 0036 Slice D / issue #388)", () => {
  it("parent with surviving replies → { kind: 'parent-stub', survivorCount }", () => {
    const root = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    const r2 = mkComment({ id: "r2", replies_to: "p1" });
    const r3 = mkComment({ id: "r3", replies_to: "p1" });
    const ts = [thread(root, [r1, r2, r3])];
    expect(cascadeFor(root, ts)).toEqual({
      kind: "parent-stub",
      survivorCount: 3,
    });
  });

  it("parent with no replies → { kind: 'thread-vanishes' } (Thread vanishes)", () => {
    const root = mkComment({ id: "p1" });
    const ts = [thread(root, [])];
    expect(cascadeFor(root, ts)).toEqual({ kind: "thread-vanishes" });
  });

  it("reply leaf with siblings → { kind: 'reply-only' }", () => {
    const root = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    const r2 = mkComment({ id: "r2", replies_to: "p1" });
    const ts = [thread(root, [r1, r2])];
    expect(cascadeFor(r1, ts)).toEqual({ kind: "reply-only" });
  });

  it("reply leaf with live parent and no siblings → { kind: 'reply-only' } (parent + stub stays under live parent)", () => {
    const root = mkComment({ id: "p1" });
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    const ts = [thread(root, [r1])];
    expect(cascadeFor(r1, ts)).toEqual({ kind: "reply-only" });
  });

  it("reply leaf whose parent is already a [deleted] stub and which is the only reply → 'thread-vanishes'", () => {
    const root: Comment = {
      ...mkComment({ id: "p1", body: "" }),
      ...({ deleted: { at: "2026-05-13T01:00:00Z" } } as object),
    } as Comment;
    const r1 = mkComment({ id: "r1", replies_to: "p1" });
    const ts = [thread(root, [r1])];
    expect(cascadeFor(r1, ts)).toEqual({ kind: "thread-vanishes" });
  });

  it("reply target whose parent has no matching Thread entry falls back to { kind: 'reply-only' }", () => {
    // Degenerate state: orphaned reply (the fold drops these from the
    // projection, but the modal lookup must not throw). Fall back to the
    // safe "reply removed" message.
    const orphan = mkComment({ id: "orphan", replies_to: "ghost" });
    expect(cascadeFor(orphan, [])).toEqual({ kind: "reply-only" });
  });
});

describe("cascadeNote (ADR 0036 Slice D / issue #388)", () => {
  it("reply target → 'this reply will be removed from the thread.'", () => {
    const c: DeleteCascade = { kind: "reply-only" };
    expect(cascadeNote(c)).toBe("this reply will be removed from the thread.");
  });

  it("parent with surviving replies (1) → '1 reply will remain under [deleted].' (singular)", () => {
    expect(cascadeNote({ kind: "parent-stub", survivorCount: 1 })).toBe(
      "1 reply will remain under [deleted].",
    );
  });

  it("parent with surviving replies (N>1) → 'N replies will remain under [deleted].' (plural)", () => {
    expect(cascadeNote({ kind: "parent-stub", survivorCount: 3 })).toBe(
      "3 replies will remain under [deleted].",
    );
  });

  it("last live node in thread → 'the thread will vanish.'", () => {
    expect(cascadeNote({ kind: "thread-vanishes" })).toBe(
      "the thread will vanish.",
    );
  });
});

describe("bodyExcerpt", () => {
  it("returns the body unchanged when short", () => {
    expect(bodyExcerpt("short body")).toBe("short body");
  });

  it("collapses whitespace and trims", () => {
    expect(bodyExcerpt("  hello\n  \tworld\n\n")).toBe("hello world");
  });

  it("truncates long bodies with an ellipsis at 120 chars", () => {
    const long = "x".repeat(200);
    const out = bodyExcerpt(long);
    expect(out.length).toBe(121); // 120 + "…"
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("formatRelativeAge", () => {
  it("'just now' when delta < 1 minute", () => {
    const now = Date.parse("2026-05-16T10:00:00Z");
    expect(formatRelativeAge("2026-05-16T09:59:30Z", now)).toBe("just now");
  });

  it("minutes / hours / days bucketing matches tour-list's formatAge shape", () => {
    const now = Date.parse("2026-05-16T10:00:00Z");
    expect(formatRelativeAge("2026-05-16T09:55:00Z", now)).toBe("5m ago");
    expect(formatRelativeAge("2026-05-16T07:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeAge("2026-05-14T10:00:00Z", now)).toBe("2d ago");
  });

  it("negative delta clamps to 'just now' (skewed clocks)", () => {
    const now = Date.parse("2026-05-16T10:00:00Z");
    expect(formatRelativeAge("2026-05-16T11:00:00Z", now)).toBe("just now");
  });
});
