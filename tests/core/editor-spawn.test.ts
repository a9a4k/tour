import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnGuiEditor } from "../../src/core/editor-spawn.js";
import type { EditorConfig } from "../../src/core/editor-config.js";
import { waitForLog } from "../_helpers/wait-for-file.js";

// PRD #349 / ADR 0032 / issue #352 — integration coverage of the
// detached-spawn lifecycle: argv assembly, ENOENT, non-zero exit
// within 200ms, healthy spawn past 200ms. Backing fake-editor is a
// shell script parameterised by env vars so the test controls
// sleep/exit behavior per case.

const FAKE_EDITOR = `#!/bin/sh
# Fake editor for spawn lifecycle tests. Records argv to FAKE_EDITOR_LOG,
# optionally sleeps for FAKE_EDITOR_SLEEP ms, exits with FAKE_EDITOR_EXIT.
if [ -n "$FAKE_EDITOR_LOG" ]; then
  for a in "$@"; do
    printf '%s\\n' "$a" >> "$FAKE_EDITOR_LOG"
  done
fi
if [ -n "$FAKE_EDITOR_SLEEP_MS" ]; then
  # Sleep accepts fractional seconds on POSIX (BusyBox/coreutils both ok).
  sleep $(awk "BEGIN{print $FAKE_EDITOR_SLEEP_MS / 1000}")
fi
exit "\${FAKE_EDITOR_EXIT:-0}"
`;

let dir: string;
let fakeBin: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tour-editor-spawn-"));
  fakeBin = join(dir, "fake-editor.sh");
  await writeFile(fakeBin, FAKE_EDITOR);
  await chmod(fakeBin, 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function cfg(bin: string, opts: { argvTail?: (file: string, line: number) => string[] } = {}): EditorConfig {
  return {
    bin,
    argv:
      opts.argvTail ??
      ((file, line) => ["-g", `${file}:${line}`]),
    terminal: false,
  };
}

describe("spawnGuiEditor — happy path", () => {
  it("returns ok:true and writes argv to the fake-editor log", async () => {
    const log = join(dir, "happy.log");
    const result = await spawnGuiEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 42 },
      "/repo/root",
      { env: { FAKE_EDITOR_LOG: log } },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opened src/foo.ts:42");
    // Poll until the fake-editor's argv write lands on disk (issue #370).
    await waitForLog(log);
    const argv = (await readFile(log, "utf8")).trim().split("\n");
    expect(argv).toEqual(["-g", "/repo/root/src/foo.ts:42"]);
  });

  it("resolves to absolute path against repoRoot", async () => {
    const log = join(dir, "abs.log");
    const result = await spawnGuiEditor(
      cfg(fakeBin),
      { file: "deep/nested/x.ts", line: 7 },
      "/some/repo",
      { env: { FAKE_EDITOR_LOG: log } },
    );
    expect(result.ok).toBe(true);
    await waitForLog(log);
    const argv = (await readFile(log, "utf8")).trim().split("\n");
    expect(argv[1]).toBe("/some/repo/deep/nested/x.ts:7");
  });
});

describe("spawnGuiEditor — failure modes", () => {
  it("ENOENT (binary not on PATH) returns ok:false with command-not-found", async () => {
    const result = await spawnGuiEditor(
      cfg("/nonexistent/path/to/fake-editor"),
      { file: "src/foo.ts", line: 1 },
      "/repo",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("command not found");
  });

  it("non-zero exit inside 200ms returns ok:false with editor-failed", async () => {
    const result = await spawnGuiEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 1 },
      "/repo",
      { env: { FAKE_EDITOR_EXIT: "2" } },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("editor failed");
    expect(result.message).toContain("2");
  });

  it("healthy spawn that sleeps past 200ms returns ok:true (success window)", async () => {
    const result = await spawnGuiEditor(
      cfg(fakeBin),
      { file: "src/foo.ts", line: 1 },
      "/repo",
      { env: { FAKE_EDITOR_SLEEP_MS: "400" } },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Opened src/foo.ts:1");
  });
});
