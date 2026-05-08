import {
  deleteTour,
  resolveIdPrefix,
  getTour,
} from "../core/tour-store.js";
import { releaseSnapshot } from "../core/git.js";
import { printOutput } from "./output.js";

interface DeleteArgs {
  tourId: string;
  json: boolean;
  cwd: string;
}

export async function del(args: DeleteArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const tour = await getTour(args.cwd, resolvedId);

  if (tour.wip_snapshot) {
    await releaseSnapshot(resolvedId, args.cwd);
  }

  await deleteTour(args.cwd, resolvedId);

  if (args.json) {
    printOutput({ deleted: resolvedId }, true);
  } else {
    console.log(`Deleted tour ${resolvedId}`);
  }
}
