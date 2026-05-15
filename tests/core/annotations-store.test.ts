import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createAnnotation,
  createReply,
  createAnnotations,
  readAnnotations,
} from "../../src/core/annotations-store.js";
import type { Annotation, Tour } from "../../src/core/types.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import { mkdtemp, mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendFileSync, existsSync } from "node:fs";

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

// Direct JSONL append helper — sidesteps the seam to seed records with a
// caller-supplied id when the test needs to assert about that id (e.g.
// reply-parent lookup). The store's own `appendAnnotation` is private.
async function seedAnnotation(
  dir: string,
  tourId: string,
  ann: Annotation,
): Promise<void> {
  const path = join(dir, ".tour", tourId, "annotations.jsonl");
  await appendFile(path, JSON.stringify(ann) + "\n");
}

// Synthetic bundle for anchor validation. The seam only reads
// `files[].name`, `files[].oldContent`, `files[].newContent` for line-count
// checks; everything else is filler so the type compiles.
function makeBundle(
  files: Array<{
    name: string;
    oldLines?: number;
    newLines?: number;
  }>,
): TourBundle {
  const tour: Tour = {
    id: "2026-05-10-120000-abcd",
    title: "test",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: "0".repeat(40),
    base_sha: "1".repeat(40),
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
  };
  const bundleFiles: BundleFile[] = files.map((f) => {
    const oldLines = f.oldLines ?? 10;
    const newLines = f.newLines ?? 10;
    const oldContent =
      oldLines === 0
        ? ""
        : Array.from({ length: oldLines }, (_, i) => `old line ${i + 1}`).join("\n") + "\n";
    const newContent =
      newLines === 0
        ? ""
        : Array.from({ length: newLines }, (_, i) => `new line ${i + 1}`).join("\n") + "\n";
    return {
      name: f.name,
      type: "change",
      hunks: [],
      oldContent,
      newContent,
      classification: { collapsed: false },
      orphanWindows: [],
    };
  });
  return {
    kind: "ok",
    tour,
    annotations: [],
    diff: "",
    files: bundleFiles,
  };
}

