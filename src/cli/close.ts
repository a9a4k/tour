import { updateTourStatus, resolveIdPrefix } from "../core/tour-store.js";
import { printOutput } from "./output.js";

interface CloseArgs {
  tourId: string;
  json: boolean;
  cwd: string;
  tourStoreRoot?: string;
}

export async function close(args: CloseArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  const resolvedId = await resolveIdPrefix(tourStoreRoot, args.tourId);
  const updated = await updateTourStatus(tourStoreRoot, resolvedId, "closed");

  if (args.json) {
    printOutput(updated, true);
  } else {
    console.log(`Closed tour ${resolvedId}`);
  }
}
