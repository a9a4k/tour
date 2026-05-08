import { pruneReviews } from "../core/review-store.js";
import { printOutput } from "./output.js";

interface PruneArgs {
  olderThan: string;
  json: boolean;
  cwd: string;
}

export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration "${input}". Use format like 30d, 24h, or 60m.`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

export async function prune(args: PruneArgs): Promise<void> {
  const ms = parseDuration(args.olderThan);
  const pruned = await pruneReviews(args.cwd, ms);

  if (args.json) {
    printOutput({ pruned }, true);
  } else if (pruned.length === 0) {
    console.log("No reviews to prune.");
  } else {
    console.log(`Pruned ${pruned.length} review(s): ${pruned.join(", ")}`);
  }
}
