import { updateReviewStatus, resolveIdPrefix } from "../core/review-store.js";
import { printOutput } from "./output.js";

interface CloseArgs {
  reviewId: string;
  json: boolean;
  cwd: string;
}

export async function close(args: CloseArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.reviewId);
  const updated = await updateReviewStatus(args.cwd, resolvedId, "closed");

  if (args.json) {
    printOutput(updated, true);
  } else {
    console.log(`Closed review ${resolvedId}`);
  }
}
