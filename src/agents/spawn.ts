import { spawn } from "node:child_process";
import type { SpawnOpts, SpawnResult, SpawnedAdapter } from "../core/agent-adapter.js";

// Shared spawn helper for shipped reply-agents. Launches the inner CLI with
// stdin closed (the agent has zero tools and reads nothing from us at
// runtime), stdout piped (Tour captures it as the Reply body — ADR 0012),
// and stderr inherited so failures land in the server's terminal instead of
// being swallowed by an undrained pipe.
//
// The TOUR_* env vars are still set so external `tour` invocations from
// scripts the user may have hooked into their adapter shim still work, even
// though the bundled adapters no longer rely on them.
export function spawnCli(
  cmd: string,
  args: string[],
  opts: SpawnOpts,
): SpawnedAdapter {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      TOUR_ID: opts.envelope.tour.id,
      TOUR_HEAD_SHA: opts.envelope.tour.head_sha,
      TOUR_BASE_SHA: opts.envelope.tour.base_sha,
      TOUR_DIR: opts.tourDir,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
  }
  const exit = new Promise<SpawnResult>((resolve) => {
    let resolved = false;
    const finish = (result: SpawnResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    child.on("exit", (code, signal) => finish({ code, signal, stdout }));
    child.on("error", (err) => finish({ code: null, signal: null, stdout, error: err }));
  });
  return { pid: child.pid ?? 0, exit };
}
