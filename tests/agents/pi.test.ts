import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PI_ADAPTER_SCRIPT } from "../../src/agents/pi.js";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MockEnv {
  /** Tempdir holding the adapter + the mock-bin shims. */
  dir: string;
  /** Path to the materialized pi.sh adapter. */
  adapter: string;
  /** PATH-prepend dir containing fake `pi` and `tour`. */
  binDir: string;
  /** File the fake pi writes its argv to (NUL-separated; args may contain newlines). */
  argvFile: string;
  /** File the fake pi writes its stdin to. */
  piStdinFile: string;
  /** Sentinel: created iff the fake `tour` was invoked with `reply-system-prompt`. */
  systemPromptCalledFile: string;
}

/**
 * Fake `pi`: dumps argv (NUL-separated, since the multi-line user prompt
 * would not round-trip cleanly with newline-separation) and stdin to
 * inspection files, exits 0.
 * Fake `tour`: emits a known system-prompt token when called as `tour reply-system-prompt`.
 */
async function setupMockEnv(): Promise<MockEnv> {
  const dir = await mkdtemp(join(tmpdir(), "tour-pi-adapter-"));
  const adapter = join(dir, "pi.sh");
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const argvFile = join(dir, "pi-argv.txt");
  const piStdinFile = join(dir, "pi-stdin.txt");
  const systemPromptCalledFile = join(dir, "tour-system-prompt-called.txt");

  await writeFile(adapter, PI_ADAPTER_SCRIPT);
  await chmod(adapter, 0o755);

  // NUL-separate args so prompts containing newlines round-trip cleanly.
  const fakePi = `#!/usr/bin/env bash
set -e
: > "${argvFile}"
for arg in "$@"; do
  printf '%s\\0' "$arg" >> "${argvFile}"
done
cat > "${piStdinFile}"
exit 0
`;
  await writeFile(join(binDir, "pi"), fakePi);
  await chmod(join(binDir, "pi"), 0o755);

  const fakeTour = `#!/usr/bin/env bash
if [ "$1" = "reply-system-prompt" ]; then
  : > "${systemPromptCalledFile}"
  printf 'CANNED_SYSTEM_PROMPT\\n'
  exit 0
fi
echo "fake tour: unsupported subcommand $1" >&2
exit 1
`;
  await writeFile(join(binDir, "tour"), fakeTour);
  await chmod(join(binDir, "tour"), 0o755);

  return { dir, adapter, binDir, argvFile, piStdinFile, systemPromptCalledFile };
}

function runAdapter(env: MockEnv, envelopeJson: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(env.adapter, [], {
      env: {
        // PATH-prepend our mock bin so `pi` and `tour` resolve to the fakes.
        PATH: `${env.binDir}:${process.env.PATH ?? ""}`,
        TOUR_ID: "2026-05-10-120000-test",
        TOUR_HEAD_SHA: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        TOUR_BASE_SHA: "feedfacefeedfacefeedfacefeedfacefeedface",
        TOUR_DIR: env.dir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.stdin.write(envelopeJson);
    child.stdin.end();
    child.on("exit", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

const SAMPLE_ENVELOPE = JSON.stringify({
  tour: {
    id: "2026-05-10-120000-test",
    title: "Test",
    status: "open",
    created_at: "2026-05-10T12:00:00Z",
    closed_at: "",
    head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    base_sha: "feedfacefeedfacefeedfacefeedfacefeedface",
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
  },
  triggering_annotation: {
    id: "abc123",
    file: "src/main.ts",
    side: "additions",
    line_start: 10,
    line_end: 10,
    body: "why this change?",
    author: "alice",
    author_kind: "human",
    created_at: "2026-05-10T12:00:00Z",
  },
  thread: [
    {
      id: "abc123",
      file: "src/main.ts",
      side: "additions",
      line_start: 10,
      line_end: 10,
      body: "why this change?",
      author: "alice",
      author_kind: "human",
      created_at: "2026-05-10T12:00:00Z",
    },
  ],
});

describe("pi adapter (smoke test against mocked pi + tour)", () => {
  let env: MockEnv;
  beforeEach(async () => {
    env = await setupMockEnv();
  });

  it("exits 0 when the mocked pi exits 0", async () => {
    const result = await runAdapter(env, SAMPLE_ENVELOPE);
    expect(result.exitCode).toBe(0);
  });

  it("invokes `tour reply-system-prompt` to obtain the canonical prompt", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    expect(existsSync(env.systemPromptCalledFile)).toBe(true);
  });

  it("invokes pi with --print, capability-bound flags, and the canned system prompt", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);

    expect(argv).toContain("--print");

    // System prompt is sourced from `tour reply-system-prompt` (fake emits
    // the token "CANNED_SYSTEM_PROMPT") and passed through --system-prompt.
    const sysIdx = argv.indexOf("--system-prompt");
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(argv[sysIdx + 1]).toContain("CANNED_SYSTEM_PROMPT");

    // Capability bounding: --tools bash reduces pi's surface to a single
    // tool (no fs read/write/edit/grep/find/ls).
    const toolsIdx = argv.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(argv[toolsIdx + 1]).toBe("bash");

    // Disable user-side pi config that could re-introduce banned tools or
    // override the system prompt.
    expect(argv).toContain("--no-extensions");
    expect(argv).toContain("--no-skills");
    expect(argv).toContain("--no-prompt-templates");
    expect(argv).toContain("--no-context-files");
  });

  it("includes the envelope JSON in the user prompt argument", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);
    // The user prompt is the trailing positional argument; it must reference
    // the triggering annotation id so the agent knows what to --reply-to.
    const userPrompt = argv[argv.length - 1];
    expect(userPrompt).toContain("abc123");
    expect(userPrompt).toContain("2026-05-10-120000-test");
  });

  it("writes nothing outside the inspection files (no fs writes inside the adapter itself)", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    // The adapter's own filesystem footprint should be zero; the fake pi
    // writes the inspection files. Anything else inside `dir` would be a
    // surprise side-effect from the adapter.
    const expected = new Set([
      "pi.sh",
      "bin",
      "pi-argv.txt",
      "pi-stdin.txt",
      "tour-system-prompt-called.txt",
    ]);
    const actual = new Set(readdirSync(env.dir));
    for (const name of actual) {
      expect(expected.has(name)).toBe(true);
    }
  });
});
