import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHumanAnnotation } from "../../src/web/server.js";
import {
  appendAnnotation,
  readAnnotations,
} from "../../src/core/annotations-store.js";
import type { Annotation } from "../../src/core/types.js";

// Slice 3 (#77): the webapp routes human-authored annotations through a
// POST endpoint that calls `createHumanAnnotation`. We validate the body
// shape, branch on `replies_to`, and stamp `author_kind: "human"` —
// mirroring the `tour annotate --as-human [--reply-to]` CLI surface.

describe("createHumanAnnotation", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-abcd";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-srv-"));
    await mkdir(join(dir, ".tour", tourId), { recursive: true });
  });

  it("builds a human-authored top-level annotation", async () => {
    const ann = await createHumanAnnotation(dir, tourId, {
      file: "src/main.ts",
      side: "additions",
      line_start: 5,
      line_end: 5,
      body: "this is a comment",
    });
    expect(ann.author_kind).toBe("human");
    expect(ann.file).toBe("src/main.ts");
    expect(ann.side).toBe("additions");
    expect(ann.line_start).toBe(5);
    expect(ann.line_end).toBe(5);
    expect(ann.body).toBe("this is a comment");
    expect(ann.author).toBe("you");
    expect(ann.replies_to).toBeUndefined();
  });

  it("accepts a multi-line range when line_end > line_start", async () => {
    const ann = await createHumanAnnotation(dir, tourId, {
      file: "x.ts",
      side: "additions",
      line_start: 5,
      line_end: 8,
      body: "range",
    });
    expect(ann.line_start).toBe(5);
    expect(ann.line_end).toBe(8);
  });

  it("honours an explicit author override", async () => {
    const ann = await createHumanAnnotation(dir, tourId, {
      file: "x.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "b",
      author: "almas",
    });
    expect(ann.author).toBe("almas");
  });

  it("builds a Reply that inherits the parent anchor and stamps replies_to", async () => {
    const parent: Annotation = {
      id: "parent-id",
      file: "src/x.ts",
      side: "deletions",
      line_start: 12,
      line_end: 14,
      body: "agent note",
      author: "agent",
      author_kind: "agent",
      created_at: "2026-05-08T00:00:00Z",
    };
    await appendAnnotation(dir, tourId, parent);
    const reply = await createHumanAnnotation(dir, tourId, {
      replies_to: "parent-id",
      body: "human reply body",
    });
    expect(reply.replies_to).toBe("parent-id");
    expect(reply.file).toBe(parent.file);
    expect(reply.side).toBe(parent.side);
    expect(reply.line_start).toBe(parent.line_start);
    expect(reply.line_end).toBe(parent.line_end);
    expect(reply.author_kind).toBe("human");
    expect(reply.body).toBe("human reply body");
  });

  it("throws when body is missing or whitespace-only", async () => {
    await expect(
      createHumanAnnotation(dir, tourId, {
        file: "x.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
      }),
    ).rejects.toThrow(/body/);
    await expect(
      createHumanAnnotation(dir, tourId, {
        file: "x.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "   \n  ",
      }),
    ).rejects.toThrow(/body/);
  });

  it("throws when side is invalid", async () => {
    await expect(
      createHumanAnnotation(dir, tourId, {
        file: "x.ts",
        side: "left",
        line_start: 1,
        line_end: 1,
        body: "b",
      }),
    ).rejects.toThrow(/side/);
  });

  it("throws when line_end < line_start", async () => {
    await expect(
      createHumanAnnotation(dir, tourId, {
        file: "x.ts",
        side: "additions",
        line_start: 9,
        line_end: 5,
        body: "b",
      }),
    ).rejects.toThrow(/line_end/);
  });

  it("throws when replies_to references an unknown parent", async () => {
    await expect(
      createHumanAnnotation(dir, tourId, {
        replies_to: "no-such-id",
        body: "b",
      }),
    ).rejects.toThrow(/no-such-id/);
  });

  it("appends to the same on-disk store the watcher observes", async () => {
    const ann = await createHumanAnnotation(dir, tourId, {
      file: "x.ts",
      side: "additions",
      line_start: 1,
      line_end: 1,
      body: "from webapp",
    });
    await appendAnnotation(dir, tourId, ann);
    const loaded = await readAnnotations(dir, tourId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(ann.id);
    expect(loaded[0].author_kind).toBe("human");
    expect(loaded[0].body).toBe("from webapp");
  });
});
