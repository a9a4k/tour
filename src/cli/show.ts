import { getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readComments } from "../core/comments-store.js";
import { printOutput } from "./output.js";

interface ShowArgs {
  tourId: string;
  json: boolean;
  cwd: string;
  tourStoreRoot?: string;
}

export async function show(args: ShowArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  const resolvedId = await resolveIdPrefix(tourStoreRoot, args.tourId);
  const tour = await getTour(tourStoreRoot, resolvedId);
  const comments = await readComments(tourStoreRoot, resolvedId);

  if (args.json) {
    printOutput({ ...tour, comments }, true);
    return;
  }

  console.log(`Tour: ${tour.id}`);
  console.log(`Title:  ${tour.title || "(untitled)"}`);
  console.log(`Status: ${tour.status}`);
  console.log(`Head:   ${tour.head_sha.slice(0, 12)} (${tour.head_source || "default"})`);
  console.log(`Base:   ${tour.base_sha.slice(0, 12)} (${tour.base_source || "default"})`);
  console.log(`Created: ${tour.created_at}`);
  if (tour.closed_at) console.log(`Closed:  ${tour.closed_at}`);
  console.log(`WIP snapshot: ${tour.wip_snapshot}`);
  console.log(`\nComments (${comments.length}):`);
  for (const a of comments) {
    const range =
      a.line_start === a.line_end
        ? `${a.line_start}`
        : `${a.line_start}-${a.line_end}`;
    console.log(`  [${a.side}] ${a.file}:${range} (${a.author})`);
    console.log(`    ${a.body}`);
  }
}
