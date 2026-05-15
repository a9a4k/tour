import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, type ChildProcess, exec } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  chmod,
  rm,
  stat,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { waitForLog } from "../_helpers/wait-for-file.js";

const execP = promisify(execFile);
const BUN = "bun";
const CLI = join(import.meta.dirname, "../../src/main.ts");

// PRD #349 / ADR 0032 / issue #353 — webapp parity for `o`. End-to-end
// coverage of POST /api/tours/<id>/open-in-editor: happy path, file
// not in tour diff (400), file not in working tree (404), terminal
// editor refused (409), editor not configured (412), ENOENT (500).
// The fake-editor script logs argv to disk so the happy path can
// assert the absolute path + line landed on the binary; the
// terminal-editor case verifies the log is empty (no spawn).

const FAKE_EDITOR = `#!/bin/sh
if [ -n "$FAKE_EDITOR_LOG" ]; then
  for a in "$@"; do
    printf '%s\\n' "$a" >> "$FAKE_EDITOR_LOG"
  done
fi
exit 0
`;

async function gitCmd(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execP("git", args, { cwd });
  return stdout.trimEnd();
}

async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not ready at ${url}`);
}

interface ServerHandle {
  dir: string;
  tourId: string;
  port: number;
  baseUrl: string;
  process: ChildProcess;
  fakeBin: string;
  logPath: string;
}

async function setupRepoAndTour(): Promise<{
  dir: string;
  tourId: string;
  fakeBin: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "tour-open-editor-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "hello.txt"), "a\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "init"], dir);
  await writeFile(join(dir, "hello.txt"), "b\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "next"], dir);
  const { stdout } = await execP(
    BUN,
    [CLI, "create", "--head", "HEAD", "--json"],
    { cwd: dir },
  );
  const tour = JSON.parse(stdout);

  const fakeBin = join(dir, "fake-editor.sh");
  await writeFile(fakeBin, FAKE_EDITOR);
  await chmod(fakeBin, 0o755);

  return { dir, tourId: tour.id, fakeBin };
}

async function startServerWithEditor(
  dir: string,
  tourId: string,
  fakeBin: string,
  editorOverride?: string,
): Promise<ServerHandle> {
  const port = 12000 + Math.floor(Math.random() * 40000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = join(dir, `argv-${port}.log`);
  const editorArg = editorOverride ?? fakeBin;
  // Sentinel "<NONE>" disables --editor; the resolver then falls back
  // to environment, which we strip below.
  const editorFlag = editorArg === "<NONE>" ? [] : ["--editor", editorArg];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_EDITOR_LOG: logPath,
  };
  if (editorArg === "<NONE>") {
    delete env.TOUR_EDITOR;
    delete env.VISUAL;
    delete env.EDITOR;
  }
  const proc = exec(
    `${BUN} ${CLI} serve --port ${port}${editorFlag.length ? " " + editorFlag.map((a) => JSON.stringify(a)).join(" ") : ""}`,
    { cwd: dir, env },
  );
  await waitForServer(`${baseUrl}/api/tours`);
  return {
    dir,
    tourId,
    port,
    baseUrl,
    process: proc,
    fakeBin,
    logPath,
  };
}

function killServer(handle: ServerHandle): Promise<void> {
  return new Promise((resolve) => {
    if (!handle.process || handle.process.killed) {
      resolve();
      return;
    }
    handle.process.once("exit", () => resolve());
    handle.process.kill("SIGTERM");
    // Hard fallback so the test suite never hangs on a stuck Bun child.
    setTimeout(() => {
      if (!handle.process.killed) handle.process.kill("SIGKILL");
      resolve();
    }, 1500);
  });
}

async function logSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size;
  } catch {
    return 0;
  }
}

describe("POST /api/tours/:id/open-in-editor — happy path", () => {
  let handle: ServerHandle;
  beforeAll(async () => {
    const setup = await setupRepoAndTour();
    handle = await startServerWithEditor(
      setup.dir,
      setup.tourId,
      setup.fakeBin,
    );
  }, 30000);
  afterAll(async () => {
    await killServer(handle);
    await rm(handle.dir, { recursive: true, force: true });
  });

  it("spawns the configured editor with absolute file path + line, returns 200", async () => {
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "hello.txt",
          line: 1,
          side: "additions",
        }),
      },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Opened hello.txt:1");
    // Poll until the fake-editor's argv write lands on disk (issue #370).
    await waitForLog(handle.logPath);
    const argv = (await readFile(handle.logPath, "utf8")).trim().split("\n");
    // Unknown-binary default: `${file}:${line}` as a single arg.
    // realpath collapses macOS's /var → /private/var symlink so the
    // comparison holds on both platforms — the subprocess's cwd is
    // realpath-resolved, but `handle.dir` is the unresolved tmpdir.
    const expectedDir = await realpath(handle.dir);
    expect(argv[argv.length - 1]).toBe(`${expectedDir}/hello.txt:1`);
  });
});

describe("POST /api/tours/:id/open-in-editor — file not in tour diff", () => {
  let handle: ServerHandle;
  beforeAll(async () => {
    const setup = await setupRepoAndTour();
    handle = await startServerWithEditor(
      setup.dir,
      setup.tourId,
      setup.fakeBin,
    );
  }, 30000);
  afterAll(async () => {
    await killServer(handle);
    await rm(handle.dir, { recursive: true, force: true });
  });

  it("returns 400 with `not in tour diff` message when file isn't in the bundle", async () => {
    const before = await logSize(handle.logPath);
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "not-in-tour.txt",
          line: 1,
          side: "additions",
        }),
      },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toBe("o: not-in-tour.txt not in tour diff");
    // Grace period for the (non-)spawn — issue #370 keeps this site's
    // before/after shape but uses a longer wait than the old 50ms.
    await new Promise((r) => setTimeout(r, 200));
    expect(await logSize(handle.logPath)).toBe(before);
  });

  it("returns 400 with `invalid body` when file/line are missing", async () => {
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: "additions" }),
      },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toBe("o: invalid body");
  });
});

describe("POST /api/tours/:id/open-in-editor — terminal editor refused (409)", () => {
  let handle: ServerHandle;
  beforeAll(async () => {
    const setup = await setupRepoAndTour();
    // `vim` resolves through the editor-config terminal-allowlist
    // (basename match). The fake-bin path is not the configured
    // editor here; only the configured binary matters because
    // EditorConfig.terminal is set by the basename allowlist, not by
    // a real binary lookup.
    handle = await startServerWithEditor(
      setup.dir,
      setup.tourId,
      setup.fakeBin,
      "vim",
    );
  }, 30000);
  afterAll(async () => {
    await killServer(handle);
    await rm(handle.dir, { recursive: true, force: true });
  });

  it("returns 409 with the terminal-editor message and never spawns", async () => {
    const before = await logSize(handle.logPath);
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "hello.txt",
          line: 1,
          side: "additions",
        }),
      },
    );
    expect(res.status).toBe(409);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toBe("o: terminal editor — open from TUI instead");
    // Grace period for the (non-)spawn — issue #370 keeps this site's
    // before/after shape but uses a longer wait than the old 50ms.
    await new Promise((r) => setTimeout(r, 200));
    // No spawn happened; the fake-bin log is unchanged.
    expect(await logSize(handle.logPath)).toBe(before);
  });
});

describe("POST /api/tours/:id/open-in-editor — editor not configured (412)", () => {
  let handle: ServerHandle;
  beforeAll(async () => {
    const setup = await setupRepoAndTour();
    handle = await startServerWithEditor(
      setup.dir,
      setup.tourId,
      setup.fakeBin,
      "<NONE>",
    );
  }, 30000);
  afterAll(async () => {
    await killServer(handle);
    await rm(handle.dir, { recursive: true, force: true });
  });

  it("returns 412 with the not-configured message when no editor was passed", async () => {
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "hello.txt",
          line: 1,
          side: "additions",
        }),
      },
    );
    expect(res.status).toBe(412);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toBe(
      "o: editor not configured — set $TOUR_EDITOR or pass --editor",
    );
  });
});

describe("POST /api/tours/:id/open-in-editor — ENOENT (500)", () => {
  let handle: ServerHandle;
  beforeAll(async () => {
    const setup = await setupRepoAndTour();
    handle = await startServerWithEditor(
      setup.dir,
      setup.tourId,
      setup.fakeBin,
      "/definitely/not/on/path/fake-editor-xyz",
    );
  }, 30000);
  afterAll(async () => {
    await killServer(handle);
    await rm(handle.dir, { recursive: true, force: true });
  });

  it("returns 500 with the command-not-found message from core/editor-spawn", async () => {
    const res = await fetch(
      `${handle.baseUrl}/api/tours/${handle.tourId}/open-in-editor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "hello.txt",
          line: 1,
          side: "additions",
        }),
      },
    );
    expect(res.status).toBe(500);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toContain("command not found");
  });
});
