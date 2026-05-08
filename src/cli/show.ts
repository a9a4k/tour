import { getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { printOutput } from "./output.js";

interface ShowArgs {
  tourId: string;
  json: boolean;
  cwd: string;
}

export async function show(args: ShowArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const tour = await getTour(args.cwd, resolvedId);
  const annotations = await readAnnotations(args.cwd, resolvedId);

  if (args.json) {
    printOutput({ ...tour, annotations }, true);
    return;
  }

  console.log(`Tour: ${tour.id}`);
  console.log(`Title:  ${tour.title || "(untitled)"}`);
  console.log(`Status: ${tour.status}`);
  console.log(`Head:   ${tour.head_sha.slice(0, 12)} (${tour.head_source || "default"})`);
  console.log(`Base:   ${tour.base_sha.slice(0, 12)} (${tour.base_source || "default"})`);
  console.log(`Created: ${tour.created_at}`);
  if (tour.closed_at) console.log(`Closed:  ${tour.closed_at}`);
  console.log(`Worktree snapshot: ${tour.worktree_snapshot}`);
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
