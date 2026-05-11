// Decides whether bare `tour` opens the webapp or the TUI (issue #174).
//
// Pure function over an env shape. The caller (`src/main.ts case ""`) is
// responsible for collecting the real env (process.platform, SSH_TTY /
// SSH_CONNECTION, process.stdout.isTTY, `command -v open|xdg-open`) and
// passing it in — keeping this module testable without subprocesses or
// env-var reads.
//
// Today's rule set: webapp on darwin/linux with a TTY, a reachable
// browser-opener command, and no SSH; TUI otherwise. Windows falls back to
// TUI until a `start`-based opener lands (out of scope for this PRD).

export interface SurfaceEnv {
  platform: NodeJS.Platform;
  ssh: boolean;
  isTTY: boolean;
  hasOpenCommand: boolean;
}

export type Surface = "webapp" | "tui";

export function pickDefaultSurface(env: SurfaceEnv): Surface {
  if (env.ssh) return "tui";
  if (!env.isTTY) return "tui";
  if (env.platform !== "darwin" && env.platform !== "linux") return "tui";
  if (!env.hasOpenCommand) return "tui";
  return "webapp";
}
