import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadTourBundle } from "../../src/core/tour-bundle.js";
import { createTour } from "../../src/core/tour-store.js";
import { createComment } from "../../src/core/comments-store.js";
import type { Tour } from "../../src/core/types.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function setupRepo(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "tour-bundle-"));
  await git(["init", "--initial-branch=main", cwd], cwd);
  await git(["config", "user.email", "test@test.com"], cwd);
  await git(["config", "user.name", "Test"], cwd);

  // Base commit: 60 lines
  const baseLines: string[] = [];
  for (let i = 1; i <= 60; i++) baseLines.push(`context line ${i}`);
  await writeFile(join(cwd, "foo.ts"), baseLines.join("\n") + "\n");
  await git(["add", "."], cwd);
  await git(["commit", "-m", "base"], cwd);
  const baseSha = await git(["rev-parse", "HEAD"], cwd);

  // Head commit: change line 30 only — leaves a gap at line 5 and another beyond.
  const headLines = baseLines.slice();
  headLines[29] = "context line 30 CHANGED";
  await writeFile(join(cwd, "foo.ts"), headLines.join("\n") + "\n");
  await git(["add", "."], cwd);
  await git(["commit", "-m", "head"], cwd);
  const headSha = await git(["rev-parse", "HEAD"], cwd);

  return { cwd, baseSha, headSha };
}

function makeTour(baseSha: string, headSha: string): Tour {
  return {
    id: "2026-05-10-120000-abcd",
    title: "Test bundle tour",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: headSha,
    base_sha: baseSha,
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
  };
}

