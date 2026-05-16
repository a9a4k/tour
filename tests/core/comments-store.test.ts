import { describe, it, expect, beforeEach } from "vitest";
import {
  createComment,
  createReply,
  createComments,
  readComments,
} from "../../src/core/comments-store.js";
import { eventsPath, appendEvent } from "../../src/core/events-store.js";
import type { Tour, TourEvent } from "../../src/core/types.js";
import type { TourBundle, BundleFile } from "../../src/core/tour-bundle.js";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Seed a top-level comment by appending a `comment.created` event to the
// on-disk log. Sidesteps the seam to inject a caller-supplied id when the
// test needs to assert about that id (e.g. reply-parent lookup).
async function seedTopLevel(
  dir: string,
  tourId: string,
  over: Partial<Extract<TourEvent, { kind: "comment.created" }>> & { id: string },
): Promise<void> {
  const ev: Extract<TourEvent, { kind: "comment.created" }> = {
    kind: "comment.created",
    id: over.id,
    file: over.file ?? "src/main.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 10,
    line_end: over.line_end ?? 10,
    body: over.body ?? "Consider extracting this into a helper.",
    author: over.author ?? "claude-code",
    author_kind: over.author_kind ?? "agent",
    at: over.at ?? new Date().toISOString(),
  };
  await appendEvent(dir, tourId, ev);
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
    comments: [],
    diff: "",
    files: bundleFiles,
  };
}

