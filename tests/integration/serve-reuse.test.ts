import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Integration coverage for the reuse-if-running behavior (issue #178).
// Spawn one `tour serve` to bind a port, then run a second invocation
// against the same temp repo on the same port — the second should exit
// 0 with the "already running" line, leaving the first process untouched.

async function resolveBunPath(): Promise<string> {
  const { stdout } = await execP("which", ["bun"]);
  return stdout.trimEnd();
}

async function gitCmd(args: string[], cwd: string): Promise<void> {
  await execP("git", args, { cwd });
}

async function createTempRepoWithTour(bunPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tour-reuse-"));
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

function spawnServeUntilReady(
  bunPath: string,
  cwd: string,
  port: number,
): Promise<{ stdout: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bunPath, [CLI, "serve", "--port", String(port)], { cwd });
    let stdout = "";
    let done = false;
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (!done && stdout.includes("Tour server")) {
        done = true;
        setTimeout(() => resolve({ stdout, proc }), 100);
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

describe("tour serve — reuse if running (issue #178)", () => {
  let dir: string;
  let bunPath: string;
  let bound: ChildProcess | null = null;
  const basePort = 19700;

  beforeAll(async () => {
    bunPath = await resolveBunPath();
    dir = await createTempRepoWithTour(bunPath);
  }, 30000);

  afterEach(async () => {
    if (bound) {
      await killProc(bound);
      bound = null;
    }
  });

  it("a second invocation in the same cwd exits 0 with 'already running'", async () => {
    const port = basePort + Math.floor(Math.random() * 200);
    const first = await spawnServeUntilReady(bunPath, dir, port);
    bound = first.proc;

    const second = await execP(bunPath, [CLI, "serve", "--port", String(port)], {
      cwd: dir,
    });
    expect(second.stdout).toContain(`Tour already running at http://127.0.0.1:${port}`);
    // First server is still up — second exited cleanly without killing it.
    expect(first.proc.exitCode).toBeNull();
  }, 30000);

  it("a second invocation in a DIFFERENT cwd does not reuse, errors on explicit port", async () => {
    const port = basePort + 300 + Math.floor(Math.random() * 200);
    const first = await spawnServeUntilReady(bunPath, dir, port);
    bound = first.proc;

    const otherDir = await createTempRepoWithTour(bunPath);
    // Explicit port: bindWithFallback does not walk; we expect the
    // "port in use" error because the probe correctly classifies the
    // running server as not-our-cwd and falls through to bind.
    const result = await execP(bunPath, [CLI, "serve", "--port", String(port)], {
      cwd: otherDir,
    }).catch((err: { code: number; stderr: string }) => err);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`port ${port} is in use`);
  }, 30000);
});
