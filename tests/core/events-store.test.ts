import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendEvent,
  appendEvents,
  eventsPath,
  readEvents,
} from "../../src/core/events-store.js";
import type { TourEvent } from "../../src/core/types.js";

const tourId = "2026-05-16-100000-test";

function commentCreated(id: string, body = "b"):
  Extract<TourEvent, { kind: "comment.created" }> {
  return {
    kind: "comment.created",
    id,
    file: "src/x.ts",
    side: "additions",
    line_start: 1,
    line_end: 1,
    body,
    author: "agent",
    author_kind: "agent",
    at: "2026-05-16T10:00:00Z",
  };
}

function replyCreated(id: string, thread_id: string):
  Extract<TourEvent, { kind: "reply.created" }> {
  return {
    kind: "reply.created",
    id,
    thread_id,
    body: "r",
    author: "human",
    author_kind: "human",
    at: "2026-05-16T10:01:00Z",
  };
}

describe("events-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-events-"));
    await mkdir(join(dir, tourId), { recursive: true });
  });

  describe("eventsPath", () => {
    it("returns `<tour-store-root>/<id>/tour-events.jsonl`", () => {
      expect(eventsPath("/repo", "T1")).toBe(join("/repo", "T1", "tour-events.jsonl"));
    });
  });

  describe("appendEvent + readEvents roundtrip", () => {
    it("returns [] when the events file does not exist", async () => {
      expect(await readEvents(dir, tourId)).toEqual([]);
    });

    it("returns [] for an empty events file", async () => {
      await writeFile(eventsPath(dir, tourId), "");
      expect(await readEvents(dir, tourId)).toEqual([]);
    });

    it("roundtrips a single comment.created event", async () => {
      const ev = commentCreated("c1", "hello");
      await appendEvent(dir, tourId, ev);
      const events = await readEvents(dir, tourId);
      expect(events).toEqual([ev]);
    });

    it("roundtrips a heterogeneous sequence (comment.created, reply.created, comment.deleted)", async () => {
      const e1 = commentCreated("p");
      const e2 = replyCreated("r", "p");
      const e3: TourEvent = { kind: "comment.deleted", target_id: "r", at: "2026-05-16T11:00:00Z" };
      await appendEvent(dir, tourId, e1);
      await appendEvent(dir, tourId, e2);
      await appendEvent(dir, tourId, e3);
      const events = await readEvents(dir, tourId);
      expect(events).toEqual([e1, e2, e3]);
    });

    it("writes one line per appendEvent call (newline-terminated)", async () => {
      await appendEvent(dir, tourId, commentCreated("a"));
      await appendEvent(dir, tourId, commentCreated("b"));
      const content = await readFile(eventsPath(dir, tourId), "utf-8");
      expect(content.endsWith("\n")).toBe(true);
      expect(content.split("\n").filter((l) => l).length).toBe(2);
    });
  });

  describe("appendEvents (batch)", () => {
    it("writes the batch in a single line-joined chunk", async () => {
      const events: TourEvent[] = [
        commentCreated("a"),
        commentCreated("b"),
        commentCreated("c"),
      ];
      await appendEvents(dir, tourId, events);
      const content = await readFile(eventsPath(dir, tourId), "utf-8");
      expect(content).toBe(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      expect(await readEvents(dir, tourId)).toEqual(events);
    });

    it("is a no-op on an empty batch (does not create the file)", async () => {
      await appendEvents(dir, tourId, []);
      expect(await readEvents(dir, tourId)).toEqual([]);
    });
  });

  describe("readEvents tolerance", () => {
    it("skips malformed JSON lines", async () => {
      const e = commentCreated("ok");
      const path = eventsPath(dir, tourId);
      await writeFile(
        path,
        JSON.stringify(e) + "\n" + "NOT JSON\n" + JSON.stringify(commentCreated("ok2")) + "\n",
      );
      const events = await readEvents(dir, tourId);
      expect(events.map((x) => (x as { id?: string }).id)).toEqual(["ok", "ok2"]);
    });

    it("skips lines with an unknown `kind`", async () => {
      const path = eventsPath(dir, tourId);
      const unknown = JSON.stringify({ kind: "comment.edited", id: "x", at: "z" });
      const valid = JSON.stringify(commentCreated("c1"));
      await writeFile(path, unknown + "\n" + valid + "\n");
      const events = await readEvents(dir, tourId);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("comment.created");
    });

    it("skips lines with missing required fields", async () => {
      const path = eventsPath(dir, tourId);
      const missingId = JSON.stringify({ kind: "comment.created", at: "z" });
      const validLine = JSON.stringify(commentCreated("c1"));
      await writeFile(path, missingId + "\n" + validLine + "\n");
      const events = await readEvents(dir, tourId);
      expect(events).toHaveLength(1);
      expect((events[0] as { id?: string }).id).toBe("c1");
    });

    it("ignores blank lines", async () => {
      const path = eventsPath(dir, tourId);
      const e = commentCreated("a");
      await writeFile(path, JSON.stringify(e) + "\n\n\n");
      const events = await readEvents(dir, tourId);
      expect(events).toEqual([e]);
    });

    it("skips lines with invalid author_kind", async () => {
      const path = eventsPath(dir, tourId);
      const bad = JSON.stringify({ ...commentCreated("bad"), author_kind: "robot" });
      const ok = JSON.stringify(commentCreated("ok"));
      await writeFile(path, bad + "\n" + ok + "\n");
      const events = await readEvents(dir, tourId);
      expect(events).toHaveLength(1);
      expect((events[0] as { id?: string }).id).toBe("ok");
    });
  });
});
