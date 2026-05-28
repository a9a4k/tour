import { spawn } from "node:child_process";
import type {
  SpawnOpts,
  SpawnResult,
  SpawnedAdapter,
  StreamListener,
} from "../core/agent-adapter.js";

// Shared spawn helper for shipped reply-agents. Launches the inner CLI with
// stdin closed, stdout piped (Tour captures it as the Reply body — ADR 0012),
// and stderr piped (captured into the per-dispatch log file by the runner —
// ADR 0014). Stderr was previously `inherit`-ed but that left
// failure-mode diagnostics ephemeral and was a TUI framebuffer hazard for
// chatty CLIs.
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutListeners: StreamListener[] = [];
  const stderrListeners: StreamListener[] = [];
  // Per-stream buffers cover the gap between spawn returning and the
  // runner attaching its onStdout / onStderr listener: writeReplyLock +
  // createDispatchLogger are async, and the child may already have flushed
  // its first bytes by the time we get back. Buffered chunks are flushed
  // to the listener on first attach. Mirrors how Node streams in paused
  // mode buffer in the OS pipe until a `data` listener arrives.
  const stdoutBuffer: string[] = [];
  const stderrBuffer: string[] = [];
  let stdout = "";
  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer | string) => {
      const s = chunk.toString();
      stdout += s;
      if (stdoutListeners.length === 0) stdoutBuffer.push(s);
      else for (const cb of stdoutListeners) cb(s);
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer | string) => {
      const s = chunk.toString();
      if (stderrListeners.length === 0) stderrBuffer.push(s);
      else for (const cb of stderrListeners) cb(s);
    });
  }
  const exit = new Promise<SpawnResult>((resolve) => {
    let resolved = false;
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let stdoutClosed = !child.stdout;
    let stderrClosed = !child.stderr;
    const finish = (result: SpawnResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    const maybeFinish = (): void => {
      if (exitInfo && stdoutClosed && stderrClosed) {
        finish({ code: exitInfo.code, signal: exitInfo.signal, stdout });
      }
    };
    child.stdout?.on("close", () => {
      stdoutClosed = true;
      maybeFinish();
    });
    child.stderr?.on("close", () => {
      stderrClosed = true;
      maybeFinish();
    });
    child.on("exit", (code, signal) => {
      exitInfo = { code, signal };
      maybeFinish();
    });
    child.on("error", (err) =>
      finish({ code: null, signal: null, stdout, error: err }),
    );
  });
  return {
    pid: child.pid ?? 0,
    onStdout: (cb) => {
      stdoutListeners.push(cb);
      // Drain any chunks that arrived before the first listener attached.
      while (stdoutBuffer.length > 0) cb(stdoutBuffer.shift()!);
    },
    onStderr: (cb) => {
      stderrListeners.push(cb);
      while (stderrBuffer.length > 0) cb(stderrBuffer.shift()!);
    },
    exit,
  };
}
