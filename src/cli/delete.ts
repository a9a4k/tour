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
  tourStoreRoot?: string;
}

export async function del(args: DeleteArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  const resolvedId = await resolveIdPrefix(tourStoreRoot, args.tourId);
  const tour = await getTour(tourStoreRoot, resolvedId);

  if (tour.wip_snapshot) {
    await releaseSnapshot(resolvedId, args.cwd);
  }

  await deleteTour(tourStoreRoot, resolvedId);

  if (args.json) {
    printOutput({ deleted: resolvedId }, true);
  } else {
    console.log(`Deleted tour ${resolvedId}`);
  }
}
