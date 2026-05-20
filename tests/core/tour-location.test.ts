import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { resolveTourLocation } from "../../src/core/tour-location.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function createRepo(prefix = "tour-location-"): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await git(["init", dir], dir);
  await git(["config", "user.email", "test@test.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "file.txt"), "one\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "initial"], dir);
  return dir;
}

function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

describe("resolveTourLocation", () => {
  it("resolves repo root and stores tours under TOUR_HOME/<repo-key>", async () => {
    const repo = await createRepo();
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-home-")));
    const subdir = join(repo, "packages", "app");
    await mkdir(subdir, { recursive: true });

    const gitCommonDir = await realpath(join(repo, ".git"));
    const key = `${slug(basename(repo))}-${shortHash(gitCommonDir)}`;

    await expect(
      resolveTourLocation(subdir, { env: { TOUR_HOME: tourHome } }),
    ).resolves.toEqual({
      repoRoot: repo,
      tourStoreRoot: join(tourHome, key),
      worktreeStamp: gitCommonDir,
    });
  });

  it("falls back to realpath(cwd) outside a git repo", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-location-plain-")));
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-home-plain-")));
    const key = `${slug(basename(dir))}-${shortHash(dir)}`;

    await expect(
      resolveTourLocation(dir, { env: { TOUR_HOME: tourHome } }),
    ).resolves.toEqual({
      repoRoot: dir,
      tourStoreRoot: join(tourHome, key),
      worktreeStamp: dir,
    });
  });

  it("uses one repo-key store for the main checkout and a linked worktree", async () => {
    const repo = await createRepo("tour-location-worktree-");
    const linked = await realpath(await mkdtemp(join(tmpdir(), "tour-location-linked-")));
    const tourHome = await realpath(await mkdtemp(join(tmpdir(), "tour-home-worktree-")));
    await git(["worktree", "add", linked, "-b", "linked"], repo);

    const mainLocation = await resolveTourLocation(repo, { env: { TOUR_HOME: tourHome } });
    const linkedLocation = await resolveTourLocation(linked, { env: { TOUR_HOME: tourHome } });

    expect(linkedLocation.tourStoreRoot).toBe(mainLocation.tourStoreRoot);
    expect(linkedLocation.worktreeStamp).not.toBe(mainLocation.worktreeStamp);
  });

});
