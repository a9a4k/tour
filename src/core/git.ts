import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trimEnd();
}

export async function resolveRef(ref: string, cwd: string): Promise<string> {
  return git(["rev-parse", ref], cwd);
}

export async function isValidRef(ref: string, cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", ref], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function snapshotWorkingTree(
  tourId: string,
  cwd: string,
): Promise<string> {
  const stashSha = await git(
    ["stash", "create", "--include-untracked"],
    cwd,
  );
  const sha = stashSha || await resolveRef("HEAD", cwd);
  await git(
    ["update-ref", `refs/tour/${tourId}`, sha],
    cwd,
  );
  return sha;
}

export async function releaseSnapshot(
  tourId: string,
  cwd: string,
): Promise<void> {
  try {
    await git(["update-ref", "-d", `refs/tour/${tourId}`], cwd);
  } catch {
    // ref may already be gone
  }
}

export async function getDiff(
  baseSha: string,
  headSha: string,
  cwd: string,
): Promise<string> {
  return git(["diff", baseSha, headSha], cwd);
}

export async function isShaResolvable(sha: string, cwd: string): Promise<boolean> {
  try {
    await git(["cat-file", "-t", sha], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitShow(
  sha: string,
  path: string,
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await exec("git", ["show", `${sha}:${path}`], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

// Resolves the default base when `tour create` is invoked without --base.
//
// Probe chain anchors the merge-base on the repo's default branch (the
// PR target on GitHub), not on the current branch's own tracking ref.
// See issue #289 — pre-#289 logic anchored on `<tipRef>@{upstream}`,
// which for a feature branch pushed with `-u` points at origin/<feature>
// (the branch's own remote), narrowing the diff to "unpushed commits
// only" instead of "everything since divergence from main".
//
// Probes, in order. For each, compute `merge-base(tipSha, anchorSha)`;
// if it equals tipSha or parentSha, skip to the next (avoids returning
// HEAD or HEAD^ as the merge-base). The source string names the anchor
// used so the diff header tells the truth.
//
//   1. `origin/HEAD`  (symbolic ref set by `git clone` / `git remote
//      set-head origin --auto`). The source string names the *resolved*
//      short ref (e.g. `origin/main`) rather than `origin/HEAD`.
//   2. `origin/main`, then `origin/master` (covers `origin/HEAD` unset
//      and older repos).
//   3. `<tipRef>@{upstream}` (preserves correct behaviour when on the
//      default branch itself, or when remote layout is non-standard).
//   4. `parentRef` (detached HEAD, fresh repo, fully-pushed
//      single-commit branch — anything where the probes can't produce
//      a useful anchor).
//
// Detached HEAD (when tipRef is "HEAD" and HEAD is not a symbolic ref)
// skips the origin probes entirely: a user on bisect / checked-out SHA
// is exploring a specific commit and expects `HEAD^..HEAD` semantics.
// See issue #289 AC.
//
// Never throws: any git failure falls through.
export async function resolveDefaultBase(
  tipRef: string,
  parentRef: string,
  cwd: string,
): Promise<{ sha: string; source: string }> {
  const parentSha = await resolveRef(parentRef, cwd);
  const tipSha = await resolveRef(tipRef, cwd).catch(() => null);
  if (!tipSha) {
    return { sha: parentSha, source: parentRef };
  }

  const detached = tipRef === "HEAD" && !(await isOnBranch(cwd));

  if (!detached) {
    const anchors: string[] = [];
    const originHead = await resolveOriginHead(cwd);
    if (originHead) anchors.push(originHead);
    for (const ref of ["origin/main", "origin/master"]) {
      if (!anchors.includes(ref)) anchors.push(ref);
    }
    for (const anchor of anchors) {
      const anchorSha = await resolveRef(anchor, cwd).catch(() => null);
      if (!anchorSha) continue;
      const mergeBase: string = await git(["merge-base", tipSha, anchorSha], cwd).catch(() => "");
      if (mergeBase && mergeBase !== parentSha && mergeBase !== tipSha) {
        return { sha: mergeBase, source: `merge-base(${anchor})` };
      }
    }
  }

  try {
    const upstreamSha = await resolveRef(`${tipRef}@{upstream}`, cwd);
    const mergeBase = await git(["merge-base", tipSha, upstreamSha], cwd);
    if (mergeBase && mergeBase !== parentSha && mergeBase !== tipSha) {
      return { sha: mergeBase, source: `merge-base(${tipRef}@{upstream})` };
    }
  } catch {
    // No upstream / detached HEAD / SHA tipRef — fall through.
  }

  return { sha: parentSha, source: parentRef };
}

// Returns the resolved short ref of `refs/remotes/origin/HEAD` if it is
// a symbolic ref (e.g. `origin/main`), or `null` if unset / origin is
// absent.
async function resolveOriginHead(cwd: string): Promise<string | null> {
  try {
    return await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  } catch {
    return null;
  }
}

async function isOnBranch(cwd: string): Promise<boolean> {
  try {
    await git(["symbolic-ref", "--quiet", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}
