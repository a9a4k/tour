import {
  deleteReview,
  resolveIdPrefix,
  getReview,
} from "../core/review-store.js";
import { releaseSnapshot } from "../core/git.js";
import { printOutput } from "./output.js";

interface DeleteArgs {
  reviewId: string;
  json: boolean;
  cwd: string;
}

export async function del(args: DeleteArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.reviewId);
  const review = await getReview(args.cwd, resolvedId);

  if (review.worktree_snapshot) {
    await releaseSnapshot(resolvedId, args.cwd);
  }

  await deleteReview(args.cwd, resolvedId);

  if (args.json) {
    printOutput({ deleted: resolvedId }, true);
  } else {
    console.log(`Deleted review ${resolvedId}`);
  }
}
