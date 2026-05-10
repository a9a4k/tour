import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CODEX_ADAPTER_SCRIPT } from "../../src/agents/codex.js";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MockEnv {
  /** Tempdir holding the adapter + the mock-bin shims. */
  dir: string;
  /** Path to the materialized codex.sh adapter. */
  adapter: string;
  /** PATH-prepend dir containing fake `codex` and `tour`. */
  binDir: string;
  /** File the fake codex writes its argv to (NUL-separated; args may contain newlines). */
  argvFile: string;
  /** File the fake codex writes its stdin to. */
  codexStdinFile: string;
  /** Sentinel: created iff the fake `tour` was invoked with `reply-system-prompt`. */
  systemPromptCalledFile: string;
}

/**
 * Fake `codex`: dumps argv (NUL-separated, since args may contain newlines)
 * and stdin to inspection files, exits 0.
 * Fake `tour`: emits a known system-prompt token when called as `tour reply-system-prompt`.
 */
async function setupMockEnv(): Promise<MockEnv> {
  const dir = await mkdtemp(join(tmpdir(), "tour-codex-adapter-"));
  const adapter = join(dir, "codex.sh");
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const argvFile = join(dir, "codex-argv.txt");
  const codexStdinFile = join(dir, "codex-stdin.txt");
  const systemPromptCalledFile = join(dir, "tour-system-prompt-called.txt");

  await writeFile(adapter, CODEX_ADAPTER_SCRIPT);
  await chmod(adapter, 0o755);

  // NUL-separate args so prompts containing newlines round-trip cleanly.
  const fakeCodex = `#!/usr/bin/env bash
set -e
: > "${argvFile}"
for arg in "$@"; do
  printf '%s\\0' "$arg" >> "${argvFile}"
done
cat > "${codexStdinFile}"
exit 0
`;
  await writeFile(join(binDir, "codex"), fakeCodex);
  await chmod(join(binDir, "codex"), 0o755);

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

  return { dir, adapter, binDir, argvFile, codexStdinFile, systemPromptCalledFile };
}

function runAdapter(env: MockEnv, envelopeJson: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(env.adapter, [], {
      env: {
        // PATH-prepend our mock bin so `codex` and `tour` resolve to the fakes.
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

describe("codex adapter (smoke test against mocked codex + tour)", () => {
  let env: MockEnv;
  beforeEach(async () => {
    env = await setupMockEnv();
  });

  it("exits 0 when the mocked codex exits 0", async () => {
    const result = await runAdapter(env, SAMPLE_ENVELOPE);
    expect(result.exitCode).toBe(0);
  });

  it("invokes `tour reply-system-prompt` to obtain the canonical prompt", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    expect(existsSync(env.systemPromptCalledFile)).toBe(true);
  });

  it("invokes `codex exec` with sandbox + approval flags that bound capability", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);

    // codex's non-interactive single-shot subcommand.
    expect(argv).toContain("exec");

    // Sandbox: codex's native FS-restriction layer. workspace-write blocks
    // writes outside cwd, so the agent can't escape to the user's $HOME etc.
    const sandboxIdx = argv.indexOf("--sandbox");
    expect(sandboxIdx).toBeGreaterThanOrEqual(0);
    expect(argv[sandboxIdx + 1]).toBe("workspace-write");

    // Approval policy: never escalate. Combined with the sandbox, the agent
    // can't ask for or obtain privileges beyond the workspace-write profile.
    const approvalIdx = argv.indexOf("--ask-for-approval");
    expect(approvalIdx).toBeGreaterThanOrEqual(0);
    expect(argv[approvalIdx + 1]).toBe("never");
  });

  it("includes the system prompt and envelope JSON in the user prompt argument", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);

    // codex exec takes the prompt as a positional argument; it must contain
    // the canned system prompt (codex has no separate --system-prompt flag,
    // so the adapter folds it into the user prompt) and the triggering
    // annotation id so the agent knows what to --reply-to.
    const userPrompt = argv[argv.length - 1];
    expect(userPrompt).toContain("CANNED_SYSTEM_PROMPT");
    expect(userPrompt).toContain("abc123");
    expect(userPrompt).toContain("2026-05-10-120000-test");
  });

  it("writes nothing outside the inspection files (no fs writes inside the adapter itself)", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    // The adapter's own filesystem footprint should be zero; the fake codex
    // writes the inspection files. Anything else inside `dir` would be a
    // surprise side-effect from the adapter.
    const expected = new Set([
      "codex.sh",
      "bin",
      "codex-argv.txt",
      "codex-stdin.txt",
      "tour-system-prompt-called.txt",
    ]);
    const actual = new Set(readdirSync(env.dir));
    for (const name of actual) {
      expect(expected.has(name)).toBe(true);
    }
  });
});
