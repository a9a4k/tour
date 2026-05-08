import { describe, it, expect, beforeEach } from "vitest";
import {
  createReview,
  getReview,
  listReviews,
  updateReviewStatus,
  deleteReview,
  resolveIdPrefix,
  pruneReviews,
} from "../../src/core/review-store.js";
import type { Review } from "../../src/core/types.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

function makeReview(overrides?: Partial<Review>): Review {
  return {
    id: "2026-05-08-120000-abcd",
    title: "Test review",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: "aaaa".repeat(10),
    base_sha: "bbbb".repeat(10),
    head_source: "HEAD",
    base_source: "HEAD^",
    worktree_snapshot: false,
    ...overrides,
  };
}

describe("review-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "review-store-"));
  });

  describe("createReview + getReview", () => {
    it("round-trips review data through TOML", async () => {
      const review = makeReview();
      await createReview(dir, review);
      const loaded = await getReview(dir, review.id);
      expect(loaded.id).toBe(review.id);
      expect(loaded.title).toBe(review.title);
      expect(loaded.status).toBe("open");
      expect(loaded.head_sha).toBe(review.head_sha);
      expect(loaded.base_sha).toBe(review.base_sha);
      expect(loaded.worktree_snapshot).toBe(false);
    });

    it("creates .review/<id>/ folder structure", async () => {
      const review = makeReview();
      await createReview(dir, review);
      expect(existsSync(join(dir, ".review", review.id, "review.toml"))).toBe(true);
    });
  });

  describe("listReviews", () => {
    it("returns empty array when no .review dir exists", async () => {
      const reviews = await listReviews(dir);
      expect(reviews).toEqual([]);
    });

    it("returns open reviews by default", async () => {
      await createReview(dir, makeReview({ id: "2026-05-08-120000-aaaa", status: "open" }));
      await createReview(dir, makeReview({ id: "2026-05-08-120001-bbbb", status: "closed", closed_at: new Date().toISOString() }));
      const reviews = await listReviews(dir);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].id).toBe("2026-05-08-120000-aaaa");
    });

    it("returns all reviews when status=all", async () => {
      await createReview(dir, makeReview({ id: "2026-05-08-120000-aaaa" }));
      await createReview(dir, makeReview({ id: "2026-05-08-120001-bbbb", status: "closed", closed_at: new Date().toISOString() }));
      const reviews = await listReviews(dir, { status: "all" });
      expect(reviews).toHaveLength(2);
    });

    it("sorts by ID (chronological)", async () => {
      await createReview(dir, makeReview({ id: "2026-05-08-120002-cccc" }));
      await createReview(dir, makeReview({ id: "2026-05-08-120000-aaaa" }));
      await createReview(dir, makeReview({ id: "2026-05-08-120001-bbbb" }));
      const reviews = await listReviews(dir);
      expect(reviews.map((r) => r.id)).toEqual([
        "2026-05-08-120000-aaaa",
        "2026-05-08-120001-bbbb",
        "2026-05-08-120002-cccc",
      ]);
    });
  });

  describe("updateReviewStatus", () => {
    it("flips status to closed and sets closed_at", async () => {
      await createReview(dir, makeReview());
      const updated = await updateReviewStatus(dir, "2026-05-08-120000-abcd", "closed");
      expect(updated.status).toBe("closed");
      expect(updated.closed_at).not.toBe("");
      const reloaded = await getReview(dir, "2026-05-08-120000-abcd");
      expect(reloaded.status).toBe("closed");
    });
  });

  describe("deleteReview", () => {
    it("removes the review folder", async () => {
      const review = makeReview();
      await createReview(dir, review);
      await deleteReview(dir, review.id);
      expect(existsSync(join(dir, ".review", review.id))).toBe(false);
    });

    it("does not throw if review does not exist", async () => {
      await expect(deleteReview(dir, "nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("resolveIdPrefix", () => {
    it("resolves unique prefix", async () => {
      await createReview(dir, makeReview({ id: "2026-05-08-120000-abcd" }));
      const resolved = await resolveIdPrefix(dir, "2026-05-08-12");
      expect(resolved).toBe("2026-05-08-120000-abcd");
    });

    it("throws on ambiguous prefix", async () => {
      await createReview(dir, makeReview({ id: "2026-05-08-120000-aaaa" }));
      await createReview(dir, makeReview({ id: "2026-05-08-120001-aabb" }));
      await expect(resolveIdPrefix(dir, "2026-05-08-12")).rejects.toThrow("Ambiguous");
    });

    it("throws when no match", async () => {
      await createReview(dir, makeReview());
      await expect(resolveIdPrefix(dir, "9999")).rejects.toThrow("No review matching");
    });
  });

  describe("pruneReviews", () => {
    it("deletes closed reviews older than threshold", async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await createReview(dir, makeReview({
        id: "2026-03-01-120000-old1",
        status: "closed",
        closed_at: oldDate,
      }));
      await createReview(dir, makeReview({
        id: "2026-05-08-120000-new1",
        status: "closed",
        closed_at: new Date().toISOString(),
      }));
      const pruned = await pruneReviews(dir, 30 * 24 * 60 * 60 * 1000);
      expect(pruned).toEqual(["2026-03-01-120000-old1"]);
      expect(existsSync(join(dir, ".review", "2026-03-01-120000-old1"))).toBe(false);
      expect(existsSync(join(dir, ".review", "2026-05-08-120000-new1"))).toBe(true);
    });

    it("does not prune open reviews", async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await createReview(dir, makeReview({
        id: "2026-03-01-120000-open",
        status: "open",
        created_at: oldDate,
      }));
      const pruned = await pruneReviews(dir, 30 * 24 * 60 * 60 * 1000);
      expect(pruned).toEqual([]);
    });
  });
});
