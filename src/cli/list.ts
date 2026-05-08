import { listReviews } from "../core/review-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { printOutput } from "./output.js";

interface ListArgs {
  status: "open" | "closed" | "all";
  json: boolean;
  cwd: string;
}

export async function list(args: ListArgs): Promise<void> {
  const reviews = await listReviews(args.cwd, { status: args.status });

  if (args.json) {
    printOutput(reviews, true);
    return;
  }

  if (reviews.length === 0) {
    console.log("No reviews found.");
    return;
  }

  for (const r of reviews) {
    const annotations = await readAnnotations(args.cwd, r.id);
    const annotCount = annotations.length;
    const status = r.status === "open" ? "●" : "○";
    const title = r.title || "(untitled)";
    const annLabel = annotCount > 0 ? ` [${annotCount} annotations]` : "";
    console.log(`${status} ${r.id}  ${title}${annLabel}`);
  }
}
