import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Integration coverage for the deep-URL print on `tour serve <id>`
// (issue #179). The startup line should append `/<id>` so the user can
// Cmd-click straight to the tour. When `<id>` is omitted, the printed
// URL stays at the bare base.

async function resolveBunPath(): Promise<string> {
  const { stdout } = await execP("which", ["bun"]);
  return stdout.trimEnd();
}

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(bunPath: string): Promise<{ dir: string; tourId: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tour-deep-"));
  await gitCmd(["init", dir], dir);
  await gitCmd(["config", "user.email", "test@test.com"], dir);
  await gitCmd(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "f.txt"), "a\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "init"], dir);
  await writeFile(join(dir, "f.txt"), "b\n");
  await gitCmd(["add", "."], dir);
  await gitCmd(["commit", "-m", "next"], dir);
  const { stdout } = await execP(bunPath, [CLI, "create", "--head", "HEAD", "--json"], { cwd: dir });
  const tour = JSON.parse(stdout) as { id: string };
  return { dir, tourId: tour.id };
}

interface SpawnResult {
  stdout: string;
  proc: ChildProcess;
  port: number;
}

// Issue #373: `--port 0` lets the OS pick a free port; the bound port
// is read back from the startup banner so parallel test files can't
// collide on a guessed value.
function spawnServeUntilReady(
  bunPath: string,
  cwd: string,
  args: string[],
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bunPath, [CLI, "serve", "--port", "0", ...args], { cwd });
    let stdout = "";
    let done = false;
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (done) return;
      const m = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m && stdout.includes("Tour server")) {
        done = true;
        const port = parseInt(m[1], 10);
        setTimeout(() => resolve({ stdout, proc, port }), 100);
      }
    });
    proc.on("exit", (code) => {
      if (!done) reject(new Error(`serve exited early code=${code}\n${stdout}`));
    });
    proc.on("error", reject);
  });
}

function killProc(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
  });
}

describe("tour serve — deep URL on tour-id (issue #179)", () => {
  let dir: string;
  let tourId: string;
  let bunPath: string;
  let activeProc: ChildProcess | null = null;

  beforeAll(async () => {
    bunPath = await resolveBunPath();
    const setup = await createTempRepoWithTour(bunPath);
    dir = setup.dir;
    tourId = setup.tourId;
  }, 30000);

  afterEach(async () => {
    if (activeProc) {
      await killProc(activeProc);
      activeProc = null;
    }
  });

  it("appends /<id> to the printed URL when invoked with a positional tour-id", async () => {
    const result = await spawnServeUntilReady(bunPath, dir, [tourId]);
    activeProc = result.proc;
    expect(result.stdout).toContain(
      `Tour server running at http://127.0.0.1:${result.port}/${tourId}`,
    );
  }, 30000);

  it("auto-picks the most-recent open tour when invoked without a tour-id (issue #187)", async () => {
    const result = await spawnServeUntilReady(bunPath, dir, []);
    activeProc = result.proc;
    // The fixture has exactly one open tour, so the pre-pick resolves to
    // it and the printed URL ends in `/<tour-id>` — the same id the SPA's
    // auto-select would land on at bare `/`.
    expect(result.stdout).toContain(
      `Tour server running at http://127.0.0.1:${result.port}/${tourId}`,
    );
  }, 30000);
});
