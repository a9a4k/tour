import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveRef,
  isValidRef,
  snapshotWorkingTree,
  releaseSnapshot,
  getDiff,
  isShaResolvable,
} from "../../src/core/git.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-git-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "hello.txt"), "hello\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "initial"], dir);
  return dir;
}

describe("resolveRef", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("resolves HEAD to a 40-char SHA", async () => {
    const sha = await resolveRef("HEAD", repo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("resolves HEAD^ after a second commit", async () => {
    await writeFile(join(repo, "second.txt"), "second\n");
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", "second"], repo);
    const parentSha = await resolveRef("HEAD^", repo);
    expect(parentSha).toMatch(/^[0-9a-f]{40}$/);
    const headSha = await resolveRef("HEAD", repo);
    expect(parentSha).not.toBe(headSha);
  });

  it("throws on invalid ref", async () => {
    await expect(resolveRef("nonexistent", repo)).rejects.toThrow();
  });
});

describe("isValidRef", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("returns true for HEAD", async () => {
    expect(await isValidRef("HEAD", repo)).toBe(true);
  });

  it("returns false for nonsense", async () => {
    expect(await isValidRef("nonexistent", repo)).toBe(false);
  });
});

describe("snapshotWorkingTree + releaseSnapshot", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("creates a ref that resolves to a valid object", async () => {
    await writeFile(join(repo, "wip.txt"), "work in progress\n");
    const sha = await snapshotWorkingTree("test-tour", repo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const refSha = await resolveRef("refs/tour/test-tour", repo);
    expect(refSha).toBe(sha);
  });

  it("snapshots HEAD when no uncommitted changes", async () => {
    const sha = await snapshotWorkingTree("clean-tour", repo);
    const headSha = await resolveRef("HEAD", repo);
    expect(sha).toBe(headSha);
  });

  it("release removes the ref", async () => {
    await writeFile(join(repo, "wip.txt"), "wip\n");
    await snapshotWorkingTree("doomed", repo);
    expect(await isValidRef("refs/tour/doomed", repo)).toBe(true);
    await releaseSnapshot("doomed", repo);
    expect(await isValidRef("refs/tour/doomed", repo)).toBe(false);
  });

  it("release on nonexistent ref is a no-op", async () => {
    await expect(releaseSnapshot("nope", repo)).resolves.toBeUndefined();
  });
});

describe("getDiff", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("returns diff between two commits", async () => {
    const firstSha = await resolveRef("HEAD", repo);
    await writeFile(join(repo, "hello.txt"), "hello world\n");
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", "update"], repo);
    const secondSha = await resolveRef("HEAD", repo);
    const diff = await getDiff(firstSha, secondSha, repo);
    expect(diff).toContain("hello world");
    expect(diff).toContain("diff --git");
  });

  it("returns empty string for identical SHAs", async () => {
    const sha = await resolveRef("HEAD", repo);
    const diff = await getDiff(sha, sha, repo);
    expect(diff).toBe("");
  });
});

describe("isShaResolvable", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("returns true for existing commit", async () => {
    const sha = await resolveRef("HEAD", repo);
    expect(await isShaResolvable(sha, repo)).toBe(true);
  });

  it("returns false for garbage", async () => {
    expect(await isShaResolvable("0000000000000000000000000000000000000000", repo)).toBe(false);
  });
});
