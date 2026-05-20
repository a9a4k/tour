import { listTours } from "../core/tour-store.js";
import { readComments } from "../core/comments-store.js";
import { printOutput } from "./output.js";

interface ListArgs {
  status: "open" | "closed" | "all";
  all: boolean;
  json: boolean;
  cwd: string;
  tourStoreRoot?: string;
  worktreeStamp?: string;
}

export async function list(args: ListArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  const tours = await listTours(tourStoreRoot, {
    status: args.status,
    worktreeStamp: args.all ? undefined : args.worktreeStamp,
  });

  if (args.json) {
    printOutput(tours, true);
    return;
  }

  if (tours.length === 0) {
    console.log("No tours found.");
    return;
  }

  for (const t of tours) {
    const comments = await readComments(tourStoreRoot, t.id);
    const annotCount = comments.length;
    const status = t.status === "open" ? "●" : "○";
    const title = t.title || "(untitled)";
    const annLabel = annotCount > 0 ? ` [${annotCount} comments]` : "";
    console.log(`${status} ${t.id}  ${title}${annLabel}`);
  }
}