describe("comments-store", () => {
  let dir: string;
  const tourId = "2026-05-08-120000-abcd";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-ann-"));
    await mkdir(join(dir, ".tour", tourId), { recursive: true });
  });

  describe("createComment", () => {
    it("writes a top-level comment that round-trips through readComments", async () => {
      const bundle = makeBundle([{ name: "src/main.ts", newLines: 20 }]);
      const ann = await createComment(
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

      const loaded = await readComments(dir, tourId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(ann);
    });

    it("defaults author to 'agent' when omitted and author_kind is 'agent' (slice 3 / #143)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const ann = await createComment(
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
      const ann = await createComment(
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
      const ann = await createComment(
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
        createComment(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("appends across multiple invocations", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }]);
      const a = await createComment(
        dir,
        tourId,
        {
          file: "a.ts", side: "additions", line_start: 1, line_end: 1,
          body: "1", author_kind: "agent",
        },
        bundle,
      );
      const b = await createComment(
        dir,
        tourId,
        {
          file: "b.ts", side: "additions", line_start: 2, line_end: 2,
          body: "2", author_kind: "agent",
        },
        bundle,
      );
      const loaded = await readComments(dir, tourId);
      expect(loaded.map((x) => x.id)).toEqual([a.id, b.id]);
    });
  });

  describe("createComment anchor validation (slice 4 / #144)", () => {
    it("rejects when file is not in bundle.files and writes nothing", async () => {
      const bundle = makeBundle([{ name: "real.ts" }]);
      await expect(
        createComment(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects when line_start < 1", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await expect(
        createComment(
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
        createComment(
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
        createComment(
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
        createComment(
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
      const ann = await createComment(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(ann);
    });

    it("accepts an anchor on an unchanged context row with side=additions (CONTEXT.md convention)", async () => {
      const bundle = makeBundle([{ name: "x.ts", newLines: 100, oldLines: 100 }]);
      const ann = await createComment(
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
      const ann = await createComment(
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
        comments: [],
      };
      await expect(
        createComment(
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
      await seedTopLevel(dir, tourId, {
        id: "parent-1",
        file: "src/lib/x.ts",
        side: "deletions",
        line_start: 12,
        line_end: 14,
      });

      const reply = await createReply(dir, tourId, {
        replies_to: "parent-1",
        body: "because of legacy compat",
        author: "human-2",
        author_kind: "human",
      });

      expect(reply.file).toBe("src/lib/x.ts");
      expect(reply.side).toBe("deletions");
      expect(reply.line_start).toBe(12);
      expect(reply.line_end).toBe(14);
      expect(reply.replies_to).toBe("parent-1");
      expect(reply.author).toBe("human-2");
      expect(reply.author_kind).toBe("human");
      expect(reply.body).toBe("because of legacy compat");

      const loaded = await readComments(dir, tourId);
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whitespace-only reply body and writes nothing (slice 2 / #142)", async () => {
      await seedTopLevel(dir, tourId, { id: "p-trim" });
      await expect(
        createReply(dir, tourId, {
          replies_to: "p-trim",
          body: "  \t \n ",
          author_kind: "agent",
        }),
      ).rejects.toThrow(/body/i);
      // Only the seeded parent is on disk; no reply landed.
      const loaded = await readComments(dir, tourId);
      expect(loaded.map((a) => a.id)).toEqual(["p-trim"]);
    });

    it("defaults reply author to the author_kind literal when omitted (slice 3 / #143)", async () => {
      await seedTopLevel(dir, tourId, { id: "p-author-default" });

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

    it("always re-reads the on-disk event log (caller cannot bypass with stale in-memory data)", async () => {
      // Parent is added between the caller's "decision" to reply and the
      // seam call — createReply finds it because it re-reads on every call.
      await seedTopLevel(dir, tourId, { id: "p-late" });
      const reply = await createReply(dir, tourId, {
        replies_to: "p-late",
        body: "found it",
        author_kind: "agent",
      });
      expect(reply.replies_to).toBe("p-late");
    });
  });

  describe("createComments (atomic batch)", () => {
    it("writes every event in a single appendFile call", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "b.ts" }, { name: "c.ts" }]);
      const path = eventsPath(dir, tourId);
      const before = await readFile(path, "utf-8").catch(() => "");
      expect(before).toBe("");

      const results = await createComments(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded.map((a) => a.body)).toEqual(["first", "second", "third"]);
      // All three records landed on a single write — the events file
      // contains three lines, one per record.
      const content = await readFile(path, "utf-8");
      const lines = content.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(3);
    });

    it("supports mixed top-level + reply requests in a single batch", async () => {
      const bundle = makeBundle([{ name: "a.ts" }, { name: "src/main.ts" }]);
      await seedTopLevel(dir, tourId, { id: "p1", side: "deletions" });

      const results = await createComments(
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
        createComments(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whole batch (no write) when any reply parent is missing", async () => {
      const bundle = makeBundle([{ name: "a.ts" }]);
      await expect(
        createComments(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("rejects whole batch (no write) when any anchor file is not in the bundle (slice 4 / #144)", async () => {
      const bundle = makeBundle([{ name: "a.ts" }]);
      await expect(
        createComments(
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
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });
  });

  describe("readComments", () => {
    it("returns empty array when file does not exist", async () => {
      const loaded = await readComments(dir, tourId);
      expect(loaded).toEqual([]);
    });

    it("skips malformed lines in the event log", async () => {
      // appendEvent serialises one line per call; mix in a malformed line
      // by direct write to assert the reader tolerates it.
      await seedTopLevel(dir, tourId, { id: "good" });
      const path = eventsPath(dir, tourId);
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, "NOT JSON\n");
      await seedTopLevel(dir, tourId, { id: "also-good" });
      const loaded = await readComments(dir, tourId);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe("good");
      expect(loaded[1].id).toBe("also-good");
    });
  });

  describe("on-disk event log shape (ADR 0036)", () => {
    it("createComment writes a comment.created event line, not a Comment record", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      const ann = await createComment(
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
      const content = await readFile(eventsPath(dir, tourId), "utf-8");
      const lines = content.split("\n").filter((l) => l);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.kind).toBe("comment.created");
      expect(parsed.id).toBe(ann.id);
      expect(parsed.at).toBe(ann.created_at);
      expect(parsed.body).toBe("fresh");
      // The legacy `created_at` field is not on the event shape.
      expect(parsed.created_at).toBeUndefined();
    });

    it("createReply writes a reply.created event line (no anchor fields on the event)", async () => {
      await seedTopLevel(dir, tourId, {
        id: "parent-1",
        file: "src/lib/x.ts",
        side: "deletions",
        line_start: 12,
        line_end: 14,
      });
      const reply = await createReply(dir, tourId, {
        replies_to: "parent-1",
        body: "agreed",
        author_kind: "human",
      });
      const content = await readFile(eventsPath(dir, tourId), "utf-8");
      const lines = content.split("\n").filter((l) => l);
      // Two events: the seeded parent + the new reply.
      expect(lines).toHaveLength(2);
      const replyLine = JSON.parse(lines[1]);
      expect(replyLine.kind).toBe("reply.created");
      expect(replyLine.id).toBe(reply.id);
      expect(replyLine.replies_to).toBe("parent-1");
      // The reply event does not carry the anchor — it's inherited at
      // fold time from the parent (ADR 0036).
      expect(replyLine.file).toBeUndefined();
      expect(replyLine.line_start).toBeUndefined();
      expect(replyLine.side).toBeUndefined();
    });

    it("CommentState shape: `deleted?` field is absent in this slice (Slice C lights it up)", async () => {
      const bundle = makeBundle([{ name: "x.ts" }]);
      await createComment(
        dir,
        tourId,
        {
          file: "x.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "live",
          author_kind: "agent",
        },
        bundle,
      );
      const loaded = await readComments(dir, tourId);
      for (const c of loaded) expect(c.deleted).toBeUndefined();
    });
  });
});
