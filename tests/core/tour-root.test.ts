import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTourRoot } from "../../src/core/tour-root.js";

// Issue #369. The resolver answers "where does .tour/ live?" by walking up
// from cwd looking for a repo marker (.git as dir or file) or a .tour/
// directory. `.git` takes precedence so a stray sub-directory .tour/
// (left over from before this fix) is surfaced as a warning, not silently
// adopted as the root.
describe("resolveTourRoot", () => {
  let root: string;

  beforeEach(async () => {
    // realpath: on macOS `tmpdir()` resolves through /var → /private/var;
    // resolveTourRoot composes paths from real dirent entries, so the
    // expected paths must also be realpath-normalised. Issue #365 / #368.
    root = await realpath(await mkdtemp(join(tmpdir(), "tour-root-")));
  });

  it("falls back to cwd when no .git or .tour/ ancestor exists", async () => {
    const sub = join(root, "deep", "nested");
    await mkdir(sub, { recursive: true });
    const resolved = await resolveTourRoot(sub);
    expect(resolved.root).toBe(sub);
    expect(resolved.strayTourDirs).toEqual([]);
  });

  it("resolves to the cwd when .git exists there", async () => {
    await mkdir(join(root, ".git"));
    const resolved = await resolveTourRoot(root);
    expect(resolved.root).toBe(root);
  });

  it("walks up from a nested sub-directory to the .git ancestor", async () => {
    await mkdir(join(root, ".git"));
    const sub = join(root, "src", "lib");
    await mkdir(sub, { recursive: true });
    const resolved = await resolveTourRoot(sub);
    expect(resolved.root).toBe(root);
    expect(resolved.strayTourDirs).toEqual([]);
  });

  it("treats .git as a file (worktree) the same as a .git directory", async () => {
    await writeFile(join(root, ".git"), "gitdir: /elsewhere\n");
    const sub = join(root, "pkg");
    await mkdir(sub);
    const resolved = await resolveTourRoot(sub);
    expect(resolved.root).toBe(root);
  });

  it("resolves to a .tour/ ancestor when no .git exists", async () => {
    await mkdir(join(root, ".tour"));
    const sub = join(root, "a", "b");
    await mkdir(sub, { recursive: true });
    const resolved = await resolveTourRoot(sub);
    expect(resolved.root).toBe(root);
  });

  it("prefers a higher .git ancestor over a closer .tour/ sub-directory", async () => {
    // Repo root has .git, sub-dir has a stale .tour/ from before #369.
    // Resolution lands on the repo root and surfaces the orphan.
    await mkdir(join(root, ".git"));
    const subTour = join(root, "src");
    await mkdir(join(subTour, ".tour"), { recursive: true });
    const deeper = join(subTour, "lib");
    await mkdir(deeper);

    const resolved = await resolveTourRoot(deeper);
    expect(resolved.root).toBe(root);
    expect(resolved.strayTourDirs).toEqual([join(subTour, ".tour")]);
  });

  it("does not flag the resolved root's own .tour/ as stray", async () => {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, ".tour"));
    const sub = join(root, "src");
    await mkdir(sub);
    const resolved = await resolveTourRoot(sub);
    expect(resolved.root).toBe(root);
    expect(resolved.strayTourDirs).toEqual([]);
  });
});
