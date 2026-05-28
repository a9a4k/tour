import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  spawnTerminalEditor,
  type SuspendableRenderer,
} from "../../src/tui/terminal-editor-spawn.js";
import type { EditorConfig } from "../../src/core/editor-config.js";

// PRD #349 / ADR 0032 / issue #355 — integration coverage of the
// suspend/inherit/resume lifecycle. The fake-editor shell script
// mimics a terminal editor: writes argv to disk, optionally exits
// non-zero, optionally sends itself a SIGKILL. The renderer is
// stubbed with a SuspendableRenderer that records calls so we can
// assert suspend()/resume() pairing under every exit path.

const FAKE_EDITOR = `#!/bin/sh
# Fake terminal editor for suspend/resume integration tests. Writes
# argv to FAKE_EDITOR_LOG, then either exits with FAKE_EDITOR_EXIT
# (default 0) or, if FAKE_EDITOR_SIGKILL=1, sends itself SIGKILL to
# simulate a crash.
if [ -n "$FAKE_EDITOR_LOG" ]; then
  for a in "$@"; do
    printf '%s\\n' "$a" >> "$FAKE_EDITOR_LOG"
  done
fi
if [ "$FAKE_EDITOR_SIGKILL" = "1" ]; then
  kill -KILL $$
fi
exit "\${FAKE_EDITOR_EXIT:-0}"
`;

let dir: string;
let fakeBin: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tour-terminal-editor-spawn-"));
  fakeBin = join(dir, "fake-terminal-editor.sh");
  await writeFile(fakeBin, FAKE_EDITOR);
  await chmod(fakeBin, 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function cfg(bin: string): EditorConfig {
  return {
    template: bin,
    bin,
    argv: (file, line) => [`+${line}`, file],
    terminal: true,
  };
}

function recordingRenderer(): SuspendableRenderer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    suspend: () => {
      calls.push("suspend");
    },
    resume: () => {
      calls.push("resume");
    },
  };
}

describe("spawnTerminalEditor — happy path", () => {
  it("suspends the renderer, spawns the editor with inherited stdio, and resumes on exit", async () => {
    const log = join(dir, "happy.log");
    const renderer = recordingRenderer();
    const result = await spawnTerminalEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 42 },
      "/repo/root",
      renderer,
      { env: { FAKE_EDITOR_LOG: log } },
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opened src/foo.ts:42");
    expect(renderer.calls).toEqual(["suspend", "resume"]);

    const argv = (await readFile(log, "utf8")).trim().split("\n");
    expect(argv).toEqual(["+42", "/repo/root/src/foo.ts"]);
  });
});

describe("spawnTerminalEditor — exit code is not surfaced", () => {
  it("returns ok:true even when the editor exits non-zero (no `:cq` noise)", async () => {
    const renderer = recordingRenderer();
    const result = await spawnTerminalEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 1 },
      "/repo",
      renderer,
      { env: { FAKE_EDITOR_EXIT: "2" } },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opened src/foo.ts:1");
    expect(renderer.calls).toEqual(["suspend", "resume"]);
  });
});

describe("spawnTerminalEditor — resilience", () => {
  it("resumes the renderer even when the editor is killed (SIGKILL)", async () => {
    const renderer = recordingRenderer();
    const result = await spawnTerminalEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 1 },
      "/repo",
      renderer,
      { env: { FAKE_EDITOR_SIGKILL: "1" } },
    );
    // Exit code / signal not surfaced — `o`'s contract is that the
    // open was performed, not that the user committed an edit.
    expect(result.ok).toBe(true);
    expect(renderer.calls).toEqual(["suspend", "resume"]);
  });

  it("resumes the renderer and returns command-not-found on ENOENT", async () => {
    const renderer = recordingRenderer();
    const result = await spawnTerminalEditor(
      cfg("/nonexistent/path/to/vim"),
      { file: "src/foo.ts", line: 1 },
      "/repo",
      renderer,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("command not found");
    expect(renderer.calls).toEqual(["suspend", "resume"]);
  });
});
