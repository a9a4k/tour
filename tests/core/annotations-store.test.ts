import { describe, it, expect, beforeEach } from "vitest";
import {
  appendAnnotation,
  appendAnnotations,
  readAnnotations,
  buildAnnotation,
  buildReply,
} from "../../src/core/annotations-store.js";
import type { Annotation } from "../../src/core/types.js";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendFileSync } from "node:fs";

function makeAnnotation(overrides?: Partial<Annotation>): Annotation {
  return {
    id: "ann-1",
    file: "src/main.ts",
    side: "additions",
    line_start: 10,
    line_end: 10,
    body: "Consider extracting this into a helper.",
    author: "claude-code",
    author_kind: "agent",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("annotations-store", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-abcd";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-ann-"));
    await mkdir(join(dir, ".tour", tourId), { recursive: true });
  });

  describe("appendAnnotation + readAnnotations", () => {
    it("round-trips a single annotation", async () => {
      const ann = makeAnnotation();
      await appendAnnotation(dir, tourId, ann);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("ann-1");
      expect(loaded[0].file).toBe("src/main.ts");
      expect(loaded[0].side).toBe("additions");
      expect(loaded[0].line_start).toBe(10);
      expect(loaded[0].body).toBe("Consider extracting this into a helper.");
      expect(loaded[0].author).toBe("claude-code");
    });

    it("appends multiple annotations in sequence", async () => {
      await appendAnnotation(dir, tourId, makeAnnotation({ id: "ann-1" }));
      await appendAnnotation(dir, tourId, makeAnnotation({ id: "ann-2" }));
      await appendAnnotation(dir, tourId, makeAnnotation({ id: "ann-3" }));
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((a) => a.id)).toEqual(["ann-1", "ann-2", "ann-3"]);
    });
  });

  describe("appendAnnotations (batch)", () => {
    it("writes multiple annotations at once", async () => {
      const anns = [
        makeAnnotation({ id: "b-1" }),
        makeAnnotation({ id: "b-2" }),
        makeAnnotation({ id: "b-3" }),
      ];
      await appendAnnotations(dir, tourId, anns);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((a) => a.id)).toEqual(["b-1", "b-2", "b-3"]);
    });
  });

  describe("readAnnotations", () => {
    it("returns empty array when file does not exist", async () => {
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("skips malformed lines", async () => {
      const path = join(dir, ".tour", tourId, "annotations.jsonl");
      const good = JSON.stringify(makeAnnotation({ id: "good" }));
      appendFileSync(path, good + "\n" + "NOT JSON\n" + good.replace("good", "also-good") + "\n");
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe("good");
      expect(loaded[1].id).toBe("also-good");
    });

    it("throws on pre-bidirectional data missing author_kind (no silent fallback)", async () => {
      const path = join(dir, ".tour", tourId, "annotations.jsonl");
      // Synthesise a pre-schema-break record (no author_kind field).
      const legacy = JSON.stringify({
        id: "legacy",
        file: "x.ts",
        side: "additions",
        line_start: 1,
        line_end: 1,
        body: "before bidirectional",
        author: "agent",
        created_at: "2026-01-01T00:00:00Z",
      });
      appendFileSync(path, legacy + "\n");
      await expect(readAnnotations(dir, tourId)).rejects.toThrow(/author_kind/);
    });

    it("throws on records with an invalid author_kind value", async () => {
      const path = join(dir, ".tour", tourId, "annotations.jsonl");
      const bad = JSON.stringify({
        ...makeAnnotation({ id: "bad" }),
        author_kind: "robot",
      });
      appendFileSync(path, bad + "\n");
      await expect(readAnnotations(dir, tourId)).rejects.toThrow(/author_kind/);
    });
  });

  describe("multi-line ranges", () => {
    it("stores and retrieves line_start != line_end", async () => {
      await appendAnnotation(
        dir,
        tourId,
        makeAnnotation({ line_start: 5, line_end: 15 }),
      );
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded[0].line_start).toBe(5);
      expect(loaded[0].line_end).toBe(15);
    });
  });
});

describe("buildAnnotation", () => {
  it("builds a top-level Annotation with the supplied fields and a fresh id + timestamp", () => {
    const ann = buildAnnotation({
      file: "src/main.ts",
      side: "additions",
      line_start: 7,
      line_end: 9,
      body: "looks good",
      author: "human-1",
      author_kind: "human",
    });
    expect(ann.file).toBe("src/main.ts");
    expect(ann.side).toBe("additions");
    expect(ann.line_start).toBe(7);
    expect(ann.line_end).toBe(9);
    expect(ann.body).toBe("looks good");
    expect(ann.author).toBe("human-1");
    expect(ann.author_kind).toBe("human");
    expect(ann.replies_to).toBeUndefined();
    expect(ann.id.length).toBeGreaterThan(0);
    expect(typeof ann.created_at).toBe("string");
  });

  it("defaults author to 'unknown' when omitted", () => {
    const ann = buildAnnotation({
      file: "x.ts",
      side: "deletions",
      line_start: 1,
      line_end: 1,
      body: "b",
      author_kind: "agent",
    });
    expect(ann.author).toBe("unknown");
  });
});

describe("buildReply", () => {
  const parent: Annotation = {
    id: "parent-1",
    file: "src/lib/x.ts",
    side: "deletions",
    line_start: 12,
    line_end: 14,
    body: "why?",
    author: "agent-bot",
    author_kind: "agent",
    created_at: "2026-05-08T00:00:00Z",
  };

  it("inherits the parent's anchor (file, side, line range)", () => {
    const reply = buildReply(
      {
        replies_to: parent.id,
        body: "because of legacy compat",
        author: "human-2",
        author_kind: "human",
      },
      [parent],
    );
    expect(reply.file).toBe(parent.file);
    expect(reply.side).toBe(parent.side);
    expect(reply.line_start).toBe(parent.line_start);
    expect(reply.line_end).toBe(parent.line_end);
    expect(reply.replies_to).toBe(parent.id);
    expect(reply.author_kind).toBe("human");
    expect(reply.body).toBe("because of legacy compat");
  });

  it("throws when the parent id is not in the existing list", () => {
    expect(() =>
      buildReply(
        {
          replies_to: "missing",
          body: "b",
          author_kind: "human",
        },
        [parent],
      ),
    ).toThrow(/missing/);
  });
});
