// Editor spawn (PRD #349 / ADR 0032 / issue #352). Detached child with
// stdio: 'ignore' + unref(), so the editor outlives tour. Race a 200ms
// timer against the child's exit/error events: ENOENT or non-zero exit
// inside the window → footer-error; otherwise → success.
//
// The 200ms window subsumes the terminal/GUI exit-handling distinction
// for GUI editors that exit cleanly: real spawn failures die in <50ms,
// a healthy GUI editor doesn't exit at all in the window.

import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { EditorConfig } from "./editor-config.js";
import type { OpenTarget } from "./open-target-resolver.js";

export interface SpawnResult {
  ok: boolean;
  message: string;
}

export interface SpawnOptions {
  /** Extra env vars to pass to the child. Used by the integration tests
   *  to parameterise the fake-editor's behavior. */
  env?: NodeJS.ProcessEnv;
  /** Override the 200ms success window. Tests can pass a smaller value
   *  to keep wall-clock short; production never sets this. */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 200;

export function spawnGuiEditor(
  config: EditorConfig,
  target: OpenTarget,
  repoRoot: string,
  opts: SpawnOptions = {},
): Promise<SpawnResult> {
  const absPath = isAbsolute(target.file) ? target.file : join(repoRoot, target.file);
  const argv = config.argv(absPath, target.line);
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const displayBin = config.bin.split("/").pop() ?? config.bin;

  return new Promise<SpawnResult>((resolve) => {
    let settled = false;
    const settle = (r: SpawnResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.bin, argv, {
        detached: true,
        stdio: "ignore",
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        settle({ ok: false, message: `o: ${displayBin}: command not found` });
      } else {
        settle({ ok: false, message: `o: spawn failed (${e.message})` });
      }
      return;
    }

    child.on("error", (err) => {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        settle({ ok: false, message: `o: ${displayBin}: command not found` });
      } else {
        settle({ ok: false, message: `o: spawn failed (${e.message})` });
      }
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        settle({ ok: false, message: `o: editor failed (code ${code})` });
      } else {
        // Clean exit inside the window is treated as success — some
        // editors fork-and-detach by exiting the foreground process
        // (e.g. `gnome-text-editor` invocations).
        settle({ ok: true, message: `Opened ${target.file}:${target.line}` });
      }
    });

    child.unref();

    setTimeout(() => {
      settle({ ok: true, message: `Opened ${target.file}:${target.line}` });
    }, windowMs);
  });
}
