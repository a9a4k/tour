import { describe, it, expect, beforeEach } from "vitest";
import {
  appendAnnotation,
  appendAnnotations,
  readAnnotations,
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
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("annotations-store", () => {
  let dir: string;
  const reviewId = "2026-05-08-120000-abcd";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "review-ann-"));
    await mkdir(join(dir, ".review", reviewId), { recursive: true });
  });

  describe("appendAnnotation + readAnnotations", () => {
    it("round-trips a single annotation", async () => {
      const ann = makeAnnotation();
      await appendAnnotation(dir, reviewId, ann);
      const loaded = await readAnnotations(dir, reviewId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("ann-1");
      expect(loaded[0].file).toBe("src/main.ts");
      expect(loaded[0].side).toBe("additions");
      expect(loaded[0].line_start).toBe(10);
      expect(loaded[0].body).toBe("Consider extracting this into a helper.");
      expect(loaded[0].author).toBe("claude-code");
    });

    it("appends multiple annotations in sequence", async () => {
      await appendAnnotation(dir, reviewId, makeAnnotation({ id: "ann-1" }));
      await appendAnnotation(dir, reviewId, makeAnnotation({ id: "ann-2" }));
      await appendAnnotation(dir, reviewId, makeAnnotation({ id: "ann-3" }));
      const loaded = await readAnnotations(dir, reviewId);
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
      await appendAnnotations(dir, reviewId, anns);
      const loaded = await readAnnotations(dir, reviewId);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((a) => a.id)).toEqual(["b-1", "b-2", "b-3"]);
    });
  });

  describe("readAnnotations", () => {
    it("returns empty array when file does not exist", async () => {
      const loaded = await readAnnotations(dir, reviewId);
      expect(loaded).toEqual([]);
    });

    it("skips malformed lines", async () => {
      const path = join(dir, ".review", reviewId, "annotations.jsonl");
      const good = JSON.stringify(makeAnnotation({ id: "good" }));
      appendFileSync(path, good + "\n" + "NOT JSON\n" + good.replace("good", "also-good") + "\n");
      const loaded = await readAnnotations(dir, reviewId);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe("good");
      expect(loaded[1].id).toBe("also-good");
    });
  });

  describe("multi-line ranges", () => {
    it("stores and retrieves line_start != line_end", async () => {
      await appendAnnotation(
        dir,
        reviewId,
        makeAnnotation({ line_start: 5, line_end: 15 }),
      );
      const loaded = await readAnnotations(dir, reviewId);
      expect(loaded[0].line_start).toBe(5);
      expect(loaded[0].line_end).toBe(15);
    });
  });
});
