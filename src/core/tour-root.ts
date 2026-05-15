import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

// Owns the "where does .tour/ live?" decision for every `tour` subcommand
// (issue #369). Walking up from cwd, the first `.git` ancestor wins —
// `.git` may be a directory (regular checkout) or a file (worktree), so
// a plain `existsSync` is the right check. Only when no `.git` exists at
// any ancestor do we fall back to the first `.tour/` ancestor, and only
// when neither exists do we ground out at cwd (matches today's behaviour
// for "not in a repo, no tours yet").
//
// `strayTourDirs` lists `.tour/` directories found at ancestors *below*
// the resolved root — these are the sub-directory tours from before #369
// that the new resolver no longer reads from. Surfacing them as a
// warning is the explicit user-facing seam for the "no silent migration"
// rule in the issue brief: we don't move files, we just point the user
// at the orphan.
export interface ResolvedTourRoot {
  root: string;
  strayTourDirs: string[];
}

export async function resolveTourRoot(cwd: string): Promise<ResolvedTourRoot> {
  const ancestors: string[] = [];
  let current = cwd;
  const fsRoot = parse(current).root;
  while (true) {
    ancestors.push(current);
    if (existsSync(join(current, ".git"))) {
      const strays: string[] = [];
      for (const a of ancestors) {
        if (a !== current && existsSync(join(a, ".tour"))) {
          strays.push(join(a, ".tour"));
        }
      }
      return { root: current, strayTourDirs: strays };
    }
    if (current === fsRoot) break;
    current = dirname(current);
  }
  // No `.git` anywhere on the chain. Fall back to the first `.tour/`
  // ancestor — preserves "tours-only" workflows outside a git repo.
  for (const a of ancestors) {
    if (existsSync(join(a, ".tour"))) {
      return { root: a, strayTourDirs: [] };
    }
  }
  return { root: cwd, strayTourDirs: [] };
}
