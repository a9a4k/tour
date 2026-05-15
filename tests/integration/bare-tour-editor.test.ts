import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Issue #364: bare `tour --editor <cmd>` (no subcommand) must thread the
// resolved EditorConfig into the dispatched surface, identical to the
// explicit `tour tui --editor` / `tour serve --editor` paths.
//
// Approach: spawn bare `tour --editor <fake>` under a `script` PTY in a
// webapp-friendly env (xdg-open stub on PATH), wait for the
// "Tour server running at http://127.0.0.1:<port>/<tourId>" banner,
// then POST to /api/tours/<id>/open-in-editor with a real diff row. A
// successful 200 + argv log entry proves the editor flag survived the
// smart-default branch. The pre-fix behavior is 412 ("editor not
// configured") because main.ts drops the flag.

const FAKE_EDITOR = `#!/bin/sh
if [ -n "$FAKE_EDITOR_LOG" ]; then
  for a in "$@"; do
    printf '%s\\n' "$a" >> "$FAKE_EDITOR_LOG"
  done
fi
exit 0
`;

async function resolveBunPath(): Promise<string> {
  const { stdout } = await execP("which", ["bun"]);
  return stdout.trimEnd();
}

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(bunPath: string): Promise<{
  dir: string;
  tourId: string;
  fakeBin: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "tour-bare-editor-"));
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
    bunPath,
    [CLI, "create", "--head", "HEAD", "--json"],
    { cwd: dir },
  );
  const tour = JSON.parse(stdout);

  const fakeBin = join(dir, "fake-editor.sh");
  await writeFile(fakeBin, FAKE_EDITOR);
  await chmod(fakeBin, 0o755);

  return { dir, tourId: tour.id, fakeBin };
}

async function makePathWithStubs(stubs: string[]): Promise<string> {
  const stubDir = await mkdtemp(join(tmpdir(), "tour-bare-editor-stubs-"));
  for (const name of stubs) {
    const p = join(stubDir, name);
    await writeFile(p, "#!/bin/sh\nexit 0\n");
    await chmod(p, 0o755);
  }
  return stubDir;
}

// Platform-conditional `script` invocation (mirrors bare-tour.test.ts).
function scriptArgs(bunPath: string, cliArgs: string[]): string[] {
  if (process.platform === "darwin") {
    return ["-q", "/dev/null", bunPath, CLI, ...cliArgs];
  }
  // util-linux: -c expects a single shell command string. Quote each
  // arg so paths with spaces / special chars survive.
  const cmd = [bunPath, CLI, ...cliArgs]
    .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
    .join(" ");
  return ["-q", "-c", cmd, "/dev/null"];
}

interface SpawnResult {
  stdout: string;
  proc: ChildProcess;
}

// Match either banner: "running at http://..." or the port-busy fallback
// "Tour server: port X busy, listening on http://..." (issue #163). Both
// contain the bound URL; we extract port + tourId from there.
const SERVER_BANNER = /http:\/\/127\.0\.0\.1:(\d+)\/([^\s/]+)/;

function spawnBareTour(
  bunPath: string,
  cliArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  waitMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("script", scriptArgs(bunPath, cliArgs), {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve({ stdout, proc });
    };
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (SERVER_BANNER.test(stdout)) setTimeout(finish, 150);
    });
    proc.on("error", reject);
    proc.on("exit", () => finish());
    const deadline = setTimeout(finish, waitMs);
  });
}

function killProc(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.pid === undefined) return resolve();
    proc.once("exit", () => resolve());
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  });
}

describe("bare `tour --editor` smart-default dispatch (issue #364)", () => {
  let bunPath: string;
  let activeProc: ChildProcess | null = null;

  beforeAll(async () => {
    bunPath = await resolveBunPath();
  }, 30000);

  afterEach(async () => {
    if (activeProc) {
      await killProc(activeProc);
      activeProc = null;
    }
  });

  it("threads `--editor <cmd>` through bare `tour` into the dispatched webapp", async () => {
    const setup = await createTempRepoWithTour(bunPath);
    const stubDir = await makePathWithStubs(["xdg-open"]);
    const logPath = join(setup.dir, "argv.log");
    const result = await spawnBareTour(
      bunPath,
      ["--editor", setup.fakeBin],
      setup.dir,
      {
        PATH: `${stubDir}:/usr/bin:/bin`,
        FAKE_EDITOR_LOG: logPath,
        // Strip editor env so only the --editor flag is the source of
        // truth — otherwise a leaked $EDITOR in the test env could mask
        // a regression that drops the flag but still picks up the env.
        TOUR_EDITOR: "",
        VISUAL: "",
        EDITOR: "",
      },
      10000,
    );
    activeProc = result.proc;
    const m = result.stdout.match(SERVER_BANNER);
    expect(m, `expected webapp banner; got:\n${result.stdout}`).toBeTruthy();
    const port = m![1];
    const tourId = m![2];

    const res = await fetch(
      `http://127.0.0.1:${port}/api/tours/${tourId}/open-in-editor`,
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
    // Pre-fix: bare `tour` drops --editor → 412 "editor not configured".
    // Post-fix: 200 + fake-editor spawned.
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(true);
    expect(data.message).toBe("Opened hello.txt:1");
    await new Promise((r) => setTimeout(r, 100));
    const argv = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(argv[argv.length - 1]).toBe(`${setup.dir}/hello.txt:1`);
  }, 20000);

  it("threads $TOUR_EDITOR env fallback through bare `tour` into the dispatched webapp", async () => {
    const setup = await createTempRepoWithTour(bunPath);
    const stubDir = await makePathWithStubs(["xdg-open"]);
    const logPath = join(setup.dir, "argv.log");
    const result = await spawnBareTour(
      bunPath,
      [],
      setup.dir,
      {
        PATH: `${stubDir}:/usr/bin:/bin`,
        FAKE_EDITOR_LOG: logPath,
        TOUR_EDITOR: setup.fakeBin,
      },
      10000,
    );
    activeProc = result.proc;
    const m = result.stdout.match(SERVER_BANNER);
    expect(m, `expected webapp banner; got:\n${result.stdout}`).toBeTruthy();
    const port = m![1];
    const tourId = m![2];

    const res = await fetch(
      `http://127.0.0.1:${port}/api/tours/${tourId}/open-in-editor`,
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
  }, 20000);
});
