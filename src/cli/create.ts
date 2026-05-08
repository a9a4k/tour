import { resolveRef, snapshotWorkingTree } from "../core/git.js";
import { generateId } from "../core/ids.js";
import { ensureReviewIgnored } from "../core/gitignore.js";
import { createReview } from "../core/review-store.js";
import { printOutput } from "./output.js";
import type { Review } from "../core/types.js";

interface CreateArgs {
  head: string;
  base?: string;
  title?: string;
  json: boolean;
  cwd: string;
}

export async function create(args: CreateArgs): Promise<void> {
  const { head, title, json, cwd } = args;
  const id = generateId();

  await ensureReviewIgnored(cwd);

  const isWorktree = head === "WORKTREE";
  let headSha: string;
  let baseSha: string;

  if (isWorktree) {
    headSha = await snapshotWorkingTree(id, cwd);
    baseSha = args.base
      ? await resolveRef(args.base, cwd)
      : await resolveRef("HEAD", cwd);
  } else {
    headSha = await resolveRef(head, cwd);
    baseSha = args.base
      ? await resolveRef(args.base, cwd)
      : await resolveRef(head + "^", cwd);
  }

  const review: Review = {
    id,
    title: title ?? "",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: headSha,
    base_sha: baseSha,
    head_source: head,
    base_source: args.base ?? "",
    worktree_snapshot: isWorktree,
  };

  await createReview(cwd, review);

  if (json) {
    printOutput(review, true);
  } else {
    console.log(id);
    console.log(`Open with: review tui ${id}`);
  }
}
