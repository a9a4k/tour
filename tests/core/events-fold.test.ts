import { describe, it, expect } from "vitest";
import { foldEventsToComments } from "../../src/core/events-fold.js";
import type { TourEvent } from "../../src/core/types.js";

function createTop(over: Partial<Extract<TourEvent, { kind: "comment.created" }>> & { id: string }):
  Extract<TourEvent, { kind: "comment.created" }> {
  return {
    kind: "comment.created",
    id: over.id,
    file: over.file ?? "src/x.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 10,
    line_end: over.line_end ?? 10,
    body: over.body ?? "body of " + over.id,
    author: over.author ?? "agent",
    author_kind: over.author_kind ?? "agent",
    at: over.at ?? "2026-05-16T10:00:00Z",
  };
}

function createReply(over: Partial<Extract<TourEvent, { kind: "reply.created" }>> & {
  id: string;
  thread_id: string;
}): Extract<TourEvent, { kind: "reply.created" }> {
  return {
    kind: "reply.created",
    id: over.id,
    thread_id: over.thread_id,
    body: over.body ?? "reply " + over.id,
    author: over.author ?? "human",
    author_kind: over.author_kind ?? "human",
    at: over.at ?? "2026-05-16T10:01:00Z",
  };
}

function deleteEvent(target_id: string, at = "2026-05-16T11:00:00Z"):
  Extract<TourEvent, { kind: "comment.deleted" }> {
  return { kind: "comment.deleted", target_id, at };
}

