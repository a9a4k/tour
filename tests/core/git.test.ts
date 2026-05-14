import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveRef,
  isValidRef,
  snapshotWorkingTree,
  releaseSnapshot,
  getDiff,
  isShaResolvable,
  gitShow,
  resolveDefaultBase,
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

describe("gitShow", () => {
  let repo: string;
  beforeEach(async () => { repo = await createTempRepo(); });

  it("returns blob content at HEAD", async () => {
    const head = await resolveRef("HEAD", repo);
    const content = await gitShow(head, "hello.txt", repo);
    expect(content).toBe("hello\n");
  });

  it("returns updated content after a second commit", async () => {
    await writeFile(join(repo, "hello.txt"), "hello world\n");
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", "update"], repo);
    const head = await resolveRef("HEAD", repo);
    const content = await gitShow(head, "hello.txt", repo);
    expect(content).toBe("hello world\n");
  });

  it("returns empty string when path does not exist at the SHA", async () => {
    const head = await resolveRef("HEAD", repo);
    const content = await gitShow(head, "does-not-exist.txt", repo);
    expect(content).toBe("");
  });

  it("returns empty string for the parent of an introducing commit", async () => {
    await writeFile(join(repo, "new.txt"), "new file\n");
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", "add new.txt"], repo);
    const parent = await resolveRef("HEAD^", repo);
    const content = await gitShow(parent, "new.txt", repo);
    expect(content).toBe("");
  });
});

// Synthesises a local "upstream" by cloning the initial-commit-only repo
// into a bare repo, adding it as `origin`, configuring HEAD's upstream
// tracking, then adding the requested number of feature commits on top.
// Mirrors the "branch ahead of origin/main" topology used in CI/PR flows
// without needing a network or external remote.
async function makeRepoAheadOfUpstream(featureCommits: number): Promise<string> {
  const repo = await createTempRepo();
  const bare = await mkdtemp(join(tmpdir(), "tour-git-upstream-"));
  await gitCmd(["clone", "--bare", repo, bare], repo);
  await gitCmd(["remote", "add", "origin", bare], repo);
  await gitCmd(["fetch", "origin"], repo);
  // The default branch name varies by git config (main vs master); read
  // it from HEAD instead of hard-coding.
  const branch = await gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  await gitCmd(["branch", `--set-upstream-to=origin/${branch}`, branch], repo);
  for (let i = 0; i < featureCommits; i++) {
    await writeFile(join(repo, `feature-${i}.txt`), `feature ${i}\n`);
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", `feature ${i}`], repo);
  }
  return repo;
}

// Reads the default branch name of the just-initialised repo (varies by
// `init.defaultBranch` config — typically `main` on modern git, `master`
// on older). Tests use this to assert source strings that name the
// resolved anchor (e.g. `merge-base(origin/main)` vs `origin/master`).
async function defaultBranchName(repo: string): Promise<string> {
  return gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], repo);
}

// Builds a "feature branch off main, tracking its own remote" topology:
// from `makeRepoAheadOfUpstream(0)` (default branch tracking origin) it
// branches off, adds `pushedAhead` commits, pushes (which sets
// `feature-x`'s upstream to `origin/feature-x`), then adds `unpushedAhead`
// further local commits. Returned: `repo` + `defaultBranch`. Reproduces
// the scenario in issue #289 where `@{upstream}` is the branch's own
// remote, not the PR target.
async function makeFeatureBranchOffMain(opts: {
  pushedAhead: number;
  unpushedAhead: number;
}): Promise<{ repo: string; defaultBranch: string }> {
  const repo = await makeRepoAheadOfUpstream(0);
  const defaultBranch = await defaultBranchName(repo);
  await gitCmd(["checkout", "-b", "feature-x"], repo);
  for (let i = 0; i < opts.pushedAhead; i++) {
    await writeFile(join(repo, `pushed-${i}.txt`), `pushed ${i}\n`);
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", `pushed ${i}`], repo);
  }
  if (opts.pushedAhead > 0) {
    await gitCmd(["push", "-u", "origin", "feature-x"], repo);
  }
  for (let i = 0; i < opts.unpushedAhead; i++) {
    await writeFile(join(repo, `unpushed-${i}.txt`), `unpushed ${i}\n`);
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", `unpushed ${i}`], repo);
  }
  return { repo, defaultBranch };
}

