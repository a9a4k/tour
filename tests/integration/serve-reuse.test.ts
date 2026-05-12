import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execP = promisify(execFile);
const CLI = join(import.meta.dirname, "../../src/main.ts");

// Integration coverage for the reuse-if-running behavior (issues #178,
// #195). Spawn one `tour serve` to bind a port, then run a second
// invocation against the same temp repo — the second should exit 0
// with the "already running" line, leaving the first process untouched.
// #195 extends the probe to every port in the fallback walk so a
// same-cwd Tour living on a fallback port is also reused.

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

// Spawn `tour serve` WITHOUT --port so the implicit fallback walk runs.
// The preferred port is overridden via TOURDIFF_BASE_PORT so each test
// uses an isolated range — bare port 8687 would race with concurrent
// test files.
function spawnImplicitServeUntilReady(
  bunPath: string,
  cwd: string,
  basePort: number,
): Promise<{ stdout: string; proc: ChildProcess; boundPort: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bunPath, [CLI, "serve"], {
      cwd,
      env: { ...process.env, TOURDIFF_BASE_PORT: String(basePort) },
    });
    let stdout = "";
    let done = false;
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (done) return;
      const m = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m && /Tour server (running at|: port \d+ busy)/.test(stdout)) {
        done = true;
        const boundPort = parseInt(m[1], 10);
        setTimeout(() => resolve({ stdout, proc, boundPort }), 100);
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

function bindBlocker(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeBlocker(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
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
    // Explicit port: resolveServePort does not walk; we expect the
    // "port in use" error because the probe correctly classifies the
    // running server as not-our-cwd and falls through to bind.
    const result = await execP(bunPath, [CLI, "serve", "--port", String(port)], {
      cwd: otherDir,
    }).catch((err: { code: number; stderr: string }) => err);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`port ${port} is in use`);
  }, 30000);

  // Issue #195: a same-cwd Tour on a FALLBACK port is now reused too.
  // Repro: a non-Tour blocker holds the preferred port, the first
  // implicit-port `tour serve` walks past it and binds preferred+1.
  // A second implicit-port `tour serve` in the same cwd must probe
  // EACH port — preferred (non-tour, skip) → preferred+1 (same-cwd
  // Tour, reuse) — instead of binding yet another fallback.
  it("AC1: reuses a same-cwd Tour living on a fallback port", async () => {
    const preferred = basePort + 600 + Math.floor(Math.random() * 200);
    const blocker = await bindBlocker(preferred);
    let firstProc: ChildProcess | null = null;
    try {
      const first = await spawnImplicitServeUntilReady(bunPath, dir, preferred);
      firstProc = first.proc;
      bound = first.proc;
      expect(first.boundPort).toBe(preferred + 1);

      const second = await execP(bunPath, [CLI, "serve"], {
        cwd: dir,
        env: { ...process.env, TOURDIFF_BASE_PORT: String(preferred) },
      });
      expect(second.stdout).toContain(
        `Tour already running at http://127.0.0.1:${preferred + 1}`,
      );
      // First server is still up — second exited cleanly without binding.
      expect(firstProc.exitCode).toBeNull();
    } finally {
      await closeBlocker(blocker);
    }
  }, 30000);

  // Issue #195 AC2 + AC3: when the preferred port is held by another
  // (non-Tour or other-cwd-Tour) process, the implicit walk silently
  // skips it and binds the next free port — no surprise EADDRINUSE.
  it("AC2/AC3: implicit walk skips a non-Tour blocker on the preferred port", async () => {
    const preferred = basePort + 800 + Math.floor(Math.random() * 200);
    const blocker = await bindBlocker(preferred);
    try {
      const first = await spawnImplicitServeUntilReady(bunPath, dir, preferred);
      bound = first.proc;
      expect(first.boundPort).toBe(preferred + 1);
      expect(first.stdout).toContain(
        `Tour server: port ${preferred} busy, listening on http://127.0.0.1:${preferred + 1}`,
      );
    } finally {
      await closeBlocker(blocker);
    }
  }, 30000);
});