describe("foldEventsToComments", () => {
  describe("creates and replies (no delete)", () => {
    it("projects an empty event log to an empty list", () => {
      expect(foldEventsToComments([])).toEqual([]);
    });

    it("projects a single comment.created to a single CommentState", () => {
      const ev = createTop({ id: "c1", body: "hello" });
      const out = foldEventsToComments([ev]);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        id: "c1",
        file: "src/x.ts",
        side: "additions",
        line_start: 10,
        line_end: 10,
        body: "hello",
        author: "agent",
        author_kind: "agent",
        created_at: "2026-05-16T10:00:00Z",
      });
      expect(out[0].deleted).toBeUndefined();
    });

    it("inherits the parent's anchor on reply.created", () => {
      const events: TourEvent[] = [
        createTop({
          id: "p1",
          file: "lib/y.ts",
          side: "deletions",
          line_start: 5,
          line_end: 7,
        }),
        createReply({ id: "r1", thread_id: "p1", body: "agreed" }),
      ];
      const out = foldEventsToComments(events);
      expect(out).toHaveLength(2);
      const reply = out[1];
      expect(reply.id).toBe("r1");
      expect(reply.thread_id).toBe("p1");
      expect(reply.file).toBe("lib/y.ts");
      expect(reply.side).toBe("deletions");
      expect(reply.line_start).toBe(5);
      expect(reply.line_end).toBe(7);
      expect(reply.body).toBe("agreed");
    });

    it("preserves append order on the projection", () => {
      const events: TourEvent[] = [
        createTop({ id: "a" }),
        createTop({ id: "b" }),
        createReply({ id: "ra", thread_id: "a" }),
        createTop({ id: "c" }),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["a", "b", "ra", "c"]);
    });
  });

  describe("C4 cascade: deleted leaf Reply", () => {
    it("removes a deleted leaf Reply from the projection", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r1", thread_id: "p" }),
        createReply({ id: "r2", thread_id: "p" }),
        deleteEvent("r2"),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["p", "r1"]);
    });
  });

  describe("C4 cascade: deleted parent with surviving replies", () => {
    it("projects a [deleted] stub with empty body, retaining the anchor", () => {
      const events: TourEvent[] = [
        createTop({
          id: "p",
          file: "src/a.ts",
          side: "additions",
          line_start: 12,
          line_end: 14,
          body: "original body",
        }),
        createReply({ id: "r1", thread_id: "p", body: "still relevant" }),
        deleteEvent("p", "2026-05-16T12:30:00Z"),
      ];
      const out = foldEventsToComments(events);
      expect(out).toHaveLength(2);
      const stub = out[0];
      expect(stub.id).toBe("p");
      expect(stub.body).toBe("");
      expect(stub.file).toBe("src/a.ts");
      expect(stub.side).toBe("additions");
      expect(stub.line_start).toBe(12);
      expect(stub.line_end).toBe(14);
      expect(stub.deleted).toEqual({ at: "2026-05-16T12:30:00Z" });
      const reply = out[1];
      expect(reply.id).toBe("r1");
      expect(reply.body).toBe("still relevant");
      expect(reply.deleted).toBeUndefined();
    });

    it("keeps the stub when only some replies are deleted", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r1", thread_id: "p" }),
        createReply({ id: "r2", thread_id: "p" }),
        createReply({ id: "r3", thread_id: "p" }),
        deleteEvent("p"),
        deleteEvent("r2"),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["p", "r1", "r3"]);
      expect(out[0].deleted).toBeDefined();
      expect(out[0].body).toBe("");
    });
  });

  describe("C4 cascade: fully-deleted Thread vanishes", () => {
    it("removes a thread where parent and all replies are deleted", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r1", thread_id: "p" }),
        createReply({ id: "r2", thread_id: "p" }),
        deleteEvent("r1"),
        deleteEvent("r2"),
        deleteEvent("p"),
      ];
      const out = foldEventsToComments(events);
      expect(out).toEqual([]);
    });

    it("removes a parent-only thread when the parent is deleted", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        deleteEvent("p"),
      ];
      const out = foldEventsToComments(events);
      expect(out).toEqual([]);
    });
  });

  describe("defence-in-depth at fold time", () => {
    it("ignores delete events targeting unknown ids", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        deleteEvent("ghost-id"),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["p"]);
      expect(out[0].deleted).toBeUndefined();
    });

    it("is idempotent on duplicate delete events for the same target (leaf reply)", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r", thread_id: "p" }),
        deleteEvent("r", "2026-05-16T12:00:00Z"),
        deleteEvent("r", "2026-05-16T13:00:00Z"),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["p"]);
    });

    it("is idempotent on duplicate delete events for the same target (parent stub)", () => {
      const events: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r", thread_id: "p" }),
        deleteEvent("p", "2026-05-16T12:00:00Z"),
        deleteEvent("p", "2026-05-16T13:00:00Z"),
      ];
      const out = foldEventsToComments(events);
      // First delete wins for `at` (append order is truth).
      expect(out).toHaveLength(2);
      expect(out[0].deleted).toEqual({ at: "2026-05-16T12:00:00Z" });
    });

    it("is order-independent in cascade outcome (same events, different append order)", () => {
      // Same set of events: parent + 2 replies, parent deleted, one reply
      // deleted. Append order shouldn't change the *set* of projected ids.
      const a: TourEvent[] = [
        createTop({ id: "p" }),
        createReply({ id: "r1", thread_id: "p" }),
        createReply({ id: "r2", thread_id: "p" }),
        deleteEvent("p"),
        deleteEvent("r2"),
      ];
      const b: TourEvent[] = [
        createTop({ id: "p" }),
        deleteEvent("r2"),
        createReply({ id: "r2", thread_id: "p" }),
        deleteEvent("p"),
        createReply({ id: "r1", thread_id: "p" }),
      ];
      const outA = foldEventsToComments(a);
      const outB = foldEventsToComments(b);
      expect(new Set(outA.map((c) => c.id))).toEqual(new Set(outB.map((c) => c.id)));
      const stubA = outA.find((c) => c.id === "p");
      const stubB = outB.find((c) => c.id === "p");
      expect(stubA?.deleted).toBeDefined();
      expect(stubB?.deleted).toBeDefined();
    });
  });

  describe("multi-thread projections", () => {
    it("does not cascade deletions across independent Threads", () => {
      const events: TourEvent[] = [
        createTop({ id: "p1" }),
        createTop({ id: "p2" }),
        createReply({ id: "r2", thread_id: "p2" }),
        deleteEvent("p1"),
      ];
      const out = foldEventsToComments(events);
      // p1 had no replies → vanishes. p2 + r2 untouched.
      expect(out.map((c) => c.id)).toEqual(["p2", "r2"]);
    });

    it("preserves event-append order across multiple Threads", () => {
      // The fold projects in event order; Thread grouping happens
      // downstream (`buildThreads`). Interleaved appends stay interleaved
      // in the flat projection — the consumer can re-group as needed.
      const events: TourEvent[] = [
        createTop({ id: "p1" }),
        createTop({ id: "p2" }),
        createReply({ id: "p2-r1", thread_id: "p2" }),
        createReply({ id: "p1-r1", thread_id: "p1" }),
        createReply({ id: "p2-r2", thread_id: "p2" }),
      ];
      const out = foldEventsToComments(events);
      expect(out.map((c) => c.id)).toEqual(["p1", "p2", "p2-r1", "p1-r1", "p2-r2"]);
    });
  });
});
