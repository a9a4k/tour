import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GEMINI_ADAPTER_SCRIPT } from "../../src/agents/gemini.js";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MockEnv {
  /** Tempdir holding the adapter + the mock-bin shims. */
  dir: string;
  /** Path to the materialized gemini.sh adapter. */
  adapter: string;
  /** PATH-prepend dir containing fake `gemini` and `tour`. */
  binDir: string;
  /** File the fake gemini writes its argv to (NUL-separated; args may contain newlines). */
  argvFile: string;
  /** File the fake gemini writes its stdin to. */
  geminiStdinFile: string;
  /** Sentinel: created iff the fake `tour` was invoked with `reply-system-prompt`. */
  systemPromptCalledFile: string;
}

/**
 * Fake `gemini`: dumps argv NUL-separated (args may contain newlines) and
 * stdin to inspection files, exits 0.
 * Fake `tour`: emits a known system-prompt token when called as
 * `tour reply-system-prompt`.
 */
async function setupMockEnv(): Promise<MockEnv> {
  const dir = await mkdtemp(join(tmpdir(), "tour-gemini-adapter-"));
  const adapter = join(dir, "gemini.sh");
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const argvFile = join(dir, "gemini-argv.txt");
  const geminiStdinFile = join(dir, "gemini-stdin.txt");
  const systemPromptCalledFile = join(dir, "tour-system-prompt-called.txt");

  await writeFile(adapter, GEMINI_ADAPTER_SCRIPT);
  await chmod(adapter, 0o755);

  const fakeGemini = `#!/usr/bin/env bash
set -e
: > "${argvFile}"
for arg in "$@"; do
  printf '%s\\0' "$arg" >> "${argvFile}"
done
cat > "${geminiStdinFile}"
exit 0
`;
  await writeFile(join(binDir, "gemini"), fakeGemini);
  await chmod(join(binDir, "gemini"), 0o755);

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

  return { dir, adapter, binDir, argvFile, geminiStdinFile, systemPromptCalledFile };
}

function runAdapter(env: MockEnv, envelopeJson: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(env.adapter, [], {
      env: {
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
    head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".slice(0, 40),
    base_sha: "feedfacefeedfacefeedfacefeedfacefeedfacefeedface".slice(0, 40),
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

describe("gemini adapter (smoke test against mocked gemini + tour)", () => {
  let env: MockEnv;
  beforeEach(async () => {
    env = await setupMockEnv();
  });

  it("exits 0 when the mocked gemini exits 0", async () => {
    const result = await runAdapter(env, SAMPLE_ENVELOPE);
    expect(result.exitCode).toBe(0);
  });

  it("invokes `tour reply-system-prompt` to obtain the canonical prompt", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    expect(existsSync(env.systemPromptCalledFile)).toBe(true);
  });

  it("invokes gemini in one-shot mode with capability-bound flags", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);

    // One-shot prompt mode: -p / --prompt.
    const promptIdx = argv.findIndex((a) => a === "--prompt" || a === "-p");
    expect(promptIdx).toBeGreaterThanOrEqual(0);

    // Capability bounding: only the `tour annotate` shell-tool prefix is
    // auto-approved. Tools outside the allow-list still require approval and
    // therefore fail in non-interactive (no-TTY) mode.
    const allowIdx = argv.indexOf("--allowed-tools");
    expect(allowIdx).toBeGreaterThanOrEqual(0);
    expect(argv[allowIdx + 1]).toContain("tour annotate");

    // Belt-and-suspenders: explicitly exclude the file-mutating tools so a
    // future gemini-cli release that softens the allow-list semantics still
    // can't widen the surface.
    const denyIdx = argv.indexOf("--exclude-tools");
    expect(denyIdx).toBeGreaterThanOrEqual(0);
    const deny = argv[denyIdx + 1];
    expect(deny).toContain("WriteFileTool");
    expect(deny).toContain("EditTool");
  });

  it("includes the envelope JSON and the system prompt in the prompt argument", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);
    // The prompt is the trailing positional/flag value; it must reference the
    // triggering annotation id and the tour id so the agent has what it needs
    // to call `tour annotate --reply-to <id>`. Gemini has no native
    // --system-prompt flag, so the canonical reply-system-prompt is inlined.
    const userPrompt = argv[argv.length - 1];
    expect(userPrompt).toContain("abc123");
    expect(userPrompt).toContain("2026-05-10-120000-test");
    expect(userPrompt).toContain("CANNED_SYSTEM_PROMPT");
  });

  it("writes nothing outside the inspection files (no fs writes inside the adapter itself)", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const expected = new Set([
      "gemini.sh",
      "bin",
      "gemini-argv.txt",
      "gemini-stdin.txt",
      "tour-system-prompt-called.txt",
    ]);
    const actual = new Set(readdirSync(env.dir));
    for (const name of actual) {
      expect(expected.has(name)).toBe(true);
    }
  });
});
