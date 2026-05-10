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
