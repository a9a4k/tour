import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { repoKey, worktreeStamp } from "../../src/core/repo-key.js";
import {
  NOT_GIT_WORKING_TREE_MESSAGE,
  NotGitWorkingTreeError,
} from "../../src/core/not-git-working-tree-error.js";

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

  it("throws the canonical git-required error outside git", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tour-repo-key-plain-")));

    await expect(repoKey(dir)).rejects.toThrow(NotGitWorkingTreeError);
    await expect(repoKey(dir)).rejects.toThrow(NOT_GIT_WORKING_TREE_MESSAGE);
    await expect(worktreeStamp(dir)).rejects.toThrow(NotGitWorkingTreeError);
    await expect(worktreeStamp(dir)).rejects.toThrow(NOT_GIT_WORKING_TREE_MESSAGE);
  });
});
