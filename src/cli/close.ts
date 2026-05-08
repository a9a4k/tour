import { updateTourStatus, resolveIdPrefix } from "../core/tour-store.js";
import { printOutput } from "./output.js";

interface CloseArgs {
  tourId: string;
  json: boolean;
  cwd: string;
}

export async function close(args: CloseArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const updated = await updateTourStatus(args.cwd, resolvedId, "closed");

  if (args.json) {
    printOutput(updated, true);
  } else {
    console.log(`Closed tour ${resolvedId}`);
  }
}
