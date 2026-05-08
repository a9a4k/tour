import { getReview, resolveIdPrefix } from "../core/review-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { printOutput } from "./output.js";

interface ShowArgs {
  reviewId: string;
  json: boolean;
  cwd: string;
}

export async function show(args: ShowArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.reviewId);
  const review = await getReview(args.cwd, resolvedId);
  const annotations = await readAnnotations(args.cwd, resolvedId);

  if (args.json) {
    printOutput({ ...review, annotations }, true);
    return;
  }

  console.log(`Review: ${review.id}`);
  console.log(`Title:  ${review.title || "(untitled)"}`);
  console.log(`Status: ${review.status}`);
  console.log(`Head:   ${review.head_sha.slice(0, 12)} (${review.head_source || "default"})`);
  console.log(`Base:   ${review.base_sha.slice(0, 12)} (${review.base_source || "default"})`);
  console.log(`Created: ${review.created_at}`);
  if (review.closed_at) console.log(`Closed:  ${review.closed_at}`);
  console.log(`Worktree snapshot: ${review.worktree_snapshot}`);
  console.log(`\nAnnotations (${annotations.length}):`);
  for (const a of annotations) {
    const range =
      a.line_start === a.line_end
        ? `${a.line_start}`
        : `${a.line_start}-${a.line_end}`;
    console.log(`  [${a.side}] ${a.file}:${range} (${a.author})`);
    console.log(`    ${a.body}`);
  }
}
