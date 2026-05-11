import { existsSync, statSync, accessSync, constants } from "node:fs";
import { join, delimiter } from "node:path";

// Sync probe — "is this command name reachable on the caller's PATH?"
//
// Scans `process.env.PATH` directly rather than spawning `command -v` /
// `which` so the check is zero-subprocess at startup and portable to
// Windows (PATHEXT handling). The result is cached for the lifetime of
// the process — PATH doesn't change underneath a running `tour` invocation.
const cache = new Map<string, boolean>();

export function isOnPath(cmd: string): boolean {
  const hit = cache.get(cmd);
  if (hit !== undefined) return hit;
  const result = probe(cmd);
  cache.set(cmd, result);
  return result;
}

function probe(cmd: string): boolean {
  const PATH = process.env.PATH ?? "";
  if (PATH === "") return false;
  const dirs = PATH.split(delimiter).filter((d) => d.length > 0);
  // On Windows, executables typically have one of PATHEXT's extensions.
  // On POSIX, the bare name is the executable.
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (!existsSync(candidate)) continue;
      try {
        const stat = statSync(candidate);
        if (!stat.isFile()) continue;
        if (process.platform !== "win32") {
          // executable bit; on POSIX accessSync throws if not executable
          accessSync(candidate, constants.X_OK);
        }
        return true;
      } catch {
        // not executable / stat failed — keep scanning
      }
    }
  }
  return false;
}