describe("loadTourBundle", () => {
  let cwd: string;
  let baseSha: string;
  let headSha: string;
  let tourId: string;

  beforeEach(async () => {
    const repo = await setupRepo();
    cwd = repo.cwd;
    baseSha = repo.baseSha;
    headSha = repo.headSha;
    const tour = makeTour(baseSha, headSha);
    tourId = tour.id;
    await createTour(cwd, tour);
  });

  describe("ok path", () => {
    it("returns kind:'ok' with tour, comments, diff, and files", async () => {
      const bundle = await loadTourBundle(cwd, tourId);
      expect(bundle.kind).toBe("ok");
      if (bundle.kind !== "ok") return;
      expect(bundle.tour.id).toBe(tourId);
      expect(bundle.tour.head_sha).toBe(headSha);
      expect(bundle.comments).toEqual([]);
      expect(bundle.diff).toContain("foo.ts");
      expect(bundle.diff).toContain("CHANGED");
      expect(bundle.files).toHaveLength(1);
      const file = bundle.files[0];
      expect(file.name).toBe("foo.ts");
      // hunks parsed
      expect(file.hunks.length).toBeGreaterThan(0);
      // classification populated (not generated/vendored — should not be collapsed)
      expect(file.classification.collapsed).toBe(false);
      // file contents fetched per side
      expect(file.oldContent).toContain("context line 30\n");
      expect(file.newContent).toContain("context line 30 CHANGED\n");
      // No orphan comments seeded → empty windows
      expect(file.orphanWindows).toEqual([]);
    });

    it("preserves comments written to the tour", async () => {
      const initial = await loadTourBundle(cwd, tourId);
      await createComment(
        cwd,
        tourId,
        {
          file: "foo.ts",
          side: "additions",
          line_start: 30,
          line_end: 30,
          body: "in-hunk note",
          author_kind: "human",
          author: "test",
        },
        initial,
      );
      const bundle = await loadTourBundle(cwd, tourId);
      if (bundle.kind !== "ok") throw new Error("expected ok");
      expect(bundle.comments).toHaveLength(1);
      expect(bundle.comments[0].body).toBe("in-hunk note");
      // Anchor is in the hunk, not in hidden context → no orphan window.
      expect(bundle.files[0].orphanWindows).toEqual([]);
    });
  });

  describe("snapshot-lost path", () => {
    it("returns kind:'snapshot-lost' when head_sha no longer resolves", async () => {
      // Replace tour with one whose head_sha is unreachable.
      const badHead = "0".repeat(40);
      await writeFile(
        join(cwd, ".tour", tourId, "tour.toml"),
        [
          `id = "${tourId}"`,
          `title = "Test bundle tour"`,
          `status = "open"`,
          `created_at = "${new Date().toISOString()}"`,
          `closed_at = ""`,
          `head_sha = "${badHead}"`,
          `base_sha = "${baseSha}"`,
          `head_source = "HEAD"`,
          `base_source = "HEAD^"`,
          `wip_snapshot = false`,
          "",
        ].join("\n"),
      );
      const bundle = await loadTourBundle(cwd, tourId);
      expect(bundle.kind).toBe("snapshot-lost");
      if (bundle.kind !== "snapshot-lost") return;
      expect(bundle.tour.id).toBe(tourId);
      expect(bundle.comments).toEqual([]);
      // No files / diff / fileContents — discriminated union forbids access.
      expect("files" in bundle).toBe(false);
      expect("diff" in bundle).toBe(false);
    });

    it("preserves comments even when snapshot is lost", async () => {
      const initial = await loadTourBundle(cwd, tourId);
      await createComment(
        cwd,
        tourId,
        {
          file: "foo.ts",
          side: "additions",
          line_start: 1,
          line_end: 1,
          body: "before snapshot loss",
          author_kind: "human",
          author: "test",
        },
        initial,
      );
      const badBase = "1".repeat(40);
      await writeFile(
        join(cwd, ".tour", tourId, "tour.toml"),
        [
          `id = "${tourId}"`,
          `title = "Test bundle tour"`,
          `status = "open"`,
          `created_at = "${new Date().toISOString()}"`,
          `closed_at = ""`,
          `head_sha = "${headSha}"`,
          `base_sha = "${badBase}"`,
          `head_source = "HEAD"`,
          `base_source = "HEAD^"`,
          `wip_snapshot = false`,
          "",
        ].join("\n"),
      );
      const bundle = await loadTourBundle(cwd, tourId);
      expect(bundle.kind).toBe("snapshot-lost");
      if (bundle.kind !== "snapshot-lost") return;
      expect(bundle.comments).toHaveLength(1);
      expect(bundle.comments[0].body).toBe("before snapshot loss");
    });
  });

  describe("deleted-file path", () => {
    // Pierre's parser emits ChangeTypes 'change' | 'rename-pure' | 'rename-changed'
    // | 'new' | 'deleted' — never 'binary'. The pre-refactor CLI/webapp's
    // `f.type === "binary"` branch was dead in practice, so the bundle's
    // optional oldContent/newContent are exercised via the deleted-file path
    // instead: fetchFileContents short-circuits the head fetch with an empty
    // string (the file is gone at head), but oldContent IS populated from base.
    it("deleted files have empty newContent and populated oldContent", async () => {
      const cwd2 = await mkdtemp(join(tmpdir(), "tour-bundle-del-"));
      await git(["init", "--initial-branch=main", cwd2], cwd2);
      await git(["config", "user.email", "test@test.com"], cwd2);
      await git(["config", "user.name", "Test"], cwd2);
      await writeFile(join(cwd2, "doomed.ts"), "line 1\nline 2\n");
      await git(["add", "."], cwd2);
      await git(["commit", "-m", "base"], cwd2);
      const baseSha2 = await git(["rev-parse", "HEAD"], cwd2);
      await git(["rm", "doomed.ts"], cwd2);
      await git(["commit", "-m", "delete"], cwd2);
      const headSha2 = await git(["rev-parse", "HEAD"], cwd2);

      const tour: Tour = {
        id: "2026-05-10-130000-bbbb",
        title: "delete tour",
        status: "open",
        created_at: new Date().toISOString(),
        closed_at: "",
        head_sha: headSha2,
        base_sha: baseSha2,
        head_source: "HEAD",
        base_source: "HEAD^",
        wip_snapshot: false,
      };
      await createTour(cwd2, tour);
      const bundle = await loadTourBundle(cwd2, tour.id);
      if (bundle.kind !== "ok") throw new Error("expected ok");
      const file = bundle.files.find((f) => f.name === "doomed.ts");
      expect(file).toBeDefined();
      if (!file) return;
      expect(file.type).toBe("deleted");
      expect(file.oldContent).toBe("line 1\nline 2\n");
      expect(file.newContent).toBe("");
    });
  });

  describe("orphan-window path", () => {
    it("comments whose anchor lives in hidden context produce orphanWindows entries", async () => {
      // The diff has one hunk around line 30. Default git -U3 surrounds
      // it with context lines 27..33. Comment at line 5 is far outside
      // any hunk's visible context — it lands in the file's top boundary.
      const initial = await loadTourBundle(cwd, tourId);
      await createComment(
        cwd,
        tourId,
        {
          file: "foo.ts",
          side: "additions",
          line_start: 5,
          line_end: 5,
          body: "orphan in hidden context",
          author_kind: "human",
          author: "test",
        },
        initial,
      );
      const bundle = await loadTourBundle(cwd, tourId);
      if (bundle.kind !== "ok") throw new Error("expected ok");
      const file = bundle.files[0];
      expect(file.orphanWindows.length).toBe(1);
      const w = file.orphanWindows[0];
      // hunkIndex 0 → top boundary
      expect(w.ref).toBe("top");
      expect(w.fromStart).toBeGreaterThan(0);
      expect(w.fromEnd).toBeGreaterThan(0);
    });
  });
});
