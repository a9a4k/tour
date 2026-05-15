import { getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readComments } from "../core/comments-store.js";
import { buildConversationTree } from "../core/pickup.js";
import { printOutput } from "./output.js";

interface PickupArgs {
  tourId: string;
  json: boolean;
  cwd: string;
}

export async function pickup(args: PickupArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const tour = await getTour(args.cwd, resolvedId);
  const comments = await readComments(args.cwd, resolvedId);
  const tree = buildConversationTree(tour, comments);
  printOutput(tree, true);
}
