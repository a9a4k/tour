import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { NotGitWorkingTreeError } from "./not-git-working-tree-error.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trimEnd();
}

function resolveGitPath(cwd: string, value: string): string {
  return isAbsolute(value) ? value : join(cwd, value);
}

function slug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "repo";
}

function keyName(repoRoot: string, gitCommonDir: string): string {
  const commonBase = basename(gitCommonDir);
  if (commonBase === ".git") return basename(dirname(gitCommonDir));
  return basename(repoRoot);
}

function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export async function gitCommonDir(cwd: string): Promise<string> {
  try {
    return await realpath(resolveGitPath(cwd, await git(["rev-parse", "--git-common-dir"], cwd)));
  } catch {
    throw new NotGitWorkingTreeError();
  }
}

export async function repoKey(cwd: string): Promise<string> {
  const commonDir = await gitCommonDir(cwd);
  return `${slug(keyName(cwd, commonDir))}-${shortHash(commonDir)}`;
}

export async function worktreeStamp(cwd: string): Promise<string> {
  try {
    return await realpath(resolveGitPath(cwd, await git(["rev-parse", "--git-dir"], cwd)));
  } catch {
    throw new NotGitWorkingTreeError();
  }
}
