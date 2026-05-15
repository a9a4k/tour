// Terminal-editor spawn for the TUI (PRD #349 / ADR 0032 / issue #355).
// Mirrors `git commit`'s editor dance: pause the opentui renderer, hand
// the terminal to the editor via `stdio: 'inherit'`, await exit, resume
// the renderer with a full repaint.
//
// Exit code is intentionally not surfaced — `:q` vs `:cq` in vim has no
// semantic meaning for `o` (no follow-up step to abort). Any termination
// reason returns the same success footer.
//
// Resume is guaranteed via try/finally: if the editor crashes or is
// killed, the TUI is not left in a paused state. ENOENT (missing binary)
// is the only failure footer; signal exits return success.

import { spawn } from "node:child_process";
import { basename, isAbsolute, join } from "node:path";
import type { EditorConfig } from "../core/editor-config.js";
import type { OpenTarget } from "../core/open-target-resolver.js";

export interface SpawnTerminalResult {
  ok: boolean;
  message: string;
}

export interface SuspendableRenderer {
  /** Yield stdin/stdout to the inherited child. The opentui renderer's
   *  `suspend()` clears the alt-screen, restores raw-mode, and stops the
   *  render loop. */
  suspend(): void;
  /** Reclaim the terminal and force a full repaint. */
  resume(): void;
}

export interface SpawnTerminalOptions {
  /** Extra env vars to pass to the child. Used by the integration tests
   *  to parameterise the fake-editor's behavior. */
  env?: NodeJS.ProcessEnv;
}

export async function spawnTerminalEditor(
  config: EditorConfig,
  target: OpenTarget,
  repoRoot: string,
  renderer: SuspendableRenderer,
  opts: SpawnTerminalOptions = {},
): Promise<SpawnTerminalResult> {
  const absPath = isAbsolute(target.file) ? target.file : join(repoRoot, target.file);
  const argv = config.argv(absPath, target.line);
  const displayBin = basename(config.bin);
  const success: SpawnTerminalResult = {
    ok: true,
    message: `Opened ${target.file}:${target.line}`,
  };

  const errorResult = (err: unknown): SpawnTerminalResult => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { ok: false, message: `o: ${displayBin}: command not found` };
    }
    return { ok: false, message: `o: spawn failed (${e.message})` };
  };

  renderer.suspend();
  try {
    return await new Promise<SpawnTerminalResult>((resolve) => {
      let settled = false;
      const settle = (r: SpawnTerminalResult): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(config.bin, argv, {
          stdio: "inherit",
          env: opts.env ? { ...process.env, ...opts.env } : process.env,
        });
      } catch (err) {
        settle(errorResult(err));
        return;
      }

      child.on("error", (err) => settle(errorResult(err)));
      // `close` fires after stdio is fully released — listening here (not
      // `exit`) prevents a race where resume() draws while the inherited
      // child is still flushing its final write.
      child.on("close", () => settle(success));
    });
  } finally {
    renderer.resume();
  }
}
