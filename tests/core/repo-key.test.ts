import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { repoKey, worktreeStamp } from "../../src/core/repo-key.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function createRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-repo-key-")));
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

describe("repoKey", () => {
  it("uses the real git common dir so linked worktrees share one key", async () => {
    const repo = await createRepo();
    const linked = await realpath(await mkdtemp(join(tmpdir(), "tour-repo-key-linked-")));
    await git(["worktree", "add", linked, "-b", "linked"], repo);

    const commonDir = await realpath(join(repo, ".git"));
    const expected = `${slug(basename(repo))}-${shortHash(commonDir)}`;

    expect(await repoKey(repo)).toEqual(expected);
    expect(await repoKey(linked)).toEqual(expected);
    expect(await worktreeStamp(repo)).not.toEqual(await worktreeStamp(linked));
  });

  it("normalizes symlinked repo paths before hashing", async () => {
    const repo = await createRepo();
    const link = join(tmpdir(), `tour-repo-key-link-${Date.now()}`);
    await symlink(repo, link);

    expect(await repoKey(link)).toBe(await repoKey(repo));
    expect(await worktreeStamp(link)).toBe(await worktreeStamp(repo));
  });

  it("slugs awkward repo basenames", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "tour repo-key parent-")));
    const repo = join(parent, "My Repo! 100%");
    await git(["init", repo], parent);
    const commonDir = await realpath(join(repo, ".git"));

    expect(await repoKey(repo)).toBe(`my-repo-100-${shortHash(commonDir)}`);
  });

  it("falls back to realpath(cwd) outside git", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-repo-key-plain-")));
    const expected = `${slug(basename(dir))}-${shortHash(dir)}`;

    expect(await repoKey(dir)).toBe(expected);
    expect(await worktreeStamp(dir)).toBe(dir);
  });
});
