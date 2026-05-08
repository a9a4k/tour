import { getReview, listReviews, resolveIdPrefix } from "../core/review-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile, type FileClassification } from "../core/file-classifier.js";

interface TuiArgs {
  reviewId?: string;
  cwd: string;
}

export async function tui(args: TuiArgs): Promise<void> {
  let reviewId: string;

  if (args.reviewId) {
    reviewId = await resolveIdPrefix(args.cwd, args.reviewId);
  } else {
    const reviews = await listReviews(args.cwd, { status: "open" });
    if (reviews.length === 0) {
      throw new Error("No open reviews. Create one with: review create --head HEAD");
    }
    reviewId = reviews[reviews.length - 1].id;
  }

  const review = await getReview(args.cwd, reviewId);
  const annotations = await readAnnotations(args.cwd, reviewId);

  const headResolvable = await isShaResolvable(review.head_sha, args.cwd);
  const baseResolvable = await isShaResolvable(review.base_sha, args.cwd);
  const snapshotLost = !headResolvable || !baseResolvable;

  let rawDiff = "";
  let files: { name: string; prevName?: string; type: string; hunks: unknown[] }[] = [];
  let classifications: Record<string, FileClassification> = {};

  if (!snapshotLost) {
    rawDiff = await getDiff(review.base_sha, review.head_sha, args.cwd);
    const model = parseDiff(rawDiff);
    files = model.files;

    const entries = await Promise.all(
      model.files.map(async (f) => {
        const isRenamed = f.type === "rename" || (!!f.prevName && f.prevName !== f.name);
        const hasChanges = f.hunks.length > 0;
        const isBinary = f.type === "binary";
        const cls = await classifyFile(f.name, { cwd: args.cwd, isBinary, isRenamed, hasChanges });
        return [f.name, cls] as const;
      }),
    );
    classifications = Object.fromEntries(entries);
  }

  const tuiModule = "../tui/app.js";
  const { startTui } = await import(/* @vite-ignore */ tuiModule) as {
    startTui: (props: {
      review: typeof review;
      diff: string;
      files: typeof files;
      annotations: typeof annotations;
      snapshotLost: boolean;
      classifications: Record<string, FileClassification>;
    }) => Promise<void>;
  };
  await startTui({ review, diff: rawDiff, files, annotations, snapshotLost, classifications });
}
