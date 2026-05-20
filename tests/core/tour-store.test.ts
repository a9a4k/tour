import { describe, it, expect, beforeEach } from "vitest";
import {
  createTour,
  getTour,
  listTours,
  updateTourStatus,
  deleteTour,
  resolveIdPrefix,
  pruneTours,
} from "../../src/core/tour-store.js";
import type { Tour } from "../../src/core/types.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

function makeTour(overrides?: Partial<Tour>): Tour {
  return {
    id: "2026-05-08-120000-abcd",
    title: "Test tour",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: "aaaa".repeat(10),
    base_sha: "bbbb".repeat(10),
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
    created_in_worktree: "/tmp/worktree-a",
    ...overrides,
  };
}

describe("tour-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-store-"));
  });

  describe("createTour + getTour", () => {
    it("round-trips tour data through TOML", async () => {
      const tour = makeTour();
      await createTour(dir, tour);
      const loaded = await getTour(dir, tour.id);
      expect(loaded.id).toBe(tour.id);
      expect(loaded.title).toBe(tour.title);
      expect(loaded.status).toBe("open");
      expect(loaded.head_sha).toBe(tour.head_sha);
      expect(loaded.base_sha).toBe(tour.base_sha);
      expect(loaded.wip_snapshot).toBe(false);
    });

    it("creates <tour-store-root>/<id>/ folder structure", async () => {
      const tour = makeTour();
      await createTour(dir, tour);
      expect(existsSync(join(dir, tour.id, "tour.toml"))).toBe(true);
    });
  });

  describe("listTours", () => {
    it("returns empty array when no tour directory exists", async () => {
      const tours = await listTours(dir);
      expect(tours).toEqual([]);
    });

    it("returns open tours by default", async () => {
      await createTour(dir, makeTour({ id: "2026-05-08-120000-aaaa", status: "open" }));
      await createTour(dir, makeTour({ id: "2026-05-08-120001-bbbb", status: "closed", closed_at: new Date().toISOString() }));
      const tours = await listTours(dir);
      expect(tours).toHaveLength(1);
      expect(tours[0].id).toBe("2026-05-08-120000-aaaa");
    });

    it("returns all tours when status=all", async () => {
      await createTour(dir, makeTour({ id: "2026-05-08-120000-aaaa" }));
      await createTour(dir, makeTour({ id: "2026-05-08-120001-bbbb", status: "closed", closed_at: new Date().toISOString() }));
      const tours = await listTours(dir, { status: "all" });
      expect(tours).toHaveLength(2);
    });

    it("filters by worktree stamp when provided", async () => {
      await createTour(dir, makeTour({
        id: "2026-05-08-120000-aaaa",
        created_in_worktree: "/tmp/worktree-a",
      }));
      await createTour(dir, makeTour({
        id: "2026-05-08-120001-bbbb",
        created_in_worktree: "/tmp/worktree-b",
      }));

      const tours = await listTours(dir, {
        status: "all",
        worktreeStamp: "/tmp/worktree-b",
      });

      expect(tours.map((t) => t.id)).toEqual(["2026-05-08-120001-bbbb"]);
    });

    it("sorts by ID (chronological)", async () => {
      await createTour(dir, makeTour({ id: "2026-05-08-120002-cccc" }));
      await createTour(dir, makeTour({ id: "2026-05-08-120000-aaaa" }));
      await createTour(dir, makeTour({ id: "2026-05-08-120001-bbbb" }));
      const tours = await listTours(dir);
      expect(tours.map((t) => t.id)).toEqual([
        "2026-05-08-120000-aaaa",
        "2026-05-08-120001-bbbb",
        "2026-05-08-120002-cccc",
      ]);
    });
  });

  describe("updateTourStatus", () => {
    it("flips status to closed and sets closed_at", async () => {
      await createTour(dir, makeTour());
      const updated = await updateTourStatus(dir, "2026-05-08-120000-abcd", "closed");
      expect(updated.status).toBe("closed");
      expect(updated.closed_at).not.toBe("");
      const reloaded = await getTour(dir, "2026-05-08-120000-abcd");
      expect(reloaded.status).toBe("closed");
    });
  });

  describe("deleteTour", () => {
    it("removes the tour folder", async () => {
      const tour = makeTour();
      await createTour(dir, tour);
      await deleteTour(dir, tour.id);
      expect(existsSync(join(dir, tour.id))).toBe(false);
    });

    it("does not throw if tour does not exist", async () => {
      await expect(deleteTour(dir, "nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("resolveIdPrefix", () => {
    it("resolves unique prefix", async () => {
      await createTour(dir, makeTour({ id: "2026-05-08-120000-abcd" }));
      const resolved = await resolveIdPrefix(dir, "2026-05-08-12");
      expect(resolved).toBe("2026-05-08-120000-abcd");
    });

    it("throws on ambiguous prefix", async () => {
      await createTour(dir, makeTour({ id: "2026-05-08-120000-aaaa" }));
      await createTour(dir, makeTour({ id: "2026-05-08-120001-aabb" }));
      await expect(resolveIdPrefix(dir, "2026-05-08-12")).rejects.toThrow("Ambiguous");
    });

    it("throws when no match", async () => {
      await createTour(dir, makeTour());
      await expect(resolveIdPrefix(dir, "9999")).rejects.toThrow("No tour matching");
    });

    it("throws a path-bearing error when the tour store root does not exist", async () => {
      const missing = join(dir, "missing-store");
      await expect(resolveIdPrefix(missing, "anything")).rejects.toThrow(
        `No tour store directory at ${missing}`,
      );
    });
  });

  describe("pruneTours", () => {
    it("deletes closed tours older than threshold", async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await createTour(dir, makeTour({
        id: "2026-03-01-120000-old1",
        status: "closed",
        closed_at: oldDate,
      }));
      await createTour(dir, makeTour({
        id: "2026-05-08-120000-new1",
        status: "closed",
        closed_at: new Date().toISOString(),
      }));
      const pruned = await pruneTours(dir, 30 * 24 * 60 * 60 * 1000);
      expect(pruned).toEqual(["2026-03-01-120000-old1"]);
      expect(existsSync(join(dir, "2026-03-01-120000-old1"))).toBe(false);
      expect(existsSync(join(dir, "2026-05-08-120000-new1"))).toBe(true);
    });

    it("does not prune open tours", async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await createTour(dir, makeTour({
        id: "2026-03-01-120000-open",
        status: "open",
        created_at: oldDate,
      }));
      const pruned = await pruneTours(dir, 30 * 24 * 60 * 60 * 1000);
      expect(pruned).toEqual([]);
    });
  });
});
