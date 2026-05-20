import { getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readComments } from "../core/comments-store.js";
import { buildConversationTree } from "../core/pickup.js";
import { printOutput } from "./output.js";

interface PickupArgs {
  tourId: string;
  json: boolean;
  cwd: string;
  tourStoreRoot?: string;
}

export async function pickup(args: PickupArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  const resolvedId = await resolveIdPrefix(tourStoreRoot, args.tourId);
  const tour = await getTour(tourStoreRoot, resolvedId);
  const comments = await readComments(tourStoreRoot, resolvedId);
  const tree = buildConversationTree(tour, comments);
  printOutput(tree, true);
}
