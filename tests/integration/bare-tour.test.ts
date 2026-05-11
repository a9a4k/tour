import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Matches either banner form emitted by the webapp branch — the happy-path
// "running at" line and the port-fallback "port N busy" line. Both prove
// bare `tour` dispatched to serve(), so either is a positive webapp signal.
const WEBAPP_BANNER = /Tour server (running at|: port \d+ busy)/;

// Integration coverage for bare `tour` smart-default surface (issue #175).
// Wraps the child in `script -q -c ... /dev/null` (util-linux) so the
// allocated PTY makes `process.stdout.isTTY` true — otherwise the surface
// picker's isTTY-false branch routes to TUI regardless of platform/ssh
// state and the test couldn't tell webapp wiring breakage from harness
// limits. CI runs on ubuntu-22.04 where `script` is always available.

async function resolveBunPath(): Promise<string> {
  const { stdout } = await execP("which", ["bun"]);
  return stdout.trimEnd();
}

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(bunPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-bare-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "f.txt"), "a\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "init"], dir);
  await writeFile(join(dir, "f.txt"), "b\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "next"], dir);
  await execP(bunPath, [CLI, "create", "--head", "HEAD", "--json"], { cwd: dir });
  return dir;
}

async function makePathWithStubs(stubs: string[]): Promise<string> {
  const stubDir = await mkdtemp(join(tmpdir(), "tour-bare-stubs-"));
  for (const name of stubs) {
    const p = join(stubDir, name);
    await writeFile(p, "#!/bin/sh\nexit 0\n");
    await chmod(p, 0o755);
  }
  return stubDir;
}

interface SpawnResult {
  stdout: string;
  proc: ChildProcess;
}

// Resolves once `waitFor` is seen in stdout (gives the child 100ms to
// flush trailing output) or once `waitMs` elapses without a match. The
// caller is expected to kill the proc in `afterEach`.
function spawnBareTour(
  bunPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  waitFor: RegExp,
  waitMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const command = `${bunPath} ${CLI}`;
    const proc = spawn("script", ["-q", "-c", command, "/dev/null"], {
      cwd,
      env,
      // New session so the script→sh→bun chain has a distinct pgid and
      // can be killed as a group in afterEach.
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
      if (waitFor.test(stdout)) setTimeout(finish, 100);
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
      // `detached: true` made pid the pgid — kill the whole group so bun
      // doesn't survive the test and keep port 8687 bound.
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  });
}

describe("tour — bare command surface selection (issue #175)", () => {
  let dir: string;
  let bunPath: string;
  let activeProc: ChildProcess | null = null;

  beforeAll(async () => {
    bunPath = await resolveBunPath();
    dir = await createTempRepoWithTour(bunPath);
  }, 30000);

  afterEach(async () => {
    if (activeProc) {
      await killProc(activeProc);
      activeProc = null;
    }
  });

  it("launches the webapp under a normal desktop env", async () => {
    const stubDir = await makePathWithStubs(["xdg-open"]);
    const result = await spawnBareTour(
      bunPath,
      dir,
      { PATH: `${stubDir}:/usr/bin:/bin` },
      WEBAPP_BANNER,
      10000,
    );
    activeProc = result.proc;
    expect(result.stdout).toMatch(WEBAPP_BANNER);
  }, 15000);

  it("launches the TUI when SSH_TTY is set", async () => {
    const stubDir = await makePathWithStubs(["xdg-open"]);
    const result = await spawnBareTour(
      bunPath,
      dir,
      { PATH: `${stubDir}:/usr/bin:/bin`, SSH_TTY: "/dev/pts/0" },
      // Absence-of-webapp test: run out the clock and then assert the
      // banner did not appear. 3s is more than enough for bun to print
      // it on the CI runner if the webapp branch had fired.
      /__NEVER_MATCHES__/,
      3000,
    );
    activeProc = result.proc;
    expect(result.stdout).not.toMatch(WEBAPP_BANNER);
  }, 15000);
});
