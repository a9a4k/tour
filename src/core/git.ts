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
// Probes `<tipRef>@{upstream}`. If present and the branch is ≥2 commits
// ahead of upstream (merge-base strictly between tip and parent), returns
// the merge-base — the same scope GitHub uses for PR diffs. Otherwise
// returns `parentRef`, matching today's behavior. Never throws: any git
// failure (detached HEAD, no upstream, tipRef is a SHA) falls back to
// parentRef. See issue #201.
export async function resolveDefaultBase(
  tipRef: string,
  parentRef: string,
  cwd: string,
): Promise<{ sha: string; source: string }> {
  const parentSha = await resolveRef(parentRef, cwd);

  try {
    const upstreamSha = await resolveRef(`${tipRef}@{upstream}`, cwd);
    const tipSha = await resolveRef(tipRef, cwd);
    const mergeBase = await git(["merge-base", tipSha, upstreamSha], cwd);
    if (mergeBase && mergeBase !== parentSha && mergeBase !== tipSha) {
      return { sha: mergeBase, source: `merge-base(${tipRef}@{upstream})` };
    }
  } catch {
    // No upstream / detached HEAD / SHA tipRef — fall through.
  }

  return { sha: parentSha, source: parentRef };
}