describe("annotations-store", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-abcd";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-ann-"));
    await mkdir(join(dir, ".tour", tourId), { recursive: true });
  });

  describe("createAnnotation", () => {
    it("writes a top-level annotation that round-trips through readAnnotations", async () => {
      const bundle = makeBundle([{ name: "src/main.ts", newLines: 20 }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "src/main.ts",
          side: "additions",
          line_start: 7,
          line_end: 9,
          body: "looks good",
          author: "human-1",
          author_kind: "human",
        },
        bundle,
      );
      expect(ann.id.length).toBeGreaterThan(0);
      expect(typeof ann.created_at).toBe("string");
      expect(ann.replies_to).toBeUndefined();

      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(ann);
    });

    it("defaults author to 'agent' when omitted and author_kind is 'agent' (slice 3 / #143)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "deletions",
          line_start: 1,
          line_end: 1,
          body: "b",
          author_kind: "agent",
        },
        bundle,
      );
      expect(ann.author).toBe("agent");
    });

    it("defaults author to 'human' when omitted and author_kind is 'human' (slice 3 / #143)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "b",
          author_kind: "human",
        },
        bundle,
      );
      expect(ann.author).toBe("human");
    });

    it("preserves a supplied author verbatim regardless of author_kind (slice 3 / #143)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "b",
          author: "my-script",
          author_kind: "agent",
        },
        bundle,
      );
      expect(ann.author).toBe("my-script");
    });

    it("rejects whitespace-only body and writes nothing (slice 2 / #142)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 1,
            line_end: 1,
            body: "   \n\t  ",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/body/i);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("appends across multiple invocations", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }]);
      const a = await createAnnotation(
        dir,
        tourId,
        {
          file: "a.ts", side: "additions", line_start: 1, line_end: 1,
          body: "1", author_kind: "agent",
        },
        bundle,
      );
      const b = await createAnnotation(
        dir,
        tourId,
        {
          file: "b.ts", side: "additions", line_start: 2, line_end: 2,
          body: "2", author_kind: "agent",
        },
        bundle,
      );
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((x) => x.id)).toEqual([a.id, b.id]);
    });
  });

  describe("createAnnotation anchor validation (slice 4 / #144)", () => {
    it("rejects when file is not in bundle.files and writes nothing", async () => {
      const bundle = makeBundle([{ name: "real.ts" }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "typo.ts",
            side: "additions",
            line_start: 1,
            line_end: 1,
            body: "b",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/typo\.ts/);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects when line_start < 1", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 0,
            line_end: 0,
            body: "b",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/line_start/);
    });

    it("rejects when line_end < line_start", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 5,
            line_end: 3,
            body: "b",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/line_end/);
    });

    it("rejects when additions line_end exceeds the head line count", async () => {
      const bundle = makeBundle([{ name: "x.ts", newLines: 10 }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 9,
            line_end: 11,
            body: "b",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/line/i);
    });

    it("rejects when deletions line_end exceeds the base line count", async () => {
      const bundle = makeBundle([{ name: "x.ts", oldLines: 5, newLines: 20 }]);
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "deletions",
            line_start: 4,
            line_end: 7,
            body: "b",
            author_kind: "agent",
          },
          bundle,
        ),
      ).rejects.toThrow(/line/i);
    });

    it("accepts an anchor in hidden context (in-range, no hunks defined)", async () => {
      // hunks=[] in the synthetic bundle — every line is technically
      // "between hunks" / "outside hunks". The seam validates file
      // membership and line-range bounds only, not hunk membership.
      const bundle = makeBundle([{ name: "x.ts", newLines: 50 }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 25,
          line_end: 25,
          body: "in hidden context",
          author_kind: "agent",
        },
        bundle,
      );
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(ann);
    });

    it("accepts an anchor on an unchanged context row with side=additions (CONTEXT.md convention)", async () => {
      const bundle = makeBundle([{ name: "x.ts", newLines: 100, oldLines: 100 }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "context-row note",
          author_kind: "human",
        },
        bundle,
      );
      expect(ann.line_start).toBe(1);
      expect(ann.side).toBe("additions");
    });

    it("accepts line_end at exactly the file's line count (inclusive upper bound)", async () => {
      const bundle = makeBundle([{ name: "x.ts", newLines: 7 }]);
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 7,
          line_end: 7,
          body: "last line",
          author_kind: "agent",
        },
        bundle,
      );
      expect(ann.line_end).toBe(7);
    });

    it("rejects when the bundle is snapshot-lost (no diff to validate against)", async () => {
      const lost: TourBundle = {
        kind: "snapshot-lost",
        tour: {
          id: tourId,
          title: "",
          status: "open",
          created_at: "",
          closed_at: "",
          head_sha: "",
          base_sha: "",
          head_source: "",
          base_source: "",
          wip_snapshot: false,
        },
        annotations: [],
      };
      await expect(
        createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 1,
            line_end: 1,
            body: "b",
            author_kind: "agent",
          },
          lost,
        ),
      ).rejects.toThrow(/snapshot/i);
    });
  });

  describe("createReply", () => {
    it("inherits the parent's anchor and stamps replies_to", async () => {
      const parent = makeAnnotation({
        id: "parent-1",
        file: "src/lib/x.ts",
        side: "deletions",
        line_start: 12,
        line_end: 14,
      });
      await seedAnnotation(dir, tourId, parent);

      const reply = await createReply(dir, tourId, {
        replies_to: "parent-1",
        body: "because of legacy compat",
        author: "human-2",
        author_kind: "human",
      });

      expect(reply.file).toBe(parent.file);
      expect(reply.side).toBe(parent.side);
      expect(reply.line_start).toBe(parent.line_start);
      expect(reply.line_end).toBe(parent.line_end);
      expect(reply.replies_to).toBe("parent-1");
      expect(reply.author).toBe("human-2");
      expect(reply.author_kind).toBe("human");
      expect(reply.body).toBe("because of legacy compat");

      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toHaveLength(2);
      expect(loaded[1]).toEqual(reply);
    });

    it("rejects when the parent id is not on disk and writes nothing", async () => {
      await expect(
        createReply(dir, tourId, {
          replies_to: "no-such-id",
          body: "orphan reply",
          author_kind: "human",
        }),
      ).rejects.toThrow(/no-such-id/);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whitespace-only reply body and writes nothing (slice 2 / #142)", async () => {
      const parent = makeAnnotation({ id: "p-trim" });
      await seedAnnotation(dir, tourId, parent);
      await expect(
        createReply(dir, tourId, {
          replies_to: "p-trim",
          body: "  \t \n ",
          author_kind: "agent",
        }),
      ).rejects.toThrow(/body/i);
      // Only the seeded parent is on disk; no reply landed.
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["p-trim"]);
    });

    it("defaults reply author to the author_kind literal when omitted (slice 3 / #143)", async () => {
      const parent = makeAnnotation({ id: "p-author-default" });
      await seedAnnotation(dir, tourId, parent);

      const replyHuman = await createReply(dir, tourId, {
        replies_to: "p-author-default",
        body: "looks reasonable",
        author_kind: "human",
      });
      expect(replyHuman.author).toBe("human");

      const replyAgent = await createReply(dir, tourId, {
        replies_to: "p-author-default",
        body: "agree",
        author_kind: "agent",
      });
      expect(replyAgent.author).toBe("agent");
    });

    it("always re-reads the on-disk Comment log (caller cannot bypass with stale in-memory data)", async () => {
      // Parent is added between the caller's "decision" to reply and the
      // seam call — createReply finds it because it re-reads on every call.
      const parent = makeAnnotation({ id: "p-late" });
      await seedAnnotation(dir, tourId, parent);
      const reply = await createReply(dir, tourId, {
        replies_to: "p-late",
        body: "found it",
        author_kind: "agent",
      });
      expect(reply.replies_to).toBe("p-late");
    });
  });

  describe("createAnnotations (atomic batch)", () => {
    it("writes every record in a single appendFile call", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }, { name: "c.ts" }]);
      // Issue #342: the writer writes to `comments.jsonl` after Stage B.
      const path = join(dir, ".tour", tourId, "comments.jsonl");
      const before = await readFile(path, "utf-8").catch(() => "");
      expect(before).toBe("");

      const results = await createAnnotations(
        dir,
        tourId,
        [
          {
            kind: "top-level",
            file: "a.ts", side: "additions", line_start: 1, line_end: 1,
            body: "first", author_kind: "agent",
          },
          {
            kind: "top-level",
            file: "b.ts", side: "additions", line_start: 2, line_end: 2,
            body: "second", author_kind: "agent",
          },
          {
            kind: "top-level",
            file: "c.ts", side: "additions", line_start: 3, line_end: 3,
            body: "third", author_kind: "agent",
          },
        ],
        bundle,
      );

      expect(results).toHaveLength(3);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.body)).toEqual(["first", "second", "third"]);
      // All three records land on the same write — the file's exact
      // content matches a single newline-joined block.
      const content = await readFile(path, "utf-8");
      expect(content).toBe(results.map((a) => JSON.stringify(a)).join("\n") + "\n");
    });

    it("supports mixed top-level + reply requests in a single batch", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "src/main.ts" }]);
      const parent = makeAnnotation({ id: "p1", side: "deletions" });
      await seedAnnotation(dir, tourId, parent);

      const results = await createAnnotations(
        dir,
        tourId,
        [
          {
            kind: "top-level",
            file: "a.ts", side: "additions", line_start: 1, line_end: 1,
            body: "top", author_kind: "human",
          },
          {
            kind: "reply",
            replies_to: "p1",
            body: "reply", author_kind: "human",
          },
        ],
        bundle,
      );

      expect(results).toHaveLength(2);
      expect(results[0].replies_to).toBeUndefined();
      expect(results[1].replies_to).toBe("p1");
      expect(results[1].side).toBe("deletions"); // inherits parent's anchor
    });

    it("rejects whole batch (no write) when any item has a whitespace-only body (slice 2 / #142)", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }]);
      await expect(
        createAnnotations(
          dir,
          tourId,
          [
            {
              kind: "top-level",
              file: "a.ts", side: "additions", line_start: 1, line_end: 1,
              body: "valid", author_kind: "agent",
            },
            {
              kind: "top-level",
              file: "b.ts", side: "additions", line_start: 2, line_end: 2,
              body: "   \n  ", author_kind: "agent",
            },
          ],
          bundle,
        ),
      ).rejects.toThrow(/body/i);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whole batch (no write) when any reply parent is missing", async () => {
      const bundle = makeBundle([{ name: "a.ts" }]);
      await expect(
        createAnnotations(
          dir,
          tourId,
          [
            {
              kind: "top-level",
              file: "a.ts", side: "additions", line_start: 1, line_end: 1,
              body: "valid", author_kind: "agent",
            },
            {
              kind: "reply",
              replies_to: "no-such-parent",
              body: "doomed", author_kind: "agent",
            },
          ],
          bundle,
        ),
      ).rejects.toThrow(/no-such-parent/);

      // No partial write: the file is still empty.
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whole batch (no write) when any anchor file is not in the bundle (slice 4 / #144)", async () => {
      const bundle = makeBundle([{ name: "a.ts" }]);
      await expect(
        createAnnotations(
          dir,
          tourId,
          [
            {
              kind: "top-level",
              file: "a.ts", side: "additions", line_start: 1, line_end: 1,
              body: "valid", author_kind: "agent",
            },
            {
              kind: "top-level",
              file: "typo.ts", side: "additions", line_start: 1, line_end: 1,
              body: "doomed", author_kind: "agent",
            },
          ],
          bundle,
        ),
      ).rejects.toThrow(/typo\.ts/);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded).toEqual([]);
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
      const bundle = makeBundle([{ name: "x.ts", newLines: 20 }]);
      await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 5,
          line_end: 15,
          body: "range",
          author_kind: "agent",
        },
        bundle,
      );
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded[0].line_start).toBe(5);
      expect(loaded[0].line_end).toBe(15);
    });
  });

  // Issue #342 / PRD #335 / ADR 0029 addendum — Stage B on-disk slice. The
  // on-disk filename `annotations.jsonl` becomes `comments.jsonl`; the reader
  // falls back to the legacy name forever, the writer one-shot-renames on
  // first write. Three cases pinned: empty Tour folder, legacy-only folder,
  // post-migration folder.
  describe("on-disk filename migration: annotations.jsonl → comments.jsonl", () => {
    function commentsPath(): string {
      return join(dir, ".tour", tourId, "comments.jsonl");
    }
    function legacyPath(): string {
      return join(dir, ".tour", tourId, "annotations.jsonl");
    }

    it("readAnnotations prefers comments.jsonl when both exist (post-migration shape)", async () => {
      appendFileSync(commentsPath(), JSON.stringify(makeAnnotation({ id: "primary" })) + "\n");
      // Stranded legacy file (shouldn't happen in practice, but the reader
      // must be deterministic if it does).
      appendFileSync(legacyPath(), JSON.stringify(makeAnnotation({ id: "stranded" })) + "\n");
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["primary"]);
    });

    it("readAnnotations falls back to annotations.jsonl when comments.jsonl is absent", async () => {
      appendFileSync(legacyPath(), JSON.stringify(makeAnnotation({ id: "legacy" })) + "\n");
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["legacy"]);
    });

    it("readAnnotations is a no-op on the legacy file: never writes, never renames", async () => {
      appendFileSync(legacyPath(), JSON.stringify(makeAnnotation({ id: "legacy" })) + "\n");
      await readAnnotations(dir, tourId);
      await readAnnotations(dir, tourId);
      expect(existsSync(legacyPath())).toBe(true);
      expect(existsSync(commentsPath())).toBe(false);
    });

    it("createAnnotation on an empty folder writes comments.jsonl (annotations.jsonl never appears)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "fresh",
          author_kind: "agent",
        },
        bundle,
      );
      expect(existsSync(commentsPath())).toBe(true);
      expect(existsSync(legacyPath())).toBe(false);
    });

    it("createAnnotation on a legacy-only folder renames annotations.jsonl → comments.jsonl then appends", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const legacy = makeAnnotation({ id: "legacy-1" });
      appendFileSync(legacyPath(), JSON.stringify(legacy) + "\n");
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "post-migration",
          author_kind: "agent",
        },
        bundle,
      );
      // After: only comments.jsonl exists, contains both records in order.
      expect(existsSync(legacyPath())).toBe(false);
      expect(existsSync(commentsPath())).toBe(true);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["legacy-1", ann.id]);
    });

    it("createAnnotation on a comments-only folder appends without touching annotations.jsonl", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const existing = makeAnnotation({ id: "already-migrated" });
      appendFileSync(commentsPath(), JSON.stringify(existing) + "\n");
      const ann = await createAnnotation(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "another",
          author_kind: "agent",
        },
        bundle,
      );
      expect(existsSync(legacyPath())).toBe(false);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["already-migrated", ann.id]);
    });

    it("createAnnotation when both files exist logs a stderr warning, skips the rename, appends to comments.jsonl", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      appendFileSync(legacyPath(), JSON.stringify(makeAnnotation({ id: "stranded" })) + "\n");
      appendFileSync(commentsPath(), JSON.stringify(makeAnnotation({ id: "primary" })) + "\n");
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      try {
        const ann = await createAnnotation(
          dir,
          tourId,
          {
            file: "x.ts",
            side: "additions",
            line_start: 1,
            line_end: 1,
            body: "appended",
            author_kind: "agent",
          },
          bundle,
        );
        expect(stderrSpy).toHaveBeenCalled();
        const calls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(calls).toMatch(/annotations\.jsonl/);
        expect(calls).toMatch(/comments\.jsonl/);
        // Legacy file left alone; comments.jsonl is authoritative and gains
        // the new record.
        expect(existsSync(legacyPath())).toBe(true);
        const loaded = await readAnnotations(dir, tourId);
        expect(loaded.map((a) => a.id)).toEqual(["primary", ann.id]);
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("createReply on a legacy-only folder renames and appends", async () => {
      const parent = makeAnnotation({ id: "p-legacy", author_kind: "human" });
      appendFileSync(legacyPath(), JSON.stringify(parent) + "\n");
      const reply = await createReply(dir, tourId, {
        replies_to: "p-legacy",
        body: "after migration",
        author_kind: "agent",
      });
      expect(existsSync(legacyPath())).toBe(false);
      expect(existsSync(commentsPath())).toBe(true);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["p-legacy", reply.id]);
    });

    it("createAnnotations (batch) on a legacy-only folder renames once and appends the whole batch", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }]);
      appendFileSync(legacyPath(), JSON.stringify(makeAnnotation({ id: "legacy-batch" })) + "\n");
      const results = await createAnnotations(
        dir,
        tourId,
        [
          {
            kind: "top-level",
            file: "a.ts", side: "additions", line_start: 1, line_end: 1,
            body: "one", author_kind: "agent",
          },
          {
            kind: "top-level",
            file: "b.ts", side: "additions", line_start: 2, line_end: 2,
            body: "two", author_kind: "agent",
          },
        ],
        bundle,
      );
      expect(existsSync(legacyPath())).toBe(false);
      const loaded = await readAnnotations(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["legacy-batch", results[0].id, results[1].id]);
    });
  });
});
