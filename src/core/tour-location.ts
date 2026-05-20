import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { repoKey, worktreeStamp } from "./repo-key.js";
import { tourHome } from "./tour-home.js";

export interface TourLocation {
  repoRoot: string;
  tourStoreRoot: string;
  worktreeStamp: string;
  legacyDotTour?: string;
}

interface ResolveTourLocationOptions {
  env?: { TOUR_HOME?: string };
}

function findRepoRoot(cwd: string): string {
  let current = cwd;
  const fsRoot = parse(current).root;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    if (current === fsRoot) return cwd;
    current = dirname(current);
  }
}

export async function resolveTourLocation(
  cwd: string,
  opts: ResolveTourLocationOptions = {},
): Promise<TourLocation> {
  const repoRoot = findRepoRoot(cwd);
  const key = await repoKey(repoRoot);
  const storeRoot = join(tourHome(opts.env), key);
  const legacyDotTour = join(repoRoot, ".tour");
  return {
    repoRoot,
    tourStoreRoot: storeRoot,
    worktreeStamp: await worktreeStamp(repoRoot),
    legacyDotTour: existsSync(legacyDotTour) ? legacyDotTour : undefined,
  };
}