describe("resolveDefaultBase", () => {
  it("returns the merge-base on a multi-commit branch ahead of upstream", async () => {
    const repo = await makeRepoAheadOfUpstream(3);
    const branch = await defaultBranchName(repo);
    const upstreamSha = await resolveRef("HEAD@{upstream}", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(upstreamSha);
    // Probe chain prefers the named default-branch anchor over @{upstream}.
    expect(result.source).toBe(`merge-base(origin/${branch})`);
  });

  it("falls back to HEAD^ on a single-commit branch (merge-base equals HEAD^)", async () => {
    const repo = await makeRepoAheadOfUpstream(1);
    const parentSha = await resolveRef("HEAD^", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(parentSha);
    expect(result.source).toBe("HEAD^");
  });

  it("falls back to HEAD^ when no upstream is configured", async () => {
    const repo = await createTempRepo();
    await writeFile(join(repo, "second.txt"), "second\n");
    await gitCmd(["add", "."], repo);
    await gitCmd(["commit", "-m", "second"], repo);
    const parentSha = await resolveRef("HEAD^", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(parentSha);
    expect(result.source).toBe("HEAD^");
  });

  it("falls back to HEAD^ on detached HEAD", async () => {
    // Detached HEAD: user is exploring a specific commit (bisect /
    // checkout SHA). Skipping the origin probes preserves the
    // "HEAD^..HEAD" diff. See issue #289 — the AC explicitly keeps
    // this case unchanged.
    const repo = await makeRepoAheadOfUpstream(3);
    const headSha = await resolveRef("HEAD", repo);
    await gitCmd(["checkout", "--detach", headSha], repo);
    const parentSha = await resolveRef("HEAD^", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(parentSha);
    expect(result.source).toBe("HEAD^");
  });

  it("falls back to HEAD when WIP base-selection has zero commits ahead", async () => {
    // WIP shape: tipRef = parentRef = HEAD. With no upstream commits
    // ahead, merge-base equals HEAD itself — must fall back, not return
    // an empty diff.
    const repo = await makeRepoAheadOfUpstream(0);
    const headSha = await resolveRef("HEAD", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD", repo);
    expect(result.sha).toBe(headSha);
    expect(result.source).toBe("HEAD");
  });

  it("returns the merge-base for WIP base-selection on a multi-commit branch", async () => {
    // WIP: tipRef = parentRef = HEAD, but the branch is 3 commits ahead
    // of upstream — merge-base is older than HEAD, so use it.
    const repo = await makeRepoAheadOfUpstream(3);
    const branch = await defaultBranchName(repo);
    const upstreamSha = await resolveRef("HEAD@{upstream}", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD", repo);
    expect(result.sha).toBe(upstreamSha);
    expect(result.source).toBe(`merge-base(origin/${branch})`);
  });

  it("uses origin/HEAD when set (issue #289 AC: explicit symbolic ref wins)", async () => {
    // Created by `git clone` and `git remote set-head origin --auto`.
    // The source string names the *resolved* short ref so the diff
    // header tells the truth.
    const repo = await makeRepoAheadOfUpstream(3);
    const branch = await defaultBranchName(repo);
    await gitCmd(
      ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`],
      repo,
    );
    const upstreamSha = await resolveRef("HEAD@{upstream}", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(upstreamSha);
    expect(result.source).toBe(`merge-base(origin/${branch})`);
  });

  it("anchors on origin/<default> when a feature branch tracks its own remote (issue #289 repro)", async () => {
    // Reproduces issue #289: feature branch pushed with `-u` tracks
    // origin/feature-x, not origin/main. Pre-fix: @{upstream} = own
    // remote → narrow diff. Post-fix: origin/<default> resolves to the
    // PR target.
    const { repo, defaultBranch } = await makeFeatureBranchOffMain({
      pushedAhead: 2,
      unpushedAhead: 3,
    });
    // Sanity: @{upstream} is origin/feature-x, not origin/<default>.
    const upstreamRef = await gitCmd(["rev-parse", "--abbrev-ref", "@{upstream}"], repo);
    expect(upstreamRef).toBe("origin/feature-x");

    const expectedBase = await resolveRef(`origin/${defaultBranch}`, repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(expectedBase);
    expect(result.source).toBe(`merge-base(origin/${defaultBranch})`);
  });

  it("anchors on origin/<default> even when the feature branch is fully pushed (worst-case repro)", async () => {
    // Worse variant from issue #289: all feature commits pushed, so
    // @{upstream} == HEAD. Old logic: merge-base = HEAD → skip → fall
    // to HEAD^ (single-commit diff). New logic: origin/<default> = PR
    // target, returning the correct wider base.
    const { repo, defaultBranch } = await makeFeatureBranchOffMain({
      pushedAhead: 3,
      unpushedAhead: 0,
    });
    const expectedBase = await resolveRef(`origin/${defaultBranch}`, repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(expectedBase);
    expect(result.source).toBe(`merge-base(origin/${defaultBranch})`);
  });

  it("falls through to @{upstream} when neither origin/main nor origin/master exists", async () => {
    // Unusual layout: default branch is renamed to something exotic
    // and the standard names are gone. The probe chain falls through
    // to the existing @{upstream} heuristic — preserving today's
    // behaviour for users on non-standard remote layouts.
    const repo = await makeRepoAheadOfUpstream(3);
    const branch = await defaultBranchName(repo);
    // Rename origin/<default> to origin/trunk so neither origin/main
    // nor origin/master can resolve, and re-point the local branch's
    // upstream tracking at origin/trunk so @{upstream} still works.
    await gitCmd(
      ["update-ref", `refs/remotes/origin/trunk`, `refs/remotes/origin/${branch}`],
      repo,
    );
    await gitCmd(["update-ref", "-d", `refs/remotes/origin/${branch}`], repo);
    await gitCmd(["branch", "--set-upstream-to=origin/trunk", branch], repo);
    const upstreamSha = await resolveRef("HEAD@{upstream}", repo);
    const result = await resolveDefaultBase("HEAD", "HEAD^", repo);
    expect(result.sha).toBe(upstreamSha);
    expect(result.source).toBe("merge-base(HEAD@{upstream})");
  });
});
