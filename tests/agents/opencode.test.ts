import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OPENCODE_ADAPTER_SCRIPT } from "../../src/agents/opencode.js";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MockEnv {
  /** Tempdir holding the adapter + the mock-bin shims. */
  dir: string;
  /** Path to the materialized opencode.sh adapter. */
  adapter: string;
  /** PATH-prepend dir containing fake `opencode` and `tour`. */
  binDir: string;
  /** File the fake opencode writes its argv to (NUL-separated). */
  argvFile: string;
  /** File the fake opencode writes its stdin to. */
  opencodeStdinFile: string;
  /** File the fake opencode writes the OPENCODE_CONFIG env var to. */
  envFile: string;
  /** File the fake opencode writes the contents of $OPENCODE_CONFIG (the resolved JSON config) to. */
  configCopyFile: string;
  /** Sentinel: created iff the fake `tour` was invoked with `reply-system-prompt`. */
  systemPromptCalledFile: string;
}

/**
 * Fake `opencode`: dumps argv (NUL-separated), stdin, OPENCODE_CONFIG env,
 * and the resolved config-file contents to inspection files, then exits 0.
 * Fake `tour`: emits a known token when called as `tour reply-system-prompt`.
 */
async function setupMockEnv(): Promise<MockEnv> {
  const dir = await mkdtemp(join(tmpdir(), "tour-opencode-adapter-"));
  const adapter = join(dir, "opencode.sh");
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const argvFile = join(dir, "opencode-argv.txt");
  const opencodeStdinFile = join(dir, "opencode-stdin.txt");
  const envFile = join(dir, "opencode-env.txt");
  const configCopyFile = join(dir, "opencode-config.json");
  const systemPromptCalledFile = join(dir, "tour-system-prompt-called.txt");

  await writeFile(adapter, OPENCODE_ADAPTER_SCRIPT);
  await chmod(adapter, 0o755);

  const fakeOpencode = `#!/usr/bin/env bash
set -e
: > "${argvFile}"
for arg in "$@"; do
  printf '%s\\0' "$arg" >> "${argvFile}"
done
echo "OPENCODE_CONFIG=$OPENCODE_CONFIG" > "${envFile}"
if [ -n "$OPENCODE_CONFIG" ] && [ -f "$OPENCODE_CONFIG" ]; then
  cp "$OPENCODE_CONFIG" "${configCopyFile}"
fi
cat > "${opencodeStdinFile}"
exit 0
`;
  await writeFile(join(binDir, "opencode"), fakeOpencode);
  await chmod(join(binDir, "opencode"), 0o755);

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

  return {
    dir,
    adapter,
    binDir,
    argvFile,
    opencodeStdinFile,
    envFile,
    configCopyFile,
    systemPromptCalledFile,
  };
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

describe("opencode adapter (smoke test against mocked opencode + tour)", () => {
  let env: MockEnv;
  beforeEach(async () => {
    env = await setupMockEnv();
  });

  it("exits 0 when the mocked opencode exits 0", async () => {
    const result = await runAdapter(env, SAMPLE_ENVELOPE);
    expect(result.exitCode).toBe(0);
  });

  it("invokes `tour reply-system-prompt` to obtain the canonical prompt", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    expect(existsSync(env.systemPromptCalledFile)).toBe(true);
  });

  it("invokes `opencode run` with --agent and an OPENCODE_CONFIG pointing at an inline config", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const argv = (await readFile(env.argvFile, "utf-8")).split("\0").filter(Boolean);

    expect(argv[0]).toBe("run");

    const agentIdx = argv.indexOf("--agent");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    // The agent name is internal but must be passed; we don't pin a specific
    // string here so the adapter is free to rename it.
    expect(argv[agentIdx + 1]).toBeTruthy();

    const envText = await readFile(env.envFile, "utf-8");
    expect(envText).toMatch(/OPENCODE_CONFIG=.+/);
    expect(envText).not.toMatch(/OPENCODE_CONFIG=$/m);
  });

  it("writes a config that denies bash by default and allows only `tour annotate`", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const config = JSON.parse(await readFile(env.configCopyFile, "utf-8"));

    // Top-level edit/write are denied so the agent cannot touch source.
    expect(config.permission.edit).toBe("deny");
    expect(config.permission.write).toBe("deny");

    // Bash: catch-all deny + an explicit allow for `tour annotate`.
    const bash = config.permission.bash;
    expect(bash["*"]).toBe("deny");
    const allowKeys = Object.keys(bash).filter((k) => bash[k] === "allow");
    expect(allowKeys.length).toBeGreaterThanOrEqual(1);
    // At least one allow pattern must restrict to the `tour annotate ...`
    // command surface (no bare `tour`, no other binaries).
    expect(allowKeys.some((k) => /^tour annotate/.test(k))).toBe(true);

    // The agent block declares the same boundary so the per-agent rules also
    // enforce capability bounding even if global rules were relaxed.
    const agentName = Object.keys(config.agent)[0];
    const agentPerm = config.agent[agentName].permission;
    expect(agentPerm.edit).toBe("deny");
    expect(agentPerm.write).toBe("deny");
    expect(agentPerm.bash["*"]).toBe("deny");
    expect(
      Object.keys(agentPerm.bash).some(
        (k) => agentPerm.bash[k] === "allow" && /^tour annotate/.test(k),
      ),
    ).toBe(true);
  });

  it("references the canonical system prompt obtained from `tour reply-system-prompt`", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    const config = JSON.parse(await readFile(env.configCopyFile, "utf-8"));
    const agentName = Object.keys(config.agent)[0];
    const promptField = config.agent[agentName].prompt as string;

    // OpenCode's prompt accepts a {file:...} reference. The referenced file
    // must contain the canned token from the fake `tour reply-system-prompt`.
    const fileMatch = promptField.match(/^\{file:(.+)\}$/);
    expect(fileMatch).not.toBeNull();
    if (!fileMatch) return;
    const promptPath = fileMatch[1];
    expect(existsSync(promptPath)).toBe(true);
    const promptContents = await readFile(promptPath, "utf-8");
    expect(promptContents).toContain("CANNED_SYSTEM_PROMPT");
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

  it("writes nothing inside the test dir except the inspection files", async () => {
    await runAdapter(env, SAMPLE_ENVELOPE);
    // The adapter writes its ephemeral opencode config + system-prompt to
    // a /tmp dir outside of `dir`, so the only files appearing in `dir`
    // should be the adapter itself, the bin/, and the inspection files.
    const expected = new Set([
      "opencode.sh",
      "bin",
      "opencode-argv.txt",
      "opencode-stdin.txt",
      "opencode-env.txt",
      "opencode-config.json",
      "tour-system-prompt-called.txt",
    ]);
    const actual = new Set(readdirSync(env.dir));
    for (const name of actual) {
      expect(expected.has(name)).toBe(true);
    }
  });
});
